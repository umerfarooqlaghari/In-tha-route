const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-1234';
process.env.BCRYPT_ROUNDS = '4';
process.env.PUSH_DISABLED = 'true';
delete process.env.GOOGLE_MAPS_API_KEY;

const { startTestDatabase } = require('./helpers/testDb');

// The restaurant sits in East Sheen; every postcode lookup lands there.
const SHOP = { latitude: 51.4613, longitude: -0.265 };
const MILES_PER_DEGREE_LAT = 69.09;
const realFetch = global.fetch;
global.fetch = async (url, init) => {
  if (String(url).startsWith('https://api.postcodes.io/postcodes/')) {
    return new Response(JSON.stringify({ result: SHOP }), { status: 200 });
  }
  return realFetch(url, init);
};

let stopDb, app, pool, admin, merchant, driver;
const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const ADMIN = { email: 'owner@radius.test', password: 'AdminPass123' };

/** A point this many miles due south of the shop. */
const milesSouth = (miles) => ({ latitude: SHOP.latitude - miles / MILES_PER_DEGREE_LAT, longitude: SHOP.longitude });

const setRadius = (miles) =>
  request(app).put('/api/admin/pricing').set(bearer(admin)).send({ offerRadiusMiles: miles });
const moveDriver = (where) => request(app).put('/api/driver/location').set(bearer(driver)).send(where);
const driverView = async () => (await request(app).get('/api/driver/dashboard').set(bearer(driver))).body;
const seesOrder = async (id) => (await driverView()).orders.some((o) => o.id === id);
const seesOrderById = seesOrder;

let orderId;

before(async () => {
  stopDb = await startTestDatabase();
  app = require('../src/app');
  ({ pool } = require('../src/config/db'));
  await require('../src/db/migrate').runMigrations(pool, () => {});
  await require('../src/db/seedAdmin').seedAdmin(pool, { ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password }, () => {});
  admin = (await request(app).post('/api/auth/login').send(ADMIN)).body.tokens.accessToken;

  const m = await request(app).post('/api/auth/signup').send({
    role: 'restaurant', email: 'shop@radius.test', password: 'Passw0rd123', fullName: 'Shop Staff',
    phone: '020 8940 5561', restaurantName: 'Sheen Kitchen', address: '1 Upper Richmond Rd W', postcode: 'SW14 8AA',
  });
  merchant = m.body.tokens.accessToken;
  await pool.query('UPDATE restaurants SET latitude = $1, longitude = $2', [SHOP.latitude, SHOP.longitude]);

  const d = await request(app).post('/api/auth/signup').send({
    role: 'driver', email: 'rider@radius.test', password: 'Passw0rd123', fullName: 'Radius Rider',
    phone: '+44 7841 940001', vehicle: 'Car', plateNumber: 'RA12 DUS',
  });
  driver = d.body.tokens.accessToken;
  await pool.query(`UPDATE driver_profiles SET status = 'approved_online'`);

  const o = await request(app).post('/api/restaurant/orders').set(bearer(merchant)).send({
    source: 'Deliveroo', externalOrderId: '#RAD1', customerName: 'Anna T.', customerPhone: '+442033195035',
    deliveryAddress: '19 Rosemont Rd, Richmond', postcode: 'TW10 6QN', prepMinutes: 20, dispatchType: 'open_platform', items: [],
  });
  assert.equal(o.status, 201, JSON.stringify(o.body));
  orderId = o.body.order?.id ?? o.body.dashboard.orders[0].id;
});

after(async () => {
  global.fetch = realFetch;
  if (pool) await pool.end();
  if (stopDb) await stopDb();
});

test('whatever radius the admin sets, a driver sees the order exactly when they are within it', async () => {
  // Keep the order in the pool for the whole test.
  await pool.query(`UPDATE orders SET pool_expires_at = now() + interval '1 hour'`);
  const radii = [0.5, 1, 3, 5.5, 8.5, 12, 20];
  const distances = [0.3, 0.9, 2.5, 4, 5.8, 8.4, 8.6, 11, 15, 19.5, 25];
  for (const radius of radii) {
    assert.equal((await setRadius(radius)).status, 200);
    for (const miles of distances) {
      await moveDriver(milesSouth(miles));
      assert.equal(await seesOrder(orderId), miles <= radius, `radius ${radius} mi, driver ${miles} mi away`);
    }
  }
});

test('the client case: radius 8.5 miles, driver in Hanworth about 5.8 miles from East Sheen', async () => {
  await setRadius(8.5);
  await moveDriver({ latitude: 51.4335, longitude: -0.3887 }); // Hanworth
  const view = await driverView();
  assert.equal(view.capacity.poolBlockedBy, null);
  assert.ok(view.orders.some((o) => o.id === orderId));
});

test('a position never times out: an hours-old position still shows the pool', async () => {
  await moveDriver(milesSouth(1));
  await pool.query(`UPDATE driver_profiles SET last_location_at = now() - interval '6 hours'`);
  const view = await driverView();
  assert.equal(view.capacity.poolBlockedBy, null);
  assert.ok(view.orders.some((o) => o.id === orderId));
});

