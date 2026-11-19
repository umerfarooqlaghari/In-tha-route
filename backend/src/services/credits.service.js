const crypto = require('crypto');

const db = require('../config/db');
const AppError = require('../utils/AppError');
const pricing = require('./pricing.service');

/**
 * Merchant credits. 1 credit = £1. A merchant buys credits (Stripe), and each platform
 * delivery uses that order's fee (the admin's fee for that merchant, plus any extra miles).
 *
 * The balance is the sum of the merchant's credit transactions. Fees are taken when an
 * order is delivered (or when an admin cancels it after collection, since the trip was
 * made). Until then the fees of the merchant's live platform orders are held back, so a
 * merchant can only post an order the credits they have left will cover.
 *
 * Orders delivered by the merchant's own drivers carry no fee, so they need no credits.
 */

const MIN_PURCHASE_GBP = 10;
const MAX_PURCHASE_GBP = 5000;
const PACKS_GBP = [50, 100, 200, 500];

const num = (v) => Number(v || 0);
const round2 = pricing.round2;

const stripeKey = () => process.env.STRIPE_SECRET_KEY || '';
const paymentsEnabled = () => !!stripeKey();

/** Credits held back for the merchant's orders that are still out (not delivered or cancelled). */
async function heldFor(client, restaurantId) {
  const { rows } = await client.query(
    `SELECT coalesce(sum(restaurant_fee_gbp), 0) AS held FROM orders
      WHERE restaurant_id = $1 AND status NOT IN ('delivered', 'cancelled')`,
    [restaurantId]
  );
  return num(rows[0].held);
}

async function balanceOf(client, restaurantId) {
  const { rows } = await client.query(
    'SELECT coalesce(sum(credits), 0) AS balance FROM credit_transactions WHERE restaurant_id = $1',
    [restaurantId]
  );
  return num(rows[0].balance);
}

/** What a merchant sees: balance, what is held for live orders, and how many deliveries are left. */
async function summaryFor(restaurantId, client = db) {
  const [{ rows }, config, held] = await Promise.all([
    client.query(
      `SELECT r.custom_fee_gbp,
              coalesce(sum(t.credits), 0) AS balance,
              coalesce(sum(t.credits) FILTER (WHERE t.kind IN ('purchase', 'grant') OR (t.kind = 'adjustment' AND t.credits > 0)), 0) AS added,
              coalesce(-sum(t.credits) FILTER (WHERE t.kind = 'delivery'), 0) AS used,
              coalesce(sum(t.amount_paid_gbp) FILTER (WHERE t.kind = 'purchase'), 0) AS paid,
              count(*) FILTER (WHERE t.kind = 'delivery')::int AS deliveries
         FROM restaurants r
         LEFT JOIN credit_transactions t ON t.restaurant_id = r.id
        WHERE r.id = $1
        GROUP BY r.id`,
      [restaurantId]
    ),
    pricing.getConfig(client),
    heldFor(client, restaurantId),
  ]);
  if (!rows[0]) throw new AppError(404, 'RESTAURANT_NOT_FOUND', 'Restaurant not found.');
  const r = rows[0];
  const balance = round2(num(r.balance));
  const feePerDeliveryGbp = pricing.feePerDelivery(config, r.custom_fee_gbp);
  const available = round2(balance - held);
  return {
    balance,
    held: round2(held),
    available,
    feePerDeliveryGbp,
    customFee: r.custom_fee_gbp != null,
    // Deliveries within the included distance; longer trips use a little more.
    deliveriesLeft: feePerDeliveryGbp > 0 ? Math.max(0, Math.floor((available + 1e-9) / feePerDeliveryGbp)) : null,
    addedCredits: round2(num(r.added)),
    usedCredits: round2(num(r.used)),
    paidGbp: round2(num(r.paid)),
    deliveriesCharged: r.deliveries,
    paymentsEnabled: paymentsEnabled(),
    packsGbp: PACKS_GBP,
    minPurchaseGbp: MIN_PURCHASE_GBP,
    maxPurchaseGbp: MAX_PURCHASE_GBP,
  };
}

