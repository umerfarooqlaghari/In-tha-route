const db = require('../config/db');

/**
 * Push notifications through Expo's push service (it forwards to Apple APNs and
 * Google FCM using the credentials stored in the Expo / EAS project).
 *
 * Works without any server key. EXPO_ACCESS_TOKEN is only needed if "Enhanced push
 * security" is turned on for the Expo project. Set PUSH_DISABLED=true to turn sending off.
 *
 * Every send is best effort: it never throws and never blocks the request that caused it.
 */
const EXPO_PUSH_URL = 'https://exp.host/--/api/v2/push/send';
const CHUNK = 100; // Expo accepts up to 100 messages per request
const TIMEOUT_MS = 8000;
const TOKEN_RE = /^(ExponentPushToken|ExpoPushToken)\[[^\]]+\]$/;

const isValidToken = (token) => TOKEN_RE.test(String(token || ''));

/** Saves this phone's token for the user (a phone that changes account moves with it). */
async function register(userId, token, platform = 'unknown') {
  await db.query(
    `INSERT INTO push_tokens (token, user_id, platform) VALUES ($1, $2, $3)
     ON CONFLICT (token) DO UPDATE SET user_id = EXCLUDED.user_id, platform = EXCLUDED.platform, updated_at = now()`,
    [token, userId, platform]
  );
}

/** Forgets a token (sign-out). Only the owner can remove it. */
async function unregister(userId, token) {
  await db.query('DELETE FROM push_tokens WHERE token = $1 AND user_id = $2', [token, userId]);
}

async function tokensFor(userIds) {
  const ids = [...new Set(userIds.filter(Boolean))];
  if (ids.length === 0) return [];
  const { rows } = await db.query('SELECT token FROM push_tokens WHERE user_id = ANY($1::uuid[])', [ids]);
  return rows.map((r) => r.token);
}

async function post(messages) {
  const headers = { 'Content-Type': 'application/json', Accept: 'application/json' };
  if (process.env.EXPO_ACCESS_TOKEN) headers.Authorization = `Bearer ${process.env.EXPO_ACCESS_TOKEN}`;
  const res = await fetch(EXPO_PUSH_URL, {
    method: 'POST',
    headers,
    body: JSON.stringify(messages),
    signal: AbortSignal.timeout(TIMEOUT_MS),
  });
  if (!res.ok) throw new Error(`Expo push HTTP ${res.status}: ${(await res.text().catch(() => '')).slice(0, 200)}`);
  return (await res.json()).data || [];
}

/**
 * Sends one notification to every phone of the given users.
 * @param {string[]} userIds
 * @param {{title: string, body: string, data?: object, channel?: 'orders' | 'chat'}} message
 * @returns {Promise<number>} how many phones Expo accepted the message for
 */
async function sendToUsers(userIds, { title, body, data = {}, channel = 'orders' }) {
  if (process.env.PUSH_DISABLED === 'true') return 0;
  try {
    const tokens = await tokensFor(userIds);
    if (tokens.length === 0) return 0;

    let accepted = 0;
    for (let i = 0; i < tokens.length; i += CHUNK) {
      const batch = tokens.slice(i, i + CHUNK);
      const tickets = await post(
        batch.map((to) => ({ to, title, body, data, sound: 'default', priority: 'high', channelId: channel }))
      );
      const dead = [];
      tickets.forEach((t, j) => {
        if (t.status === 'ok') accepted += 1;
        else if (t.details?.error === 'DeviceNotRegistered') dead.push(batch[j]);
        else console.error(`Push to a phone failed: ${t.message || t.details?.error}`);
      });
      // The app was removed or notifications were turned off: stop sending to that phone.
      if (dead.length) await db.query('DELETE FROM push_tokens WHERE token = ANY($1::text[])', [dead]);
    }
    return accepted;
  } catch (err) {
    console.error(`Push failed: ${err.message}`);
    return 0;
  }
}

/** Runs a notification without waiting for it (and without ever failing the caller). */
const later = (fn) => {
  Promise.resolve()
    .then(fn)
    .catch((err) => console.error(`Push failed: ${err.message}`));
};

const gbp = (n) => `£${Number(n).toFixed(2)}`;
const ref = (o) => o.external_order_id || `order ${String(o.id).slice(0, 6)}`;