test('location is off only when the driver turns it off, and back on when they turn it on', async () => {
  await moveDriver(milesSouth(1));
  assert.equal((await request(app).delete('/api/driver/location').set(bearer(driver))).status, 204);
  const view = await driverView();
  assert.equal(view.capacity.poolBlockedBy, 'no_location');
  assert.ok(!view.orders.some((o) => o.id === orderId));
  // Still online: only the driver changes that.
  const { rows } = await pool.query('SELECT status FROM driver_profiles');
  assert.equal(rows[0].status, 'approved_online');
  await moveDriver(milesSouth(1));
  assert.equal(await seesOrder(orderId), true);
});

test('with "No distance limit" on, a platform driver sees the order from any distance, even with location off', async () => {
  await pool.query(`UPDATE orders SET pool_expires_at = now() + interval '1 hour'`);
  await setRadius(0.5);
  const on = await request(app).put('/api/admin/pricing').set(bearer(admin)).send({ noDistanceLimit: true });
  assert.equal(on.status, 200, JSON.stringify(on.body));
  for (const miles of [0.3, 8.6, 25, 150]) {
    await moveDriver(milesSouth(miles));
    assert.equal(await seesOrder(orderId), true, `driver ${miles} mi away`);
  }
  // Location off: still sees it, and can take it.
  await request(app).delete('/api/driver/location').set(bearer(driver));
  const view = await driverView();
  assert.equal(view.capacity.poolBlockedBy, null);
  assert.ok(view.orders.some((o) => o.id === orderId));

  // Switching it back on uses the miles again (still 0.5).
  await request(app).put('/api/admin/pricing').set(bearer(admin)).send({ noDistanceLimit: false });
  assert.equal((await driverView()).capacity.poolBlockedBy, 'no_location');
  await moveDriver(milesSouth(8.6));
  assert.equal(await seesOrder(orderId), false);
  await moveDriver(milesSouth(0.3));
  assert.equal(await seesOrder(orderId), true);
});

test('each pool order shows how far the driver is from the restaurant, to 0.1 mi', async () => {
  await pool.query(`UPDATE orders SET pool_expires_at = now() + interval '1 hour'`);
  await request(app).put('/api/admin/pricing').set(bearer(admin)).send({ noDistanceLimit: true });
  const awayFor = async () => (await driverView()).orders.find((o) => o.id === orderId).pickupMilesAway;

  for (const miles of [0.4, 5, 12.6]) {
    await moveDriver(milesSouth(miles));
    assert.equal(await awayFor(), miles, `driver ${miles} mi south`);
  }
  // A driver in Karachi is thousands of miles away, not the order's delivery trip.
  await moveDriver({ latitude: 24.8607, longitude: 67.0011 });
  const away = await awayFor();
  assert.ok(away > 3900 && away < 4000, `Karachi to East Sheen: ${away} mi`);
  // No location: no distance to show.
  await request(app).delete('/api/driver/location').set(bearer(driver));
  assert.equal(await awayFor(), null);
  await request(app).put('/api/admin/pricing').set(bearer(admin)).send({ noDistanceLimit: false });
});

test('the merchant\'s live riders include every online platform driver, without contact details', async () => {
  const shopView = async () =>
    (await request(app).get('/api/restaurant/dashboard').set(bearer(merchant))).body.platformRiders;

  await moveDriver(milesSouth(2));
  let riders = await shopView();
  assert.equal(riders.length, 1);
  assert.equal(riders[0].name, 'Radius R.');
  assert.equal(riders[0].isOnline, true);
  assert.equal(riders[0].location.latitude, milesSouth(2).latitude);
  assert.equal(riders[0].email, undefined);
  assert.equal(riders[0].phone, undefined);

  // Location off: still listed as online, with no position.
  await request(app).delete('/api/driver/location').set(bearer(driver));
  riders = await shopView();
  assert.equal(riders[0].location, null);

  // Offline: gone from the list.
  await request(app).put('/api/driver/availability').set(bearer(driver)).send({ online: false });
  assert.deepEqual(await shopView(), []);
  await request(app).put('/api/driver/availability').set(bearer(driver)).send({ online: true });
  assert.equal((await shopView()).length, 1);
});

test('"No distance limit" must be true or false', async () => {
  const res = await request(app).put('/api/admin/pricing').set(bearer(admin)).send({ noDistanceLimit: 'yes' });
  assert.equal(res.status, 400);
});

test('an order whose pool time has run out is no longer shown, at any radius', async () => {
  await setRadius(20);
  await moveDriver(milesSouth(1));
  await pool.query(`UPDATE orders SET pool_expires_at = now() - interval '1 second'`);
  assert.equal(await seesOrder(orderId), false);
});

