const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-1234';
process.env.BCRYPT_ROUNDS = '4';
process.env.PUSH_DISABLED = 'true';
process.env.SIGNUP_CREDITS = '0'; // like production: a new merchant starts with no credits
delete process.env.GOOGLE_MAPS_API_KEY;
delete process.env.STRIPE_SECRET_KEY;
process.env.STRIPE_WEBHOOK_SECRET = 'whsec_test_secret';

const { startTestDatabase } = require('./helpers/testDb');

// postcodes.io stand-in: every postcode is the same spot, so each delivery is within the included distance.
const realFetch = global.fetch;
global.fetch = async (url, init) => {
  const u = String(url);
  if (u.startsWith('https://api.postcodes.io/postcodes/')) {
    return new Response(JSON.stringify({ result: { latitude: 51.4613, longitude: -0.3037 } }), { status: 200 });
  }
  return realFetch(url, init);
};

let stopDb, app, pool, merchant, admin, driver, ownDriverId;
const bearer = (who) => ({ Authorization: `Bearer ${who.token}` });
const MERCHANT = { email: 'credits@merchant.test', password: 'Passw0rd123' };

const post = (ref, dispatchType = 'open_platform', extra = {}) =>
  request(app).post('/api/restaurant/orders').set(bearer(merchant)).send({
    source: 'Deliveroo', externalOrderId: ref, customerName: 'Anna T.', customerPhone: '+442033195035',
    deliveryAddress: '19 Rosemont Rd, Richmond', postcode: 'TW10 6QN', prepMinutes: 20, dispatchType, items: [],
    ...extra,
  });
const credits = async () => (await request(app).get('/api/restaurant/credits').set(bearer(merchant))).body.credits;
const adminMerchant = async () =>
  (await request(app).get('/api/admin/dashboard').set(bearer(admin))).body.restaurants.find((r) => r.id === merchant.restaurantId);
const deliver = async (orderId) => {
  assert.equal((await request(app).post(`/api/driver/pool/${orderId}/add`).set(bearer(driver))).body.ok, true);
  assert.equal((await request(app).post('/api/driver/batch/advance').set(bearer(driver))).status, 200); // picked up
  assert.equal((await request(app).post('/api/driver/batch/advance').set(bearer(driver))).status, 200); // delivered
  await request(app).post('/api/driver/batch/next').set(bearer(driver));
};

before(async () => {
  stopDb = await startTestDatabase();
  app = require('../src/app');
  ({ pool } = require('../src/config/db'));
  await require('../src/db/migrate').runMigrations(pool, () => {});

  const m = await request(app).post('/api/auth/signup').send({
    role: 'restaurant', ...MERCHANT, fullName: 'Credit Staff', phone: '020 8940 5521',
    restaurantName: 'Credit Kitchen', address: '5 The Square, Richmond', postcode: 'TW9 1DT',
  });
  merchant = { token: m.body.tokens.accessToken, restaurantId: m.body.user.restaurant.id };

  const ADMIN = { email: 'owner@credits.test', password: 'AdminPass123' };
  await require('../src/db/seedAdmin').seedAdmin(pool, { ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password }, () => {});
  admin = { token: (await request(app).post('/api/auth/login').send(ADMIN)).body.tokens.accessToken };

  const d = await request(app).post('/api/auth/signup').send({
    role: 'driver', email: 'rider@credits.test', password: 'Passw0rd123', fullName: 'Rider One',
    phone: '+44 7841 920001', vehicle: 'Car', plateNumber: 'CR12 EDT',
  });
  driver = { token: d.body.tokens.accessToken };
  await pool.query(
    `UPDATE driver_profiles SET status = 'approved_online', last_latitude = 51.462, last_longitude = -0.304,
            last_location_at = now() WHERE driver_type = 'platform_contracted'`
  );

  const own = await request(app).post('/api/restaurant/drivers').set(bearer(merchant)).send({
    fullName: 'Own Rider', email: 'own@credits.test', password: 'Passw0rd123', phone: '+44 7841 920099', vehicle: 'Car',
  });
  ownDriverId = own.body.dashboard.drivers.find((x) => x.email === 'own@credits.test').id;
});

after(async () => {
  global.fetch = realFetch;
  if (pool) await pool.end();
  if (stopDb) await stopDb();
});

