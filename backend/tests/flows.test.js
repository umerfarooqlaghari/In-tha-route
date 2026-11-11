const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-1234';
process.env.BCRYPT_ROUNDS = '4';
process.env.GOOGLE_MAPS_API_KEY = 'test-google-key';
delete process.env.PUSH_DISABLED;
delete process.env.S3_BUCKET;

const { startTestDatabase } = require('./helpers/testDb');

/* ---- Fake outside services (postcodes.io, Google, Expo push) ------------------------ */
const POSTCODES = {
  TW91DT: { latitude: 51.4613, longitude: -0.3037 }, // restaurant
  TW106QN: { latitude: 51.4545, longitude: -0.297 }, // customer
};
const DOOR = { lat: 51.45492, lng: -0.29811 }; // 19 Rosemont Rd
const calls = { geocode: [], routes: [], push: [] };
const deadTokens = new Set();
const realFetch = global.fetch;

const json = (body, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

global.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith('https://api.postcodes.io/postcodes/')) {
    const hit = POSTCODES[decodeURIComponent(u.split('/').pop())];
    return hit ? json({ result: hit }) : json({ error: 'Invalid postcode' }, 404);
  }
  if (u.startsWith('https://maps.googleapis.com/maps/api/geocode/json')) {
    const address = new URL(u).searchParams.get('address');
    calls.geocode.push(address);
    if (/Nowhere Lane/.test(address)) {
      // Google matched something far from the postcode: must be ignored.
      return json({ status: 'OK', results: [{ geometry: { location: { lat: 53.48, lng: -2.24 }, location_type: 'ROOFTOP' } }] });
    }
    return json({ status: 'OK', results: [{ geometry: { location: DOOR, location_type: 'ROOFTOP' } }] });
  }
  if (u === 'https://routes.googleapis.com/directions/v2:computeRoutes') {
    const body = JSON.parse(init.body);
    calls.routes.push(body);
    const stops = 2 + body.intermediates.length;
    return json({ routes: [{ distanceMeters: 1609.344 * 1.4 * (stops - 1), duration: `${420 * (stops - 1)}s`, polyline: { encodedPolyline: '_p~iF~ps|U_ulLnnqC' } }] });
  }
  if (u === 'https://exp.host/--/api/v2/push/send') {
    const messages = JSON.parse(init.body);
    calls.push.push(...messages);
    return json({
      data: messages.map((m) =>
        deadTokens.has(m.to)
          ? { status: 'error', message: 'not registered', details: { error: 'DeviceNotRegistered' } }
          : { status: 'ok', id: 'ticket' }
      ),
    });
  }
  return realFetch(url, init);
};

async function waitFor(check, what, ms = 3000) {
  const end = Date.now() + ms;
  while (Date.now() < end) {
    const value = check();
    if (value) return value;
    await new Promise((r) => setTimeout(r, 20));
  }
  throw new Error(`Timed out waiting for ${what}`);
}

/* ---- Setup -------------------------------------------------------------------------- */
let stopDb, app, pool;
const restaurant = {};
const driver = {};
const bearer = (who) => ({ Authorization: `Bearer ${who.token}` });
const RESTAURANT_PHONE = 'ExponentPushToken[restaurant-phone]';
const DRIVER_PHONE = 'ExponentPushToken[driver-phone]';