function toTransaction(row) {
  return {
    id: row.id,
    restaurantId: row.restaurant_id,
    restaurantName: row.restaurant_name,
    kind: row.kind,
    credits: num(row.credits),
    amountPaidGbp: row.amount_paid_gbp == null ? null : num(row.amount_paid_gbp),
    orderId: row.order_id || undefined,
    externalOrderId: row.external_order_id || undefined,
    note: row.note || '',
    createdByName: row.created_by_name || undefined,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

const TX_SELECT = `
  SELECT t.*, r.name AS restaurant_name, o.external_order_id, u.full_name AS created_by_name
    FROM credit_transactions t
    JOIN restaurants r ON r.id = t.restaurant_id
    LEFT JOIN orders o ON o.id = t.order_id
    LEFT JOIN users u ON u.id = t.created_by
`;

async function transactionsFor(restaurantId, limit = 50) {
  const { rows } = await db.query(`${TX_SELECT} WHERE t.restaurant_id = $1 ORDER BY t.created_at DESC LIMIT $2`, [
    restaurantId,
    limit,
  ]);
  return rows.map(toTransaction);
}

/**
 * Stops a platform order the merchant's credits cannot cover. Call inside the order's
 * transaction: the merchant row is locked so two posts at once cannot both use the same credits.
 */
async function assertCanPost(client, restaurantId, feeGbp, feePerDeliveryGbp = 0) {
  // Out of credits (less than one delivery at the merchant's rate) blocks every order, even
  // one for the merchant's own driver. A platform order also needs enough for its own fee.
  const needed = Math.max(feeGbp || 0, feePerDeliveryGbp || 0);
  if (!(needed > 0)) return;
  await client.query('SELECT 1 FROM restaurants WHERE id = $1 FOR UPDATE', [restaurantId]);
  const [balance, held] = await Promise.all([balanceOf(client, restaurantId), heldFor(client, restaurantId)]);
  const available = round2(balance - held);
  if (available + 1e-9 < needed) {
    const outOfCredits = available + 1e-9 < (feePerDeliveryGbp || needed);
    throw new AppError(
      402,
      'OUT_OF_CREDITS',
      outOfCredits
        ? "Sorry, this order can't be posted: you're out of credits. Buy credits to keep using deliveries."
        : `Sorry, this order can't be posted. It needs ${needed.toFixed(2)} credits and you have ${available.toFixed(2)} left. Buy credits to keep posting orders.`,
      [{ field: 'credits', message: 'Out of credits.', available, needed }]
    );
  }
}

/** Takes a delivered (or collected then cancelled) order's fee from its merchant's credits, once. */
async function chargeOrder(client, orderId, note = '') {
  await client.query(
    `INSERT INTO credit_transactions (restaurant_id, kind, credits, order_id, note)
     SELECT restaurant_id, 'delivery', -restaurant_fee_gbp, id, $2
       FROM orders WHERE id = $1 AND restaurant_fee_gbp > 0
     ON CONFLICT DO NOTHING`,
    [orderId, note]
  );
}

/** Admin: adds (or, with a negative number, removes) credits by hand. */
async function adjust(restaurantId, credits, note, adminUserId) {
  const { rows } = await db.query('SELECT 1 FROM restaurants WHERE id = $1', [restaurantId]);
  if (!rows[0]) throw new AppError(404, 'RESTAURANT_NOT_FOUND', 'Restaurant not found.');
  await db.query(
    `INSERT INTO credit_transactions (restaurant_id, kind, credits, note, created_by)
     VALUES ($1, 'adjustment', $2, $3, $4)`,
    [restaurantId, round2(credits), note || '', adminUserId]
  );
}

/** Admin: every merchant's credit totals, keyed by restaurant id. */
async function totalsByRestaurant() {
  const { rows } = await db.query(
    `SELECT r.id, r.custom_fee_gbp,
            coalesce(sum(t.credits), 0) AS balance,
            coalesce(sum(t.credits) FILTER (WHERE t.kind IN ('purchase', 'grant') OR (t.kind = 'adjustment' AND t.credits > 0)), 0) AS added,
            coalesce(sum(t.credits) FILTER (WHERE t.kind = 'purchase'), 0) AS purchased,
            coalesce(-sum(t.credits) FILTER (WHERE t.kind = 'delivery'), 0) AS used,
            coalesce(sum(t.amount_paid_gbp) FILTER (WHERE t.kind = 'purchase'), 0) AS paid,
            max(t.created_at) FILTER (WHERE t.kind = 'purchase') AS last_purchase_at,
            (SELECT coalesce(sum(o.restaurant_fee_gbp), 0) FROM orders o
              WHERE o.restaurant_id = r.id AND o.status NOT IN ('delivered', 'cancelled')) AS held
       FROM restaurants r
       LEFT JOIN credit_transactions t ON t.restaurant_id = r.id
      GROUP BY r.id`
  );
  return new Map(
    rows.map((r) => {
      const balance = round2(num(r.balance));
      return [
        r.id,
        {
          balance,
          held: round2(num(r.held)),
          available: round2(balance - num(r.held)),
          addedCredits: round2(num(r.added)),
          purchasedCredits: round2(num(r.purchased)),
          usedCredits: round2(num(r.used)),
          paidGbp: round2(num(r.paid)),
          lastPurchaseAt: r.last_purchase_at ? new Date(r.last_purchase_at).toISOString() : null,
        },
      ];
    })
  );
}

/** Admin: the latest credit activity across every merchant (purchases, grants, adjustments, deliveries). */
async function recentTransactions({ limit = 100, kind } = {}) {
  const { rows } = await db.query(
    `${TX_SELECT} WHERE ($2::text IS NULL OR t.kind = $2) ORDER BY t.created_at DESC LIMIT $1`,
    [limit, kind || null]
  );
  return rows.map(toTransaction);
}

/* -------------------------------------------------------------------------- */
/* Stripe Checkout (live once STRIPE_SECRET_KEY and STRIPE_WEBHOOK_SECRET are set) */
/* -------------------------------------------------------------------------- */

async function stripe(method, path, form) {
  const res = await fetch(`https://api.stripe.com/v1${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${stripeKey()}`,
      ...(form && { 'Content-Type': 'application/x-www-form-urlencoded' }),
    },
    body: form ? new URLSearchParams(form).toString() : undefined,
  });
  const json = await res.json().catch(() => ({}));
  if (!res.ok) {
    console.error(`Stripe ${method} ${path} failed: ${res.status} ${json.error && json.error.message}`);
    throw new AppError(502, 'PAYMENT_PROVIDER_ERROR', 'The payment could not be started. Please try again.');
  }
  return json;
}