describe('pool time set by the admin and the merchant', () => {
  let id;
  const secondsLeft = async () =>
    (await pool.query(`SELECT extract(epoch FROM pool_expires_at - now())::float AS s FROM orders WHERE id = $1`, [id])).rows[0].s;
  const near = (actual, expected) => assert.ok(Math.abs(actual - expected) < 3, `expected ~${expected}s, got ${actual}s`);
  const setPolicy = (body) => request(app).patch('/api/restaurant/policy').set(bearer(merchant)).send(body);

  before(async () => {
    await request(app).put('/api/admin/pricing').set(bearer(admin)).send({ noDistanceLimit: true });
    const o = await request(app).post('/api/restaurant/orders').set(bearer(merchant)).send({
      source: 'Deliveroo', externalOrderId: '#POOLTIME', customerName: 'Ben T.', customerPhone: '+442033195036',
      deliveryAddress: '20 Rosemont Rd, Richmond', postcode: 'TW10 6QN', prepMinutes: 20, dispatchType: 'open_platform', items: [],
    });
    assert.equal(o.status, 201, JSON.stringify(o.body));
    id = o.body.order?.id ?? o.body.dashboard.orders.find((x) => x.externalOrderId === '#POOLTIME').id;
  });

  test('a new order gets the standard 2 minutes', async () => {
    near(await secondsLeft(), 120);
  });

  test('the admin changes the standard time: orders in the pool follow it at once', async () => {
    const res = await request(app).put('/api/admin/pricing').set(bearer(admin)).send({ poolWindowSeconds: 300 });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    near(await secondsLeft(), 300);
    const shop = (await request(app).get('/api/restaurant/dashboard').set(bearer(merchant))).body;
    assert.equal(shop.algorithm.poolWindowSeconds, 300);
    assert.equal(shop.restaurants[0].poolWindowSeconds, null);
  });

  test('the merchant sets its own time: its orders follow it, and the admin\'s changes no longer apply to them', async () => {
    assert.equal((await setPolicy({ poolWindowSeconds: 60 })).status, 200);
    near(await secondsLeft(), 60);
    await request(app).put('/api/admin/pricing').set(bearer(admin)).send({ poolWindowSeconds: 600 });
    near(await secondsLeft(), 60);
    const shop = (await request(app).get('/api/restaurant/dashboard').set(bearer(merchant))).body;
    assert.equal(shop.restaurants[0].poolWindowSeconds, 60);
  });

  test('"Find drivers again" starts the merchant\'s own time again', async () => {
    await pool.query(`UPDATE orders SET pool_expires_at = now() - interval '1 second' WHERE id = $1`, [id]);
    assert.equal((await request(app).post(`/api/restaurant/orders/${id}/find-drivers`).set(bearer(merchant))).status, 200);
    near(await secondsLeft(), 60);
  });

  test('back to the standard time, and a shorter time can end the window at once', async () => {
    assert.equal((await setPolicy({ poolWindowSeconds: null })).status, 200);
    near(await secondsLeft(), 600);
    // 50 seconds into its window, the standard time drops to 30 seconds: the window is over.
    await pool.query(`UPDATE orders SET pool_expires_at = now() + interval '550 seconds' WHERE id = $1`, [id]);
    await request(app).put('/api/admin/pricing').set(bearer(admin)).send({ poolWindowSeconds: 30 });
    assert.ok((await secondsLeft()) < 0, 'the window has already run out');
    assert.equal(await seesOrderById(id), false);
  });

  test('pool times outside 30 s to 30 min are refused', async () => {
    assert.equal((await setPolicy({ poolWindowSeconds: 20 })).status, 400);
    assert.equal((await request(app).put('/api/admin/pricing').set(bearer(admin)).send({ poolWindowSeconds: 3600 })).status, 400);
    assert.equal((await setPolicy({})).status, 400);
  });

  test('a new order rings each driver 3 times, 5 seconds apart, and stops once it is taken', async () => {
    const push = require('../src/services/push.service');
    const pause = (ms) => new Promise((r) => setTimeout(r, ms));
    const real = push.newOrderNearby;
    // Let rings started by earlier tests finish first.
    await pause(11_000);
    let rings = 0;
    push.newOrderNearby = async () => { rings += 1; };
    try {
      await request(app).put('/api/admin/pricing').set(bearer(admin)).send({ poolWindowSeconds: 300 });
      await moveDriver(milesSouth(1));
      await request(app).post(`/api/restaurant/orders/${id}/find-drivers`).set(bearer(merchant));
      await pause(500);
      assert.equal(rings, 1);
      await pause(11_000);
      assert.equal(rings, 3);

      // Taken after the first ring: no more rings.
      rings = 0;
      await request(app).post(`/api/restaurant/orders/${id}/find-drivers`).set(bearer(merchant));
      await pause(500);
      assert.equal(rings, 1);
      const took = await request(app).post(`/api/driver/pool/${id}/add`).set(bearer(driver));
      assert.equal(took.body.ok, true, JSON.stringify(took.body));
      await pause(6_000);
      assert.equal(rings, 1);
    } finally {
      push.newOrderNearby = real;
    }
  });
});