/* ---- Events ------------------------------------------------------------------------- */

/** A platform driver was offered a batch. */
async function batchOffered(batchId) {
  const { rows } = await db.query(
    `SELECT d.user_id, count(o.id)::int AS n, coalesce(sum(o.driver_payout_gbp), 0) AS pay,
            string_agg(DISTINCT r.name, ', ') AS restaurants
       FROM batches b
       JOIN driver_profiles d ON d.id = b.driver_id
       JOIN orders o ON o.batch_id = b.id
       JOIN restaurants r ON r.id = o.restaurant_id
      WHERE b.id = $1 AND b.status = 'offered'
      GROUP BY d.user_id`,
    [batchId]
  );
  const b = rows[0];
  if (!b) return 0;
  return sendToUsers([b.user_id], {
    title: `New offer · ${gbp(b.pay)}`,
    body: `${b.n} ${b.n === 1 ? 'order' : 'orders'} from ${b.restaurants}. Open the app to accept.`,
    data: { type: 'offer', batchId },
  });
}

/** A restaurant gave an order to one of its own drivers. */
async function ownDriverAssigned(orderId) {
  const { rows } = await db.query(
    `SELECT o.id, o.external_order_id, o.postcode, r.name AS restaurant, d.user_id
       FROM orders o JOIN restaurants r ON r.id = o.restaurant_id
       JOIN driver_profiles d ON d.id = o.assigned_driver_id
      WHERE o.id = $1`,
    [orderId]
  );
  const o = rows[0];
  if (!o) return 0;
  return sendToUsers([o.user_id], {
    title: `New delivery from ${o.restaurant}`,
    body: `${ref(o)} to ${o.postcode}.`,
    data: { type: 'order', orderId },
  });
}

/** Tells the restaurant what happened to its orders: accepted / picked_up / delivered. */
async function orderUpdate(orderIds, kind) {
  const ids = [].concat(orderIds).filter(Boolean);
  if (ids.length === 0) return 0;
  const { rows } = await db.query(
    `SELECT o.id, o.external_order_id, o.postcode, r.owner_user_id, u.full_name AS driver
       FROM orders o JOIN restaurants r ON r.id = o.restaurant_id
       LEFT JOIN driver_profiles d ON d.id = o.assigned_driver_id
       LEFT JOIN users u ON u.id = d.user_id
      WHERE o.id = ANY($1::uuid[])`,
    [ids]
  );
  let sent = 0;
  for (const o of rows) {
    const driver = o.driver ? o.driver.split(' ')[0] : 'Your driver';
    const text = {
      accepted: [`Driver on the way`, `${driver} accepted ${ref(o)} and is heading to you.`],
      picked_up: [`Order collected`, `${driver} picked up ${ref(o)}.`],
      delivered: [`Order delivered`, `${ref(o)} was delivered to ${o.postcode}.`],
    }[kind];
    if (!text) continue;
    sent += await sendToUsers([o.owner_user_id], { title: text[0], body: text[1], data: { type: 'order', orderId: o.id } });
  }
  return sent;
}

/** A chat message for someone who does not have the app open. */
async function chatMessage(recipientUserId, { senderName, body, conversationId }) {
  return sendToUsers([recipientUserId], {
    title: senderName,
    body: body.length > 140 ? `${body.slice(0, 137)}…` : body,
    data: { type: 'chat', conversationId },
    channel: 'chat',
  });
}

/** The admin approved or rejected a platform driver's documents. */
async function driverReviewed(driverId, approved) {
  const { rows } = await db.query('SELECT user_id FROM driver_profiles WHERE id = $1', [driverId]);
  if (!rows[0]) return 0;
  return sendToUsers([rows[0].user_id], approved
    ? { title: 'You are approved', body: 'Your documents are verified. Go online to start receiving orders.', data: { type: 'account' } }
    : { title: 'Documents need attention', body: 'Some of your documents were not accepted. Open the app to upload them again.', data: { type: 'account' } });
}

module.exports = {
  isValidToken,
  register,
  unregister,
  sendToUsers,
  later,
  batchOffered,
  ownDriverAssigned,
  orderUpdate,
  chatMessage,
  driverReviewed,
};