function requirePayments() {
  if (!paymentsEnabled()) {
    throw new AppError(503, 'PAYMENTS_NOT_CONFIGURED', 'Card payments are not set up yet. Please contact the In Tha Route team.');
  }
}

/** Where Stripe sends the merchant back to. Only our own web portal is allowed. */
function returnBase(requested) {
  const allowed = (process.env.WEB_APP_URL || '').replace(/\/$/, '');
  if (allowed) return allowed;
  try {
    const u = new URL(requested);
    if (u.hostname === 'localhost' || u.hostname === '127.0.0.1') return u.origin;
  } catch {
    // fall through
  }
  throw new AppError(503, 'PAYMENTS_NOT_CONFIGURED', 'Card payments are not set up yet. Please contact the In Tha Route team.');
}

/** Starts a Stripe Checkout for `amountGbp` of credits and returns the page to send the merchant to. */
async function startCheckout(user, amountGbp, requestedReturnUrl) {
  requirePayments();
  const amount = round2(amountGbp);
  const base = returnBase(requestedReturnUrl);
  const session = await stripe('POST', '/checkout/sessions', {
    mode: 'payment',
    'line_items[0][quantity]': '1',
    'line_items[0][price_data][currency]': 'gbp',
    'line_items[0][price_data][unit_amount]': String(Math.round(amount * 100)),
    'line_items[0][price_data][product_data][name]': `${amount} In Tha Route credits`,
    'line_items[0][price_data][product_data][description]': '1 credit = £1, used for platform deliveries',
    client_reference_id: user.restaurant_id,
    'metadata[restaurant_id]': user.restaurant_id,
    'metadata[credits]': String(amount),
    customer_email: user.email,
    success_url: `${base}/merchant/credits?checkout={CHECKOUT_SESSION_ID}`,
    cancel_url: `${base}/merchant/credits?cancelled=1`,
  });
  await db.query(
    `INSERT INTO credit_checkouts (restaurant_id, stripe_session_id, amount_gbp, credits, created_by)
     VALUES ($1, $2, $3, $3, $4)`,
    [user.restaurant_id, session.id, amount, user.id]
  );
  return { url: session.url, sessionId: session.id };
}