before(async () => {
  stopDb = await startTestDatabase();
  app = require('../src/app');
  ({ pool } = require('../src/config/db'));
  await require('../src/db/migrate').runMigrations(pool, () => {});

  let res = await request(app).post('/api/auth/signup').send({
    role: 'restaurant', email: 'saffron@flows.test', password: 'Passw0rd123', fullName: 'Saffron Staff',
    phone: '020 8940 5521', restaurantName: 'Saffron', address: '5 Dome Buildings The Square, Richmond', postcode: 'TW9 1DT',
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  Object.assign(restaurant, { token: res.body.tokens.accessToken, userId: res.body.user.id });

  res = await request(app).post('/api/auth/signup').send({
    role: 'driver', email: 'rider@flows.test', password: 'Passw0rd123', fullName: 'Gustavo Oliveira',
    phone: '+44 7841 902145', vehicle: 'Car', plateNumber: 'LR23 KXM',
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  Object.assign(driver, { token: res.body.tokens.accessToken, userId: res.body.user.id, id: res.body.user.driver.id });
  // Documents approved (the KYC flow has its own tests).
  await pool.query(`UPDATE driver_profiles SET status = 'offline' WHERE id = $1`, [driver.id]);
});

after(async () => {
  await new Promise((r) => setTimeout(r, 100)); // let fire-and-forget pushes finish
  global.fetch = realFetch;
  if (pool) await pool.end();
  if (stopDb) await stopDb();
});

/* ---- Tests -------------------------------------------------------------------------- */
describe('push tokens', () => {
  test('only Expo tokens are accepted', async () => {
    const res = await request(app).put('/api/auth/push-token').set(bearer(driver)).send({ token: 'not-a-token' });
    assert.equal(res.status, 400);
  });

  test('each phone registers its token', async () => {
    for (const [who, token, platform] of [[driver, DRIVER_PHONE, 'ios'], [restaurant, RESTAURANT_PHONE, 'android']]) {
      const res = await request(app).put('/api/auth/push-token').set(bearer(who)).send({ token, platform });
      assert.equal(res.status, 204);
    }
    const { rows } = await pool.query('SELECT token, user_id, platform FROM push_tokens ORDER BY token');
    assert.deepEqual(rows.map((r) => [r.token, r.user_id, r.platform]), [
      [DRIVER_PHONE, driver.userId, 'ios'],
      [RESTAURANT_PHONE, restaurant.userId, 'android'],
    ]);
  });
});

describe('order → open pool → delivery', () => {
  let orderId;

  test('the driver goes online at a known position', async () => {
    let res = await request(app).put('/api/driver/availability').set(bearer(driver)).send({ online: true });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    res = await request(app).put('/api/driver/location').set(bearer(driver)).send({ latitude: 51.46, longitude: -0.31 });
    assert.equal(res.status, 204);
  });

  test('a posted order is pinned to the door, priced on road miles, and pushed to nearby drivers', async () => {
    const res = await request(app).post('/api/restaurant/orders').set(bearer(restaurant)).send({
      source: 'Deliveroo', externalOrderId: '#8680', customerName: 'Anna T.', customerPhone: '+442033195035',
      deliveryAddress: '19 Rosemont Rd, Richmond', postcode: 'TW10 6QN', prepMinutes: 20,
      dispatchType: 'open_platform', items: [],
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    orderId = res.body.order.id;

    const { rows } = await pool.query('SELECT distance_miles, dropoff_latitude, dropoff_longitude FROM orders WHERE id = $1', [orderId]);
    assert.equal(Number(rows[0].distance_miles), 1.4, 'road miles from Google Routes');
    assert.deepEqual([rows[0].dropoff_latitude, rows[0].dropoff_longitude], [DOOR.lat, DOOR.lng], 'pinned to the door');
    assert.ok(calls.geocode.some((a) => a.includes('19 Rosemont Rd') && a.includes('TW10 6QN')));
    const pricing = calls.routes.find((b) => b.routingPreference === 'TRAFFIC_UNAWARE');
    assert.ok(pricing, 'fees use traffic-free distance');

    const offer = await waitFor(() => calls.push.find((m) => m.to === DRIVER_PHONE && m.data.type === 'offer'), 'offer push');
    assert.match(offer.title, /^New order nearby · £\d+\.\d\d$/);
    assert.equal(offer.body, 'Saffron to TW10 6QN. First driver to accept gets it.');
    assert.equal(offer.data.orderId, orderId);
    assert.equal(offer.priority, 'high');
  });

  test('the driver accepts it from the pool and sees road miles, a traffic-aware ETA and the route line', async () => {
    let res = await request(app).get('/api/driver/dashboard').set(bearer(driver));
    assert.ok(res.body.orders.some((o) => o.id === orderId && !o.batchId), 'in the pool');
    res = await request(app).post(`/api/driver/pool/${orderId}/add`).set(bearer(driver));
    assert.equal(res.body.ok, true, res.body.message);
    res = await request(app).get('/api/driver/dashboard').set(bearer(driver));
    assert.equal(res.body.driverBatchStatus, 'accepted_navigating');
    const est = res.body.routeEstimate;
    assert.equal(est.source, 'road');
    assert.equal(est.polyline, '_p~iF~ps|U_ulLnnqC');
    assert.equal(est.miles, 2.8); // driver -> restaurant -> customer, 1.4 mi per leg in the fake
    assert.equal(est.minutes, 14 + 2 * 3); // 7 min per leg + 3 min per stop
    const live = calls.routes.find((b) => b.routingPreference === 'TRAFFIC_AWARE');
    assert.ok(live, 'ETA uses live traffic');
    assert.equal(live.intermediates.length, 1);
  });

  test('accepting tells the restaurant the driver is on the way', async () => {
    const msg = await waitFor(() => calls.push.find((m) => m.to === RESTAURANT_PHONE && m.title === 'Driver on the way'), 'accepted push');
    assert.equal(msg.body, 'Gustavo accepted #8680 and is heading to you.');
  });

  test('pick-up and delivery are pushed to the restaurant', async () => {
    await request(app).post('/api/driver/batch/advance').set(bearer(driver)).expect(200);
    await waitFor(() => calls.push.find((m) => m.to === RESTAURANT_PHONE && m.title === 'Order collected'), 'picked up push');
  });

  test('a chat message reaches a driver without the app open', async () => {
    const open = await request(app).post('/api/chat/open').set(bearer(restaurant)).send({ orderId });
    assert.equal(open.status, 200, JSON.stringify(open.body));
    const conversationId = open.body.conversation.id;
    await request(app)
      .post(`/api/chat/conversations/${conversationId}/messages`)
      .set(bearer(restaurant))
      .send({ body: 'Please use the side door' })
      .expect(201);
    const msg = await waitFor(() => calls.push.find((m) => m.to === DRIVER_PHONE && m.data.type === 'chat'), 'chat push');
    assert.equal(msg.title, 'Saffron');
    assert.equal(msg.body, 'Please use the side door');
    assert.equal(msg.channelId, 'chat');
    assert.equal(msg.data.conversationId, conversationId);
  });

  test('delivering the last stop is pushed too', async () => {
    await request(app).post('/api/driver/batch/advance').set(bearer(driver)).expect(200);
    const msg = await waitFor(() => calls.push.find((m) => m.to === RESTAURANT_PHONE && m.title === 'Order delivered'), 'delivered push');
    assert.equal(msg.body, '#8680 was delivered to TW10 6QN.');
  });
});

describe('old-style offers (made before the open pool)', () => {
  test('an offer nobody answers is withdrawn and the order goes back to the pool', async () => {
    await request(app).post('/api/driver/batch/next').set(bearer(driver)).expect(200); // finish the last run
    const before = calls.push.length;
    const res = await request(app).post('/api/restaurant/orders').set(bearer(restaurant)).send({
      source: 'Uber Eats', externalOrderId: '#3B274', customerName: 'Steve J.', customerPhone: '+441388436844',
      deliveryAddress: '19 Rosemont Rd, Richmond', postcode: 'TW10 6QN', prepMinutes: 15,
      dispatchType: 'open_platform', items: [],
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    const orderId = res.body.order.id;
    await waitFor(() => calls.push.slice(before).find((m) => m.data.type === 'offer'), 'second order push');
    const batch = (await pool.query(`INSERT INTO batches (driver_id, status) VALUES ($1, 'offered') RETURNING id`, [driver.id])).rows[0];
    await pool.query(`UPDATE orders SET batch_id = $1, assigned_driver_id = $2, status = 'batched_offered' WHERE id = $3`, [batch.id, driver.id, orderId]);

    // Three minutes pass without an answer.
    await pool.query(`UPDATE batches SET created_at = now() - interval '3 minutes' WHERE status = 'offered'`);
    const late = await request(app).post('/api/driver/batch/accept').set(bearer(driver));
    assert.equal(late.status, 409);
    assert.equal(late.body.error.code, 'OFFER_EXPIRED');

    const dispatch = require('../src/services/dispatch.service');
    assert.equal(await dispatch.expireStaleOffers(), 1);
    const { rows } = await pool.query('SELECT batch_id, status FROM orders WHERE id = $1', [orderId]);
    assert.equal(rows[0].batch_id, null);
    assert.ok(['preparing', 'ready_for_pickup'].includes(rows[0].status), rows[0].status);
    // It is not shown back to the same driver straight away.
    assert.deepEqual(await dispatch.notifyNearbyDrivers(orderId), []);
  });
});

describe('geocoding safety and push clean-up', () => {
  test('a Google match far from the postcode is ignored for the postcode centre', async () => {
    const geo = require('../src/services/geo.service');
    const hit = await geo.locateAddress('1 Nowhere Lane', 'TW10 6QN');
    assert.equal(hit.precision, 'postcode');
    assert.deepEqual([hit.latitude, hit.longitude], [POSTCODES.TW106QN.latitude, POSTCODES.TW106QN.longitude]);
  });

  test('an unknown postcode is still reported as not found', async () => {
    const geo = require('../src/services/geo.service');
    assert.equal((await geo.locateAddress('1 High St', 'ZZ1 1ZZ')).status, 'not_found');
  });

  test('a phone that uninstalled the app is forgotten', async () => {
    deadTokens.add(RESTAURANT_PHONE);
    const push = require('../src/services/push.service');
    assert.equal(await push.sendToUsers([restaurant.userId], { title: 't', body: 'b' }), 0);
    const { rows } = await pool.query('SELECT token FROM push_tokens WHERE user_id = $1', [restaurant.userId]);
    assert.equal(rows.length, 0);
  });

  test('signing out removes the phone', async () => {
    await request(app).delete('/api/auth/push-token').set(bearer(driver)).send({ token: DRIVER_PHONE }).expect(204);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM push_tokens')).rows[0].n, 0);
  });
});
