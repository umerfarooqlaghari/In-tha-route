const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-1234';
process.env.BCRYPT_ROUNDS = '4';
process.env.PUSH_DISABLED = 'true';
delete process.env.GOOGLE_MAPS_API_KEY;

const { startTestDatabase } = require('./helpers/testDb');

// postcodes.io stand-in (no network in tests).
const realFetch = global.fetch;
global.fetch = async (url, init) => {
  const u = String(url);
  if (u.startsWith('https://api.postcodes.io/postcodes/')) {
    return new Response(JSON.stringify({ result: { latitude: 51.4613, longitude: -0.3037 } }), { status: 200 });
  }
  return realFetch(url, init);
};

let stopDb, app, pool, dispatch, orders;
let restaurant, admin;
const ADMIN = { email: 'owner@races.test', password: 'AdminPass123' };
const drivers = [];
const bearer = (who) => ({ Authorization: `Bearer ${who.token}` });

async function signupDriver(n) {
  const res = await request(app).post('/api/auth/signup').send({
    role: 'driver', email: `racer${n}@races.test`, password: 'Passw0rd123', fullName: `Racer ${n}`,
    phone: `+44 7841 90000${n}`, vehicle: 'Car', plateNumber: `RC${n}3 ABC`,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { token: res.body.tokens.accessToken, id: res.body.user.driver.id };
}

/** Posts a platform order: it waits in the open pool until a driver accepts it. */
async function poolOrder(ref) {
  const res = await request(app).post('/api/restaurant/orders').set(bearer(restaurant)).send({
    source: 'Deliveroo', externalOrderId: ref, customerName: 'Anna T.', customerPhone: '+442033195035',
    deliveryAddress: '19 Rosemont Rd, Richmond', postcode: 'TW10 6QN', prepMinutes: 20,
    dispatchType: 'open_platform', items: [],
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.order.id;
}

async function clearRuns() {
  await pool.query(`UPDATE orders SET status = 'delivered', delivered_at = now() WHERE status <> 'delivered'`);
  await pool.query(`UPDATE batches SET status = 'completed', acknowledged = true WHERE status IN ('offered', 'accepted', 'completed')`);
  await pool.query('DELETE FROM batch_declines');
  await pool.query(`UPDATE pricing_config SET max_batch_size = 5, offer_radius_miles = 3`);
  // Every platform driver online, next to the restaurant, with a fresh GPS fix.
  await pool.query(
    `UPDATE driver_profiles SET status = 'approved_online', last_latitude = 51.462, last_longitude = -0.304,
            last_location_at = now() WHERE driver_type = 'platform_contracted'`
  );
}

const poolIds = async (who) =>
  (await request(app).get('/api/driver/dashboard').set(bearer(who))).body.orders.filter((o) => !o.batchId).map((o) => o.id);

const orderRow = async (id) => (await pool.query('SELECT * FROM orders WHERE id = $1', [id])).rows[0];

before(async () => {
  stopDb = await startTestDatabase();
  app = require('../src/app');
  ({ pool } = require('../src/config/db'));
  dispatch = require('../src/services/dispatch.service');
  orders = require('../src/services/order.service');
  await require('../src/db/migrate').runMigrations(pool, () => {});
  await require('../src/db/seedAdmin').seedAdmin(pool, { ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password }, () => {});
  admin = { token: (await request(app).post('/api/auth/login').send(ADMIN)).body.tokens.accessToken };

  const res = await request(app).post('/api/auth/signup').send({
    role: 'restaurant', email: 'saffron@races.test', password: 'Passw0rd123', fullName: 'Saffron Staff',
    phone: '020 8940 5521', restaurantName: 'Saffron', address: '5 The Square, Richmond', postcode: 'TW9 1DT',
  });
  restaurant = { token: res.body.tokens.accessToken };
  for (let n = 1; n <= 5; n++) drivers.push(await signupDriver(n));
});

after(async () => {
  global.fetch = realFetch;
  if (pool) await pool.end();
  if (stopDb) await stopDb();
});

describe('two drivers going for the same order at the same moment', () => {
  test('pool "Add" pressed by 5 drivers at once: exactly one gets it, 20 times in a row', async () => {
    for (let round = 0; round < 20; round++) {
      await clearRuns();
      const orderId = await poolOrder(`#R${round}`);
      const results = await Promise.all(
        drivers.map((d) => request(app).post(`/api/driver/pool/${orderId}/add`).set(bearer(d)))
      );
      const winners = results.filter((r) => r.body.ok === true);
      assert.equal(winners.length, 1, `round ${round}: ${results.map((r) => JSON.stringify(r.body.ok ?? r.body)).join(' ')}`);
      for (const r of results.filter((x) => x.body.ok !== true)) {
        assert.equal(r.body.message, 'That order has just been taken.');
      }
      const { rows } = await pool.query('SELECT count(DISTINCT batch_id)::int AS n, min(assigned_driver_id::text) AS d FROM orders WHERE id = $1', [orderId]);
      assert.equal(rows[0].n, 1);
    }
  });

  test('a new order shows at once in the pool of every nearby driver with room', async () => {
    await clearRuns();
    const orderId = await poolOrder('#O1');
    // drivers[3] is full, drivers[4] is 10 miles away, everyone else is near with room.
    await pool.query('UPDATE pricing_config SET max_batch_size = 1');
    const other = await poolOrder('#O1x');
    await request(app).post(`/api/driver/pool/${other}/add`).set(bearer(drivers[3]));
    await pool.query('UPDATE driver_profiles SET last_latitude = 51.6 WHERE id = $1', [drivers[4].id]);

    const told = await dispatch.notifyNearbyDrivers(orderId);
    assert.deepEqual(told.sort(), [drivers[0].id, drivers[1].id, drivers[2].id].sort());
    for (const d of drivers.slice(0, 3)) assert.ok((await poolIds(d)).includes(orderId));
    const full = await request(app).get('/api/driver/dashboard').set(bearer(drivers[3]));
    assert.deepEqual(full.body.capacity, { activeOrders: 1, maxOrders: 1, poolBlockedBy: 'full' });
    assert.deepEqual(await poolIds(drivers[4]), [], 'too far away');
  });

  test('a full driver sees the pool again as soon as they deliver one order', async () => {
    await clearRuns();
    await pool.query('UPDATE pricing_config SET max_batch_size = 2');
    const d = drivers[0];
    const [a, b, c] = [await poolOrder('#G1a'), await poolOrder('#G1b'), await poolOrder('#G1c')];
    await request(app).post(`/api/driver/pool/${a}/add`).set(bearer(d));
    await request(app).post(`/api/driver/pool/${b}/add`).set(bearer(d));
    assert.deepEqual(await poolIds(d), []);
    const refused = await request(app).post(`/api/driver/pool/${c}/add`).set(bearer(d));
    assert.equal(refused.body.ok, false);
    assert.match(refused.body.message, /You already have 2 of 2 orders/);

    // Pick up both, deliver the first: one place is free.
    for (let i = 0; i < 3; i++) await request(app).post('/api/driver/batch/advance').set(bearer(d));
    assert.deepEqual(await poolIds(d), [c]);
    const added = await request(app).post(`/api/driver/pool/${c}/add`).set(bearer(d));
    assert.equal(added.body.ok, true, added.body.message);

    // The delivered order is filed away; the run is now b (on board) then c (to collect).
    const dash = (await request(app).get('/api/driver/dashboard').set(bearer(d))).body;
    assert.deepEqual(dash.orders.filter((o) => o.batchId).map((o) => o.id), [b, c]);
    assert.equal(dash.activeStopIndex, 1, 'stops: pick up b (done), pick up c, drop b, drop c');
    await request(app).post('/api/driver/batch/advance').set(bearer(d)); // picked up c
    await request(app).post('/api/driver/batch/advance').set(bearer(d)); // delivered b
    await request(app).post('/api/driver/batch/advance').set(bearer(d)); // delivered c
    for (const id of [a, b, c]) assert.equal((await orderRow(id)).status, 'delivered');
  });

  test('admin changes the limit: it applies to every driver straight away', async () => {
    await clearRuns();
    const d = drivers[1];
    const a = await poolOrder('#G2a');
    const b = await poolOrder('#G2b');
    await request(app).post(`/api/driver/pool/${a}/add`).set(bearer(d));
    let res = await request(app).put('/api/admin/pricing').set(bearer(admin)).send({ maxBatchSize: 1 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.deepEqual(await poolIds(d), []);
    res = await request(app).put('/api/admin/pricing').set(bearer(admin)).send({ maxBatchSize: 3 });
    assert.ok((await poolIds(d)).includes(b));
  });

  test('a driver without a recent location sees no pool and cannot accept', async () => {
    await clearRuns();
    const a = await poolOrder('#G3');
    const d = drivers[2];
    await pool.query('UPDATE driver_profiles SET last_location_at = now() - interval \'1 hour\' WHERE id = $1', [d.id]);
    const dash = (await request(app).get('/api/driver/dashboard').set(bearer(d))).body;
    assert.equal(dash.capacity.poolBlockedBy, 'no_location');
    const res = await request(app).post(`/api/driver/pool/${a}/add`).set(bearer(d));
    assert.equal(res.body.ok, false);
    assert.match(res.body.message, /Turn on location/);
  });
});

describe('in-house drivers and delivery settings', () => {
  let own;
  before(async () => {
    const res = await request(app).post('/api/restaurant/drivers').set(bearer(restaurant)).send({
      fullName: 'Ali Khan', email: 'ali@races.test', password: 'Passw0rd123', phone: '+44 7841 900099', vehicle: 'Car',
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    own = res.body.dashboard.drivers.find((d) => d.name === 'Ali Khan');
  });
  const postOwn = (ref) =>
    request(app).post('/api/restaurant/orders').set(bearer(restaurant)).send({
      source: 'Just Eat', externalOrderId: ref, customerName: 'Anna T.', customerPhone: '+442033195035',
      deliveryAddress: '19 Rosemont Rd, Richmond', postcode: 'TW10 6QN', prepMinutes: 20,
      dispatchType: 'own_driver', ownDriverId: own.id, items: [],
    });

  test('an in-house driver at the limit cannot be given another order until they deliver one', async () => {
    await clearRuns();
    await pool.query('UPDATE pricing_config SET max_batch_size = 2');
    assert.equal((await postOwn('#H1')).status, 201);
    const second = await postOwn('#H2');
    assert.equal(second.status, 201);
    assert.equal(second.body.dashboard.drivers.find((d) => d.id === own.id).activeOrders, 2);
    const third = await postOwn('#H3');
    assert.equal(third.status, 409);
    assert.equal(third.body.error.code, 'DRIVER_FULL');
    assert.match(third.body.error.message, /already has 2 of 2 orders/);

    // The driver delivers one: the restaurant can give them another.
    const login = await request(app).post('/api/auth/login').send({ email: 'ali@races.test', password: 'Passw0rd123' });
    const ali = { token: login.body.tokens.accessToken };
    for (let i = 0; i < 3; i++) await request(app).post('/api/driver/batch/advance').set(bearer(ali));
    const dash = await request(app).get('/api/restaurant/dashboard').set(bearer(restaurant));
    assert.equal(dash.body.drivers.find((d) => d.id === own.id).activeOrders, 1);
    assert.equal((await postOwn('#H3')).status, 201);
  });

  test('"My drivers only" refuses platform orders', async () => {
    await request(app).patch('/api/restaurant/policy').set(bearer(restaurant)).send({ driverPolicy: 'own_drivers' });
    const res = await request(app).post('/api/restaurant/orders').set(bearer(restaurant)).send({
      source: 'Just Eat', externalOrderId: '#H9', customerName: 'Anna T.', customerPhone: '+442033195035',
      deliveryAddress: '19 Rosemont Rd, Richmond', postcode: 'TW10 6QN', prepMinutes: 20,
      dispatchType: 'open_platform', items: [],
    });
    assert.equal(res.status, 400);
    assert.match(JSON.stringify(res.body), /My drivers only/);
    await request(app).patch('/api/restaurant/policy').set(bearer(restaurant)).send({ driverPolicy: 'open_platform' });
  });
});

describe('pool add and going offline', () => {
  test('a pool order the driver picks themselves starts their run without an offer to accept', async () => {
    await clearRuns();
    const orderId = await poolOrder('#P1');
    const res = await request(app).post(`/api/driver/pool/${orderId}/add`).set(bearer(drivers[2]));
    assert.equal(res.body.ok, true);
    assert.equal(res.body.dashboard.driverBatchStatus, 'accepted_navigating');
    assert.equal((await orderRow(orderId)).status, 'driver_assigned');
  });

  test('accepting waits for another request holding the order instead of wrongly saying "taken"', async () => {
    await clearRuns();
    const orderId = await poolOrder('#P2');
    // Hold the order's lock (e.g. the restaurant marking it ready), then let it go.
    const holder = await pool.connect();
    await holder.query('BEGIN');
    await holder.query('SELECT 1 FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
    const adding = request(app).post(`/api/driver/pool/${orderId}/add`).set(bearer(drivers[3])).then((r) => r);
    await new Promise((r) => setTimeout(r, 150));
    await holder.query('ROLLBACK');
    holder.release();
    const res = await adding;
    assert.equal(res.body.ok, true, res.body.message);
  });

  test('an offline driver sees no pool and cannot accept', async () => {
    await clearRuns();
    const orderId = await poolOrder('#F0');
    const d = drivers[4];
    await request(app).put('/api/driver/availability').set(bearer(d)).send({ online: false });
    assert.deepEqual(await poolIds(d), []);
    const res = await request(app).post(`/api/driver/pool/${orderId}/add`).set(bearer(d));
    assert.equal(res.body.ok, false);
  });

  test('going offline hands an old-style unanswered offer straight back to the pool', async () => {
    await clearRuns();
    const orderId = await poolOrder('#F1');
    const d = drivers[4];
    // An offer made before the open pool existed.
    const batch = (await pool.query(`INSERT INTO batches (driver_id, status) VALUES ($1, 'offered') RETURNING id`, [d.id])).rows[0];
    await pool.query(`UPDATE orders SET batch_id = $1, assigned_driver_id = $2, status = 'batched_offered' WHERE id = $3`, [batch.id, d.id, orderId]);
    const res = await request(app).put('/api/driver/availability').set(bearer(d)).send({ online: false });
    assert.equal(res.status, 200);
    const o = await orderRow(orderId);
    assert.equal(o.batch_id, null);
    assert.equal(o.status, 'preparing');
    // Not counted as a decline: they can get it again once back online.
    const declines = await pool.query('SELECT count(*)::int AS n FROM batch_declines WHERE driver_id = $1', [d.id]);
    assert.equal(declines.rows[0].n, 0);
  });
});

describe('duplicate orders', () => {
  const post = (ref, source = 'Deliveroo') =>
    request(app).post('/api/restaurant/orders').set(bearer(restaurant)).send({
      source, externalOrderId: ref, customerName: 'Anna T.', customerPhone: '+442033195035',
      deliveryAddress: '19 Rosemont Rd, Richmond', postcode: 'TW10 6QN', prepMinutes: 20,
      dispatchType: 'open_platform', items: [],
    });

  test('the same receipt posted twice at once goes through only once', async () => {
    const results = await Promise.all([post('#DUP1'), post('#DUP1'), post('#DUP1')]);
    assert.deepEqual(results.map((r) => r.status).sort(), [201, 409, 409]);
    const dup = results.find((r) => r.status === 409);
    assert.equal(dup.body.error.code, 'DUPLICATE_ORDER');
    assert.match(dup.body.error.message, /Deliveroo order #DUP1 was already posted just now/);
  });

  test('the same number from another app, or after cancelling, is allowed', async () => {
    assert.equal((await post('#DUP1', 'Uber Eats')).status, 201);
    const { rows } = await pool.query(`SELECT id FROM orders WHERE external_order_id = '#DUP1' AND source = 'Deliveroo'`);
    await request(app).post(`/api/restaurant/orders/${rows[0].id}/cancel`).set(bearer(restaurant)).send({});
    assert.equal((await post('#DUP1')).status, 201);
  });
});

describe('cancelling and moving orders', () => {
  test('a restaurant cancels an order waiting in the pool: gone from its list, not charged', async () => {
    await clearRuns();
    const orderId = await poolOrder('#C1');
    const res = await request(app).post(`/api/restaurant/orders/${orderId}/cancel`).set(bearer(restaurant)).send({ reason: 'Customer cancelled' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(!res.body.dashboard.orders.some((o) => o.id === orderId));
    const o = await orderRow(orderId);
    assert.equal(o.status, 'cancelled');
    assert.equal(Number(o.restaurant_fee_gbp), 0);
    assert.equal(o.cancel_reason, 'Customer cancelled');
    // A driver can no longer add it.
    const add = await request(app).post(`/api/driver/pool/${orderId}/add`).set(bearer(drivers[0]));
    assert.equal(add.body.ok, false);
  });

  test('cancelling one order of a two-order run moves the other up and re-prices it', async () => {
    await clearRuns();
    const a = await poolOrder('#C2a');
    const b = await poolOrder('#C2b');
    const d = drivers[0];
    await request(app).post(`/api/driver/pool/${a}/add`).set(bearer(d));
    await request(app).post(`/api/driver/pool/${b}/add`).set(bearer(d));
    const before = await orderRow(b);
    assert.equal(before.batch_position, 2);
    await request(app).post(`/api/restaurant/orders/${a}/cancel`).set(bearer(restaurant)).send({});
    const after = await orderRow(b);
    assert.equal(after.batch_position, 1);
    assert.ok(Number(after.driver_payout_gbp) > Number(before.driver_payout_gbp), 'first-place pay is higher');
    const dash = await request(app).get('/api/driver/dashboard').set(bearer(d));
    assert.deepEqual(dash.body.orders.filter((o) => o.batchId).map((o) => o.id), [b]);
    assert.equal(dash.body.activeStopIndex, 0);
  });

  test('cancelling the only order of a run closes the run', async () => {
    await clearRuns();
    const a = await poolOrder('#C3');
    const d = drivers[1];
    await request(app).post(`/api/driver/pool/${a}/add`).set(bearer(d));
    await request(app).post(`/api/restaurant/orders/${a}/cancel`).set(bearer(restaurant)).send({});
    const dash = await request(app).get('/api/driver/dashboard').set(bearer(d));
    assert.equal(dash.body.currentBatchId, null);
  });

  test('an order the driver has collected cannot be cancelled; another restaurant cannot cancel it', async () => {
    await clearRuns();
    const a = await poolOrder('#C4');
    const d = drivers[1];
    await request(app).post(`/api/driver/pool/${a}/add`).set(bearer(d));
    await request(app).post('/api/driver/batch/advance').set(bearer(d)); // picked up
    const res = await request(app).post(`/api/restaurant/orders/${a}/cancel`).set(bearer(restaurant)).send({});
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'ORDER_COLLECTED');

    const other = await request(app).post('/api/auth/signup').send({
      role: 'restaurant', email: 'other@races.test', password: 'Passw0rd123', fullName: 'Other Staff',
      phone: '020 8940 5522', restaurantName: 'Other', address: '6 The Square, Richmond', postcode: 'TW9 1DT',
    });
    const res2 = await request(app).post(`/api/restaurant/orders/${a}/cancel`)
      .set({ Authorization: `Bearer ${other.body.tokens.accessToken}` }).send({});
    assert.equal(res2.status, 404);
  });

  test('admin takes an order off a driver and it goes to someone else, not back to them', async () => {
    await clearRuns();
    const a = await poolOrder('#M1');
    const first = drivers[2];
    await request(app).post(`/api/driver/pool/${a}/add`).set(bearer(first));
    const res = await request(app).post(`/api/admin/orders/${a}/release`).set(bearer(admin));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    // Back in the pool for other drivers, not for the one it was taken from.
    const o = await orderRow(a);
    assert.equal(o.batch_id, null);
    assert.ok(!(await poolIds(first)).includes(a));
    assert.ok((await poolIds(drivers[3])).includes(a));
    assert.equal((await request(app).post(`/api/driver/pool/${a}/add`).set(bearer(first))).body.ok, false);
  });

  test('admin cancels a collected order mid-run: the driver carries on with the rest', async () => {
    await clearRuns();
    const a = await poolOrder('#K1a');
    const b = await poolOrder('#K1b');
    const d = drivers[0];
    await request(app).post(`/api/driver/pool/${a}/add`).set(bearer(d));
    await request(app).post(`/api/driver/pool/${b}/add`).set(bearer(d));
    // Stops: pickup a, pickup b, drop a, drop b. Both picked up -> now at "drop a" (2).
    await request(app).post('/api/driver/batch/advance').set(bearer(d));
    await request(app).post('/api/driver/batch/advance').set(bearer(d));

    const res = await request(app).post(`/api/admin/orders/${a}/cancel`).set(bearer(admin)).send({ reason: 'Customer gone' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const o = await orderRow(a);
    assert.equal(o.status, 'cancelled');
    assert.ok(Number(o.driver_payout_gbp) > 0, 'driver is still paid for the trip');

    // Stops now: pickup b, drop b -> driver is at "drop b" (1).
    const dash = await request(app).get('/api/driver/dashboard').set(bearer(d));
    assert.deepEqual(dash.body.orders.filter((x) => x.batchId).map((x) => x.id), [b]);
    assert.equal(dash.body.activeStopIndex, 1);
    await request(app).post('/api/driver/batch/advance').set(bearer(d));
    assert.equal((await orderRow(b)).status, 'delivered');

  });

  test('admin cancels the last undelivered order of a run: the run is finished', async () => {
    await clearRuns();
    const a = await poolOrder('#K2a');
    const b = await poolOrder('#K2b');
    const d = drivers[1];
    await request(app).post(`/api/driver/pool/${a}/add`).set(bearer(d));
    await request(app).post(`/api/driver/pool/${b}/add`).set(bearer(d));
    for (let i = 0; i < 3; i++) await request(app).post('/api/driver/batch/advance').set(bearer(d)); // a delivered
    assert.equal((await orderRow(a)).status, 'delivered');
    await request(app).post(`/api/admin/orders/${b}/cancel`).set(bearer(admin)).send({});
    const batch = await pool.query('SELECT status FROM batches WHERE id = $1', [(await orderRow(a)).batch_id]);
    assert.equal(batch.rows[0].status, 'completed');
    const dash = await request(app).get('/api/driver/dashboard').set(bearer(d));
    assert.equal(dash.body.driverBatchStatus, 'accepted_navigating'); // "Batch complete" screen
  });

  test('admin can cancel an order; releasing an order already in the pool is refused', async () => {
    await clearRuns();
    const a = await poolOrder('#M2');
    let res = await request(app).post(`/api/admin/orders/${a}/release`).set(bearer(admin));
    assert.equal(res.status, 409);
    res = await request(app).post(`/api/admin/orders/${a}/cancel`).set(bearer(admin)).send({ reason: 'Test' });
    assert.equal(res.status, 200);
    assert.equal((await orderRow(a)).status, 'cancelled');
    // Shown on today's admin list as cancelled.
    assert.equal(res.body.dashboard.orders.find((o) => o.id === a).status, 'cancelled');
  });
});

describe('orders that need attention', () => {
  test('no driver after the order is ready: flagged once, shown to the restaurant', async () => {
    await clearRuns();
    const a = await poolOrder('#A1');
    await pool.query(`UPDATE driver_profiles SET status = 'offline' WHERE driver_type = 'platform_contracted'`);
    await pool.query(`UPDATE orders SET ready_at = now() - interval '6 minutes' WHERE id = $1`, [a]);
    const first = await orders.sendAttentionAlerts();
    assert.equal(first.noDriver, 1);
    assert.equal((await orders.sendAttentionAlerts()).noDriver, 0, 'only alerted once');
    const dash = await request(app).get('/api/restaurant/dashboard').set(bearer(restaurant));
    assert.equal(dash.body.orders.find((o) => o.id === a).attention, 'no_driver');
    await pool.query(`UPDATE driver_profiles SET status = 'approved_online' WHERE driver_type = 'platform_contracted'`);
  });

  test('a collected order not delivered after 45 minutes is flagged', async () => {
    await clearRuns();
    const a = await poolOrder('#A2');
    await request(app).post(`/api/driver/pool/${a}/add`).set(bearer(drivers[0]));
    await request(app).post('/api/driver/batch/advance').set(bearer(drivers[0]));
    await pool.query(`UPDATE orders SET picked_up_at = now() - interval '50 minutes' WHERE id = $1`, [a]);
    assert.equal((await orders.sendAttentionAlerts()).late, 1);
    const dash = await request(app).get('/api/admin/dashboard').set(bearer(admin));
    assert.equal(dash.body.orders.find((o) => o.id === a).attention, 'late_delivery');
  });
});

describe('hybrid: one pool for in-house and platform drivers', () => {
  let ali, platformDriver;
  const postHybrid = (ref, dispatchType = 'hybrid') =>
    request(app).post('/api/restaurant/orders').set(bearer(restaurant)).send({
      source: 'Uber Eats', externalOrderId: ref, customerName: 'Anna T.', customerPhone: '+442033195035',
      deliveryAddress: '19 Rosemont Rd, Richmond', postcode: 'TW10 6QN', prepMinutes: 20, dispatchType, items: [],
    });
  const restaurantOrder = async (id) =>
    (await request(app).get('/api/restaurant/dashboard').set(bearer(restaurant))).body.orders.find((o) => o.id === id);

  before(async () => {
    await clearRuns();
    platformDriver = drivers[0];
    const login = await request(app).post('/api/auth/login').send({ email: 'ali@races.test', password: 'Passw0rd123' });
    ali = { token: login.body.tokens.accessToken };
    // In-house drivers need no GPS fix to see their restaurant's hybrid orders.
    const res = await request(app).put('/api/driver/availability').set(bearer(ali)).send({ online: true });
    assert.equal(res.status, 200, JSON.stringify(res.body));
  });

  test('a hybrid order needs the Hybrid delivery setting', async () => {
    await request(app).patch('/api/restaurant/policy').set(bearer(restaurant)).send({ driverPolicy: 'open_platform' });
    const res = await postHybrid('#Y0');
    assert.equal(res.status, 400);
    assert.match(JSON.stringify(res.body), /Hybrid/);
    await request(app).patch('/api/restaurant/policy').set(bearer(restaurant)).send({ driverPolicy: 'hybrid' });
  });

  test('both kinds of driver see a hybrid order; a platform-only order stays hidden from in-house drivers', async () => {
    const hybridId = (await postHybrid('#Y1')).body.order.id;
    const platformOnlyId = (await postHybrid('#Y2', 'open_platform')).body.order.id;
    assert.ok((await poolIds(ali)).includes(hybridId));
    assert.ok(!(await poolIds(ali)).includes(platformOnlyId));
    const seen = await poolIds(platformDriver);
    assert.ok(seen.includes(hybridId) && seen.includes(platformOnlyId));
    const shown = await restaurantOrder(hybridId);
    assert.equal(shown.hybrid, true);
    assert.equal(shown.assignedDriverType, undefined);
  });

  test('an in-house driver who accepts it makes it an in-house delivery, shown as "your driver"', async () => {
    const id = (await postHybrid('#Y3')).body.order.id;
    const res = await request(app).post(`/api/driver/pool/${id}/add`).set(bearer(ali));
    assert.equal(res.body.ok, true, res.body.message);
    const row = await orderRow(id);
    assert.equal(row.dispatch_type, 'own_driver');
    assert.equal(Number(row.restaurant_fee_gbp), 0);
    assert.equal(Number(row.driver_payout_gbp), 0);
    assert.ok(!(await poolIds(platformDriver)).includes(id), 'gone from the pool');
    const late = await request(app).post(`/api/driver/pool/${id}/add`).set(bearer(platformDriver));
    assert.equal(late.body.ok, false);
    const shown = await restaurantOrder(id);
    assert.equal(shown.assignedDriverType, 'restaurant_own');
    assert.equal(shown.assignedDriverName, 'Ali Khan');
  });

  test('a platform driver who accepts it is paid as usual, shown as "platform driver"', async () => {
    const id = (await postHybrid('#Y4')).body.order.id;
    const res = await request(app).post(`/api/driver/pool/${id}/add`).set(bearer(platformDriver));
    assert.equal(res.body.ok, true, res.body.message);
    const row = await orderRow(id);
    assert.equal(row.dispatch_type, 'open_platform');
    assert.ok(Number(row.restaurant_fee_gbp) > 0 && Number(row.driver_payout_gbp) > 0);
    assert.equal((await restaurantOrder(id)).assignedDriverType, 'platform_contracted');
  });

  test('an in-house driver cannot take a platform-only order', async () => {
    const id = (await postHybrid('#Y5', 'open_platform')).body.order.id;
    const res = await request(app).post(`/api/driver/pool/${id}/add`).set(bearer(ali));
    assert.equal(res.body.ok, false);
    assert.equal((await orderRow(id)).assigned_driver_id, null);
  });
});
