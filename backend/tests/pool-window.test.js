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

let stopDb, app, pool, restaurant, other;
const drivers = [];
const bearer = (who) => ({ Authorization: `Bearer ${who.token}` });

async function signupDriver(n) {
  const res = await request(app).post('/api/auth/signup').send({
    role: 'driver', email: `pw${n}@pool.test`, password: 'Passw0rd123', fullName: `Pool ${n}`,
    phone: `+44 7841 91000${n}`, vehicle: 'Car', plateNumber: `PW${n}3 ABC`,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { token: res.body.tokens.accessToken, id: res.body.user.driver.id };
}

const post = async (who, ref, dispatchType = 'open_platform', extra = {}) => {
  const res = await request(app).post('/api/restaurant/orders').set(bearer(who)).send({
    source: 'Deliveroo', externalOrderId: ref, customerName: 'Anna T.', customerPhone: '+442033195035',
    deliveryAddress: '19 Rosemont Rd, Richmond', postcode: 'TW10 6QN', prepMinutes: 20, dispatchType, items: [],
    ...extra,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body.order;
};
const expire = (id) => pool.query(`UPDATE orders SET pool_expires_at = now() - interval '1 second' WHERE id = $1`, [id]);
const poolOf = async (who) =>
  (await request(app).get('/api/driver/dashboard').set(bearer(who))).body.orders.filter((o) => !o.batchId);
const restaurantOrder = async (id) =>
  (await request(app).get('/api/restaurant/dashboard').set(bearer(restaurant))).body.orders.find((o) => o.id === id);

before(async () => {
  stopDb = await startTestDatabase();
  app = require('../src/app');
  ({ pool } = require('../src/config/db'));
  await require('../src/db/migrate').runMigrations(pool, () => {});
  const mk = async (name, email, postcode) =>
    (await request(app).post('/api/auth/signup').send({
      role: 'restaurant', email, password: 'Passw0rd123', fullName: `${name} Staff`,
      phone: '020 8940 5521', restaurantName: name, address: '5 The Square, Richmond', postcode,
    })).body.tokens.accessToken;
  restaurant = { token: await mk('Saffron', 'saffron@pool.test', 'TW9 1DT') };
  other = { token: await mk('Other', 'other@pool.test', 'TW9 1DT') };
  for (let n = 1; n <= 2; n++) drivers.push(await signupDriver(n));
  await pool.query(
    `UPDATE driver_profiles SET status = 'approved_online', last_latitude = 51.462, last_longitude = -0.304,
            last_location_at = now() WHERE driver_type = 'platform_contracted'`
  );
});

after(async () => {
  global.fetch = realFetch;
  if (pool) await pool.end();
  if (stopDb) await stopDb();
});

describe('the 2-minute window in the pool', () => {
  test('a pool order shows its time left to the driver and the merchant; a direct order has none', async () => {
    const o = await post(restaurant, '#W1');
    assert.ok(o.poolSecondsLeft > 110 && o.poolSecondsLeft <= 120, `got ${o.poolSecondsLeft}`);
    const seen = (await poolOf(drivers[0])).find((x) => x.id === o.id);
    assert.ok(seen.poolSecondsLeft > 110 && seen.poolSecondsLeft <= 120);

    const own = await request(app).post('/api/restaurant/drivers').set(bearer(restaurant)).send({
      fullName: 'Own Rider', email: 'own@pool.test', password: 'Passw0rd123', phone: '+44 7841 910099', vehicle: 'Car',
    });
    assert.equal(own.status, 201, JSON.stringify(own.body));
    const ownId = own.body.dashboard.drivers.find((d) => d.email === 'own@pool.test').id;
    const direct = await post(restaurant, '#W1b', 'own_driver', { ownDriverId: ownId });
    assert.equal(direct.poolSecondsLeft, undefined);
  });

  test('when it runs out the order leaves every driver\'s pool and cannot be accepted', async () => {
    const o = await post(restaurant, '#W2');
    await expire(o.id);
    for (const d of drivers) assert.ok(!(await poolOf(d)).some((x) => x.id === o.id));
    assert.equal((await restaurantOrder(o.id)).poolSecondsLeft, 0, 'the merchant sees it ran out');
    const res = await request(app).post(`/api/driver/pool/${o.id}/add`).set(bearer(drivers[0]));
    assert.equal(res.body.ok, false);
    assert.equal(res.body.message, 'This order has left the pool.');
  });

  test('an order put back in the pool by the admin gets a new window', async () => {
    const o = await post(restaurant, '#W3');
    await request(app).post(`/api/driver/pool/${o.id}/add`).set(bearer(drivers[0]));
    const ADMIN = { email: 'owner@pool.test', password: 'AdminPass123' };
    await require('../src/db/seedAdmin').seedAdmin(pool, { ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password }, () => {});
    const admin = { token: (await request(app).post('/api/auth/login').send(ADMIN)).body.tokens.accessToken };
    const res = await request(app).post(`/api/admin/orders/${o.id}/release`).set(bearer(admin));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const back = await restaurantOrder(o.id);
    assert.ok(back.poolSecondsLeft > 110, `got ${back.poolSecondsLeft}`);
    await pool.query(`UPDATE orders SET status = 'delivered' WHERE id = $1`, [o.id]);
  });
});

describe('a driver rejecting a pool order', () => {
  test('hides it from that driver only', async () => {
    const o = await post(restaurant, '#R1');
    const res = await request(app).post(`/api/driver/pool/${o.id}/reject`).set(bearer(drivers[0]));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(!(await poolOf(drivers[0])).some((x) => x.id === o.id));
    assert.ok((await poolOf(drivers[1])).some((x) => x.id === o.id));
    const taken = await request(app).post(`/api/driver/pool/${o.id}/add`).set(bearer(drivers[1]));
    assert.equal(taken.body.ok, true);
  });
});

describe('"Find drivers again" and giving the order to your own driver', () => {
  test('find again puts it back for everyone, including drivers who rejected it, with a new window', async () => {
    const o = await post(restaurant, '#F1');
    await request(app).post(`/api/driver/pool/${o.id}/reject`).set(bearer(drivers[0]));
    await expire(o.id);
    const res = await request(app).post(`/api/restaurant/orders/${o.id}/find-drivers`).set(bearer(restaurant));
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const back = res.body.dashboard.orders.find((x) => x.id === o.id);
    assert.ok(back.poolSecondsLeft > 110, `got ${back.poolSecondsLeft}`);
    for (const d of drivers) assert.ok((await poolOf(d)).some((x) => x.id === o.id));
    const taken = await request(app).post(`/api/driver/pool/${o.id}/add`).set(bearer(drivers[0]));
    assert.equal(taken.body.ok, true);
  });

  test('it cannot be done for an order that has a driver, or for another merchant\'s order', async () => {
    const o = await post(restaurant, '#F2');
    await request(app).post(`/api/driver/pool/${o.id}/add`).set(bearer(drivers[1]));
    const res = await request(app).post(`/api/restaurant/orders/${o.id}/find-drivers`).set(bearer(restaurant));
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'ORDER_NOT_WAITING');
    const mine = await post(restaurant, '#F3');
    const theirs = await request(app).post(`/api/restaurant/orders/${mine.id}/find-drivers`).set(bearer(other));
    assert.equal(theirs.status, 404);
  });

  test('an order nobody took can be given to one of your own drivers', async () => {
    const dash = (await request(app).get('/api/restaurant/dashboard').set(bearer(restaurant))).body;
    const ownId = dash.drivers.find((d) => d.email === 'own@pool.test').id;
    const o = await post(restaurant, '#A1');
    await expire(o.id);
    const res = await request(app)
      .post(`/api/restaurant/orders/${o.id}/assign-driver`).set(bearer(restaurant)).send({ ownDriverId: ownId });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    const now = res.body.dashboard.orders.find((x) => x.id === o.id);
    assert.equal(now.dispatchType, 'own_driver');
    assert.equal(now.assignedDriverId, ownId);
    assert.equal(now.status, 'driver_assigned');
    assert.equal(now.poolSecondsLeft, undefined);
    for (const d of drivers) assert.ok(!(await poolOf(d)).some((x) => x.id === o.id));

    const again = await request(app)
      .post(`/api/restaurant/orders/${o.id}/assign-driver`).set(bearer(restaurant)).send({ ownDriverId: ownId });
    assert.equal(again.status, 409);
  });

  test('another merchant\'s driver cannot be used', async () => {
    const stranger = await request(app).post('/api/restaurant/drivers').set(bearer(other)).send({
      fullName: 'Stranger', email: 'stranger@pool.test', password: 'Passw0rd123', phone: '+44 7841 910098', vehicle: 'Car',
    });
    const strangerId = stranger.body.dashboard.drivers.find((d) => d.email === 'stranger@pool.test').id;
    const o = await post(restaurant, '#A2');
    await expire(o.id);
    const res = await request(app)
      .post(`/api/restaurant/orders/${o.id}/assign-driver`).set(bearer(restaurant)).send({ ownDriverId: strangerId });
    assert.equal(res.status, 400);
  });
});