describe('posting with credits', () => {
  test('a new merchant starts at 0 and cannot post a platform order', async () => {
    const c = await credits();
    assert.equal(c.balance, 0);
    assert.equal(c.deliveriesLeft, 0);
    assert.equal(c.feePerDeliveryGbp, 5);
    const res = await post('#C0');
    assert.equal(res.status, 402);
    assert.equal(res.body.error.code, 'OUT_OF_CREDITS');
    assert.match(res.body.error.message, /out of credits/);
  });

  test('out of credits, an order for their own driver cannot be posted either', async () => {
    const res = await post('#C-own0', 'own_driver', { ownDriverId });
    assert.equal(res.status, 402, JSON.stringify(res.body));
    assert.equal(res.body.error.code, 'OUT_OF_CREDITS');
  });

  test('credits added by the admin cover that many deliveries; orders still out hold their fee', async () => {
    const res = await request(app)
      .post(`/api/admin/restaurants/${merchant.restaurantId}/credits`)
      .set(bearer(admin))
      .send({ credits: 10, note: 'Trial' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal((await credits()).deliveriesLeft, 2);

    const a = await post('#C1');
    assert.equal(a.status, 201, JSON.stringify(a.body));
    assert.equal(a.body.dashboard.credits.held, 5);
    assert.equal(a.body.dashboard.credits.deliveriesLeft, 1);
    const b = await post('#C2');
    assert.equal(b.status, 201);
    const c = await post('#C3');
    assert.equal(c.status, 402, 'both credits are held by the two orders out');

    // Delivered: the fee is taken once; the balance goes down and nothing is held for it.
    await deliver(a.body.order.id);
    let now = await credits();
    assert.equal(now.balance, 5);
    assert.equal(now.held, 5);
    assert.equal(now.usedCredits, 5);

    // Cancelled by the merchant before collection: nothing is taken, the hold is released.
    const cancel = await request(app).post(`/api/restaurant/orders/${b.body.order.id}/cancel`).set(bearer(merchant)).send({});
    assert.equal(cancel.status, 200, JSON.stringify(cancel.body));
    now = await credits();
    assert.equal(now.balance, 5);
    assert.equal(now.held, 0);
    assert.equal(now.deliveriesLeft, 1);
  });

  test('a delivery is never charged twice', async () => {
    const before = (await credits()).balance;
    const { rows } = await pool.query(`SELECT id FROM orders WHERE external_order_id = '#C1'`);
    const credit = require('../src/services/credits.service');
    const db = require('../src/config/db');
    await db.withTransaction((client) => credit.chargeOrder(client, rows[0].id));
    assert.equal((await credits()).balance, before);
  });
});

describe("the admin's fee for one merchant", () => {
  test('a custom fee changes the fee per delivery, the deliveries left and live orders', async () => {
    await request(app).post(`/api/admin/restaurants/${merchant.restaurantId}/credits`).set(bearer(admin)).send({ credits: 30 });
    const o = await post('#F1');
    assert.equal(o.status, 201);
    assert.equal(o.body.order.restaurantFeeGbp, 5);

    const res = await request(app).patch(`/api/admin/restaurants/${merchant.restaurantId}/fee`).set(bearer(admin)).send({ customFeeGbp: 7 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const m = res.body.dashboard.restaurants.find((r) => r.id === merchant.restaurantId);
    assert.equal(m.customFeeGbp, 7);
    assert.equal(m.feePerDeliveryGbp, 7);
    // 35 credits, 7 held by the live order: 28 left = 4 deliveries at £7.
    assert.equal(m.credits.deliveriesLeft, 4);
    const live = res.body.dashboard.orders.find((x) => x.id === o.body.order.id);
    assert.equal(live.restaurantFeeGbp, 7, 'the live order is re-priced');

    const dash = (await request(app).get('/api/restaurant/dashboard').set(bearer(merchant))).body;
    assert.equal(dash.algorithm.baseRestaurantChargeGbp, 7, 'the merchant sees their own fee');
    assert.equal(dash.credits.feePerDeliveryGbp, 7);

    const other = await request(app).post('/api/auth/signup').send({
      role: 'restaurant', email: 'other@credits.test', password: 'Passw0rd123', fullName: 'Other Staff',
      phone: '020 8940 5522', restaurantName: 'Other Kitchen', address: '6 The Square, Richmond', postcode: 'TW9 1DT',
    });
    const otherDash = (await request(app).get('/api/restaurant/dashboard').set({ Authorization: `Bearer ${other.body.tokens.accessToken}` })).body;
    assert.equal(otherDash.algorithm.baseRestaurantChargeGbp, 5, 'other merchants keep the standard fee');

    await deliver(o.body.order.id);
    assert.equal((await credits()).balance, 28);

    const back = await request(app).patch(`/api/admin/restaurants/${merchant.restaurantId}/fee`).set(bearer(admin)).send({ customFeeGbp: null });
    assert.equal(back.body.dashboard.restaurants.find((r) => r.id === merchant.restaurantId).feePerDeliveryGbp, 5);
  });
});

describe('admin credits overview', () => {
  test('lists credit activity and each merchant\'s totals', async () => {
    const res = await request(app).get('/api/admin/credits').set(bearer(admin));
    assert.equal(res.status, 200);
    const mine = res.body.transactions.filter((t) => t.restaurantId === merchant.restaurantId);
    assert.ok(mine.some((t) => t.kind === 'adjustment' && t.credits === 10 && t.note === 'Trial'));
    assert.ok(mine.some((t) => t.kind === 'delivery' && t.credits === -7 && t.externalOrderId === '#F1'));
    const m = await adminMerchant();
    assert.equal(m.credits.usedCredits, 12);
    assert.equal(m.credits.addedCredits, 40);
    assert.equal((await request(app).get('/api/admin/credits').set(bearer(merchant))).status, 403);
  });
});

describe('card payments', () => {
  test('without Stripe keys the merchant is told payments are not set up', async () => {
    assert.equal((await credits()).paymentsEnabled, false);
    const res = await request(app).post('/api/restaurant/credits/checkout').set(bearer(merchant)).send({ amountGbp: 100 });
    assert.equal(res.status, 503);
    assert.equal(res.body.error.code, 'PAYMENTS_NOT_CONFIGURED');
    const tooSmall = await request(app).post('/api/restaurant/credits/checkout').set(bearer(merchant)).send({ amountGbp: 2 });
    assert.equal(tooSmall.status, 400);
  });

  test("a signed Stripe webhook adds the credits once; a bad signature is refused", async () => {
    await pool.query(
      `INSERT INTO credit_checkouts (restaurant_id, stripe_session_id, amount_gbp, credits) VALUES ($1, 'cs_test_1', 100, 100)`,
      [merchant.restaurantId]
    );
    const before = (await credits()).balance;
    const body = JSON.stringify({
      type: 'checkout.session.completed',
      data: { object: { id: 'cs_test_1', payment_status: 'paid', amount_total: 10000 } },
    });
    const sign = (payload, secret = 'whsec_test_secret') => {
      const t = Math.floor(Date.now() / 1000);
      return `t=${t},v1=${crypto.createHmac('sha256', secret).update(`${t}.${payload}`).digest('hex')}`;
    };
    const bad = await request(app)
      .post('/api/payments/stripe/webhook')
      .set('Content-Type', 'application/json')
      .set('Stripe-Signature', sign(body, 'whsec_wrong'))
      .send(body);
    assert.equal(bad.status, 400);
    for (let i = 0; i < 2; i++) {
      const ok = await request(app)
        .post('/api/payments/stripe/webhook')
        .set('Content-Type', 'application/json')
        .set('Stripe-Signature', sign(body))
        .send(body);
      assert.equal(ok.status, 200, JSON.stringify(ok.body));
    }
    const after = await credits();
    assert.equal(after.balance, before + 100);
    assert.equal(after.paidGbp, 100);
  });
});

describe('disabling a merchant', () => {
  test('signs them out and stops sign-in until the admin turns them back on', async () => {
    const res = await request(app).patch(`/api/admin/restaurants/${merchant.restaurantId}/status`).set(bearer(admin)).send({ active: false });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.dashboard.restaurants.find((r) => r.id === merchant.restaurantId).isActive, false);

    assert.equal((await request(app).get('/api/restaurant/dashboard').set(bearer(merchant))).status, 403);
    const login = await request(app).post('/api/auth/login').send(MERCHANT);
    assert.equal(login.status, 403);
    assert.equal(login.body.error.code, 'ACCOUNT_DISABLED');

    await request(app).patch(`/api/admin/restaurants/${merchant.restaurantId}/status`).set(bearer(admin)).send({ active: true });
    const again = await request(app).post('/api/auth/login').send(MERCHANT);
    assert.equal(again.status, 200);
    merchant.token = again.body.tokens.accessToken;
    assert.equal((await request(app).get('/api/restaurant/dashboard').set(bearer(merchant))).status, 200);
  });
});

describe('free starting credits for merchants already on the platform', () => {
  test('the migration gives each existing merchant 100 credits', async () => {
    const fs = require('fs');
    const path = require('path');
    const sql = fs.readFileSync(path.join(__dirname, '../src/db/migrations/014_merchant_credits.sql'), 'utf8');
    const grant = sql.slice(sql.lastIndexOf('INSERT INTO credit_transactions'));
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      const { rows } = await client.query(`SELECT count(*)::int AS n FROM restaurants`);
      await client.query(grant);
      const g = await client.query(`SELECT count(*)::int AS n, min(credits) AS c FROM credit_transactions WHERE note = 'Free starting credits'`);
      assert.equal(g.rows[0].n, rows[0].n);
      assert.equal(Number(g.rows[0].c), 100);
    } finally {
      await client.query('ROLLBACK');
      client.release();
    }
  });
});
