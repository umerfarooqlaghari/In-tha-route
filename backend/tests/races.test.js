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

/** Posts an order while every driver is offline, so it waits in the pool. */
async function poolOrder(ref) {
  await pool.query(`UPDATE driver_profiles SET status = 'offline' WHERE driver_type = 'platform_contracted'`);
  const res = await request(app).post('/api/restaurant/orders').set(bearer(restaurant)).send({
    source: 'Deliveroo', externalOrderId: ref, customerName: 'Anna T.', customerPhone: '+442033195035',
    deliveryAddress: '19 Rosemont Rd, Richmond', postcode: 'TW10 6QN', prepMinutes: 20,
    dispatchType: 'open_platform', items: [],
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  await new Promise((r) => setTimeout(r, 30)); // let the post-order offer round finish
  await pool.query(`UPDATE driver_profiles SET status = 'approved_online' WHERE driver_type = 'platform_contracted'`);
  return res.body.order.id;
}

async function clearRuns() {
  await pool.query(`UPDATE orders SET status = 'delivered', delivered_at = now() WHERE status <> 'delivered'`);
  await pool.query(`UPDATE batches SET status = 'completed', acknowledged = true WHERE status IN ('offered', 'accepted', 'completed')`);
  await pool.query('DELETE FROM batch_declines');
}

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

  test('offers built for 5 drivers at once never put one order in two batches', async () => {
    for (let round = 0; round < 10; round++) {
      await clearRuns();
      const ids = [await poolOrder(`#O${round}a`)];
      // Every driver's app refreshes at the same moment (each refresh builds an offer).
      await Promise.all(drivers.map((d) => request(app).get('/api/driver/dashboard').set(bearer(d))));
      const { rows } = await pool.query(
        `SELECT o.id, o.batch_id, b.driver_id FROM orders o JOIN batches b ON b.id = o.batch_id WHERE o.id = ANY($1::uuid[])`,
        [ids]
      );
      assert.equal(rows.length, 1, `round ${round}: order is in exactly one batch`);
      const offered = await pool.query(`SELECT count(*)::int AS n FROM batches WHERE status = 'offered'`);
      assert.equal(offered.rows[0].n, 1, `round ${round}: only one driver holds an offer for it`);
    }
  });

  test('accept and expiry at the same moment: the result is always consistent', async () => {
    for (let round = 0; round < 10; round++) {
      await clearRuns();
      const orderId = await poolOrder(`#E${round}`);
      const d = drivers[0];
      await request(app).get('/api/driver/dashboard').set(bearer(d));
      // Exactly at the time limit (inside the 15 s grace for a tap already on its way).
      await pool.query(`UPDATE batches SET created_at = now() - interval '121 seconds' WHERE status = 'offered'`);
      const [acceptRes] = await Promise.all([
        request(app).post('/api/driver/batch/accept').set(bearer(d)),
        dispatch.expireStaleOffers(),
      ]);
      const { rows } = await pool.query(
        'SELECT o.batch_id, b.status FROM orders o LEFT JOIN batches b ON b.id = o.batch_id WHERE o.id = $1',
        [orderId]
      );
      if (acceptRes.status === 200) {
        assert.equal(rows[0].status, 'accepted', `round ${round}: accepted order stays with the driver`);
      } else {
        assert.equal(acceptRes.status, 409);
        assert.equal(rows[0].batch_id, null, `round ${round}: withdrawn order is back in the pool`);
      }
    }
  });

  test('a driver whose app refreshes twice at once still gets only one offer', async () => {
    await clearRuns();
    await poolOrder('#D1');
    await poolOrder('#D2');
    const d = drivers[1];
    await Promise.all([1, 2, 3].map(() => request(app).get('/api/driver/dashboard').set(bearer(d))));
    const { rows } = await pool.query(`SELECT count(*)::int AS n FROM batches WHERE driver_id = $1 AND status = 'offered'`, [d.id]);
    assert.equal(rows[0].n, 1);
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
    // ...so the 2-minute offer timeout never takes it away.
    await pool.query(`UPDATE batches SET created_at = now() - interval '10 minutes' WHERE driver_id = $1`, [drivers[2].id]);
    await dispatch.expireStaleOffers();
    assert.equal((await orderRow(orderId)).status, 'driver_assigned');
  });

  test('pool "Add" waits for an offer being built instead of wrongly saying "taken"', async () => {
    await clearRuns();
    const orderId = await poolOrder('#P2');
    await pool.query(`UPDATE driver_profiles SET status = 'offline' WHERE id <> $1`, [drivers[3].id]);
    // Hold the order's lock as if an offer were half-way through being built, then let it go
    // without taking the order (e.g. the driver was out of range).
    const holder = await pool.connect();
    await holder.query('BEGIN');
    await holder.query('SELECT 1 FROM orders WHERE id = $1 FOR UPDATE', [orderId]);
    const adding = request(app).post(`/api/driver/pool/${orderId}/add`).set(bearer(drivers[3])).then((r) => r);
    await new Promise((r) => setTimeout(r, 150));
    await holder.query('ROLLBACK');
    holder.release();
    const res = await adding;
    assert.equal(res.body.ok, true, res.body.message);
    await pool.query(`UPDATE driver_profiles SET status = 'approved_online' WHERE driver_type = 'platform_contracted'`);
  });

  test('going offline hands an unanswered offer straight back to the pool', async () => {
    await clearRuns();
    const orderId = await poolOrder('#F1');
    const d = drivers[4];
    // Only this driver is online, so nobody else picks the order up the moment it is released.
    await pool.query(`UPDATE driver_profiles SET status = 'offline' WHERE id <> $1`, [d.id]);
    await request(app).get('/api/driver/dashboard').set(bearer(d));
    assert.equal((await orderRow(orderId)).assigned_driver_id, d.id);
    const res = await request(app).put('/api/driver/availability').set(bearer(d)).send({ online: false });
    assert.equal(res.status, 200);
    const o = await orderRow(orderId);
    assert.equal(o.batch_id, null);
    assert.equal(o.status, 'preparing');
    // Not counted as a decline: they can get it again once back online.
    const declines = await pool.query('SELECT count(*)::int AS n FROM batch_declines WHERE driver_id = $1', [d.id]);
    assert.equal(declines.rows[0].n, 0);
    await pool.query(`UPDATE driver_profiles SET status = 'approved_online' WHERE driver_type = 'platform_contracted'`);
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
    // It is offered straight away to another online driver, never back to the first one.
    await new Promise((r) => setTimeout(r, 100));
    await request(app).get('/api/driver/dashboard').set(bearer(first));
    const o = await orderRow(a);
    assert.notEqual(o.assigned_driver_id, null);
    assert.notEqual(o.assigned_driver_id, first.id);
    assert.equal(o.status, 'batched_offered');
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
