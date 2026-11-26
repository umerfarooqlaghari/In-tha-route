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

let stopDb, app, pool, mine, other;
const bearer = (token) => ({ Authorization: `Bearer ${token}` });

const post = async (token, ref, source, items, total) => {
  const res = await request(app).post('/api/restaurant/orders').set(bearer(token)).send({
    source, externalOrderId: ref, customerName: 'Anna T.', customerPhone: '+442033195035',
    deliveryAddress: '19 Rosemont Rd, Richmond', postcode: 'TW10 6QN', prepMinutes: 20,
    dispatchType: 'open_platform', items, orderTotalGbp: total,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.order;
};
const deliver = (id, minutesAgo = 0) =>
  pool.query(
    `UPDATE orders SET status = 'delivered', delivered_at = now() - make_interval(mins => $2),
            picked_up_at = now() - make_interval(mins => $2 + 12) WHERE id = $1`,
    [id, minutesAgo]
  );

before(async () => {
  stopDb = await startTestDatabase();
  app = require('../src/app');
  ({ pool } = require('../src/config/db'));
  await require('../src/db/migrate').runMigrations(pool, () => {});
  const mk = async (name, email) =>
    (await request(app).post('/api/auth/signup').send({
      role: 'restaurant', email, password: 'Passw0rd123', fullName: `${name} Staff`,
      phone: '020 8940 5521', restaurantName: name, address: '5 The Square, Richmond', postcode: 'TW9 1DT',
    })).body.tokens.accessToken;
  mine = await mk('Insight Kitchen', 'insight@r.test');
  other = await mk('Other Kitchen', 'other@r.test');

  const a = await post(mine, '#H1', 'Deliveroo', [{ quantity: 2, name: 'Biryani', price: 9 }], 18);
  const b = await post(mine, '#H2', 'Uber Eats', [{ quantity: 1, name: 'Naan', price: 3 }, { quantity: 1, name: 'Biryani', price: 9 }], 12);
  await post(mine, '#H3', 'Deliveroo', [], 30); // still live
  const c = await post(mine, '#H4', 'Just Eat', [], 9);
  await pool.query(`UPDATE orders SET status = 'cancelled' WHERE id = $1`, [c.id]);
  await deliver(a.id);
  await deliver(b.id, 1);
  const x = await post(other, '#X1', 'Deliveroo', [], 50);
  await deliver(x.id);
});

after(async () => {
  global.fetch = realFetch;
  await pool?.end();
  await stopDb?.();
});

describe('merchant past orders', () => {
  test('only this merchant’s delivered orders, newest first, with totals', async () => {
    const res = await request(app).get('/api/restaurant/history').set(bearer(mine));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body.orders.map((o) => o.externalOrderId).sort(), ['#H1', '#H2']);
    assert.deepEqual(res.body.totals, { orders: 2, salesGbp: 30, feesGbp: res.body.totals.feesGbp });
    const o = res.body.orders[0];
    assert.equal(o.status, 'delivered');
    assert.equal(o.deliveryMinutes, 12);
    assert.ok(o.deliveredLabel.startsWith('Today'));
    assert.equal(o.driverPayoutGbp, 0); // never what the driver is paid
    assert.equal(res.body.nextBefore, null);
  });

  test('pages with before', async () => {
    const first = await request(app).get('/api/restaurant/history?limit=1').set(bearer(mine));
    assert.equal(first.body.orders.length, 1);
    assert.ok(first.body.nextBefore);
    const next = await request(app)
      .get(`/api/restaurant/history?limit=1&before=${encodeURIComponent(first.body.nextBefore)}`)
      .set(bearer(mine));
    assert.equal(next.body.orders.length, 1);
    assert.notEqual(next.body.orders[0].id, first.body.orders[0].id);
  });

  test('an order cancelled after the driver collected it is listed as cancelled; one cancelled before is not', async () => {
    const o = await post(mine, '#H6', 'Deliveroo', [{ quantity: 1, name: 'Korma', price: 11 }], 11);
    await pool.query(
      `UPDATE orders SET status = 'cancelled', picked_up_at = now() - interval '5 minutes', cancelled_at = now()
        WHERE id = $1`,
      [o.id]
    );
    const res = await request(app).get('/api/restaurant/history').set(bearer(mine));
    const top = res.body.orders[0];
    assert.equal(top.id, o.id, 'newest first, by when it finished');
    assert.equal(top.status, 'cancelled');
    assert.ok(top.cancelledAt);
    assert.equal(top.deliveredAt, null);
    assert.ok(top.finishedLabel.startsWith('Today'));
    assert.deepEqual(top.items, [{ quantity: 1, name: 'Korma', price: 11 }]);
    assert.ok(!res.body.orders.some((x) => x.externalOrderId === '#H4'), 'cancelled before collection');
    assert.equal(res.body.totals.orders, 2, 'totals count delivered orders only');
    await pool.query('DELETE FROM orders WHERE id = $1', [o.id]); // keeps the analytics below as they were
  });
});

describe('merchant analytics', () => {
  test('summary, days, hours, sources and top items', async () => {
    const res = await request(app).get('/api/restaurant/analytics?days=7').set(bearer(mine));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const { summary, daily, hours, topItems, drivers } = res.body;
    assert.equal(summary.orders, 2);
    assert.equal(summary.salesGbp, 30);
    assert.equal(summary.averageOrderGbp, 15);
    assert.equal(summary.cancelled, 1);
    assert.equal(summary.active, 1);
    assert.equal(summary.completionRate, 67);
    assert.equal(summary.deliveryMinutes, 12);
    assert.equal(daily.length, 7);
    assert.equal(daily[6].orders, 2);
    assert.equal(hours.length, 24);
    assert.equal(hours.reduce((n, h) => n + h.orders, 0), 2);
    assert.equal(res.body.sources, undefined); // only the merchant's own numbers
    assert.deepEqual(topItems[0], { name: 'Biryani', quantity: 3 });
    assert.equal(drivers.own + drivers.platform, 2);
  });

  test('orders their own drivers delivered are counted apart', async () => {
    const add = await request(app).post('/api/restaurant/drivers').set(bearer(mine)).send({
      fullName: 'Ali Khan', email: 'ali@insight.test', password: 'Passw0rd123', phone: '+44 7841 900099', vehicle: 'Car',
    });
    assert.equal(add.status, 201, JSON.stringify(add.body));
    await pool.query(
      `UPDATE orders SET assigned_driver_id = (SELECT d.id FROM driver_profiles d JOIN users u ON u.id = d.user_id
                                                WHERE u.email = 'ali@insight.test')
        WHERE external_order_id = '#H1'`
    );
    const { drivers } = (await request(app).get('/api/restaurant/analytics').set(bearer(mine))).body;
    assert.deepEqual(drivers, { own: 1, platform: 1 });
  });

  test('other periods, and a bad one is refused', async () => {
    assert.equal((await request(app).get('/api/restaurant/analytics?days=30').set(bearer(mine))).body.daily.length, 30);
    assert.equal((await request(app).get('/api/restaurant/analytics?days=90').set(bearer(mine))).body.daily.length, 90);
    assert.equal((await request(app).get('/api/restaurant/analytics?days=5').set(bearer(mine))).status, 400);
  });
});