/** Adds a paid checkout's credits, once (the webhook and the merchant's return can both arrive). */
async function fulfil(sessionId, amountPaidGbp) {
  return db.withTransaction(async (client) => {
    const { rows } = await client.query(
      `UPDATE credit_checkouts SET status = 'paid', paid_at = now()
        WHERE stripe_session_id = $1 AND status = 'pending'
        RETURNING restaurant_id, credits, amount_gbp, created_by`,
      [sessionId]
    );
    if (!rows[0]) return false;
    const c = rows[0];
    await client.query(
      `INSERT INTO credit_transactions (restaurant_id, kind, credits, amount_paid_gbp, stripe_session_id, note, created_by)
       VALUES ($1, 'purchase', $2, $3, $4, 'Card payment', $5)
       ON CONFLICT (stripe_session_id) DO NOTHING`,
      [c.restaurant_id, c.credits, amountPaidGbp ?? c.amount_gbp, sessionId, c.created_by]
    );
    return true;
  });
}

/** The merchant is back from Stripe: checks the session and adds the credits if it is paid. */
async function confirmCheckout(restaurantId, sessionId) {
  requirePayments();
  const { rows } = await db.query('SELECT status FROM credit_checkouts WHERE stripe_session_id = $1 AND restaurant_id = $2', [
    sessionId,
    restaurantId,
  ]);
  if (!rows[0]) throw new AppError(404, 'CHECKOUT_NOT_FOUND', 'Payment not found.');
  if (rows[0].status === 'paid') return 'paid';
  const session = await stripe('GET', `/checkout/sessions/${encodeURIComponent(sessionId)}`);
  if (session.payment_status === 'paid') {
    await fulfil(sessionId, session.amount_total != null ? session.amount_total / 100 : undefined);
    return 'paid';
  }
  return session.status === 'expired' ? 'expired' : 'pending';
}

/** Checks a Stripe webhook's signature (Stripe-Signature: t=...,v1=...). */
function verifyWebhook(rawBody, header) {
  const secret = process.env.STRIPE_WEBHOOK_SECRET || '';
  if (!secret) throw new AppError(503, 'PAYMENTS_NOT_CONFIGURED', 'Webhooks are not set up.');
  const parts = Object.fromEntries(
    String(header || '')
      .split(',')
      .map((p) => p.split('='))
      .filter((p) => p.length === 2)
  );
  const signatures = String(header || '')
    .split(',')
    .filter((p) => p.startsWith('v1='))
    .map((p) => p.slice(3));
  const t = Number(parts.t);
  if (!t || signatures.length === 0) throw new AppError(400, 'BAD_SIGNATURE', 'Invalid signature.');
  if (Math.abs(Date.now() / 1000 - t) > 300) throw new AppError(400, 'BAD_SIGNATURE', 'Signature too old.');
  const expected = crypto.createHmac('sha256', secret).update(`${t}.${rawBody}`).digest('hex');
  const ok = signatures.some(
    (s) => s.length === expected.length && crypto.timingSafeEqual(Buffer.from(s), Buffer.from(expected))
  );
  if (!ok) throw new AppError(400, 'BAD_SIGNATURE', 'Invalid signature.');
  return JSON.parse(rawBody);
}

async function handleWebhook(rawBody, signature) {
  const event = verifyWebhook(rawBody, signature);
  const session = event.data && event.data.object;
  if (
    (event.type === 'checkout.session.completed' || event.type === 'checkout.session.async_payment_succeeded') &&
    session &&
    session.payment_status === 'paid'
  ) {
    await fulfil(session.id, session.amount_total != null ? session.amount_total / 100 : undefined);
  } else if (event.type === 'checkout.session.expired' && session) {
    await db.query(`UPDATE credit_checkouts SET status = 'expired' WHERE stripe_session_id = $1 AND status = 'pending'`, [
      session.id,
    ]);
  }
}

module.exports = {
  MIN_PURCHASE_GBP,
  MAX_PURCHASE_GBP,
  summaryFor,
  transactionsFor,
  assertCanPost,
  chargeOrder,
  adjust,
  totalsByRestaurant,
  recentTransactions,
  startCheckout,
  confirmCheckout,
  handleWebhook,
  fulfil,
};
