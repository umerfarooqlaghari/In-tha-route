const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-1234';
process.env.BCRYPT_ROUNDS = '4';
process.env.PUSH_DISABLED = 'true';
delete process.env.GOOGLE_MAPS_API_KEY;

const { startTestDatabase } = require('./helpers/testDb');

// Richmond: every postcode lookup lands on the restaurant; the test then moves each drop-off.
const SHOP = { latitude: 51.4619, longitude: -0.3033 };
const realFetch = global.fetch;
global.fetch = async (url, init) => {
  if (String(url).startsWith('https://api.postcodes.io/postcodes/')) {
    return new Response(JSON.stringify({ result: SHOP }), { status: 200 });
  }
  return realFetch(url, init);
};

let stopDb, app, pool, admin, merchant, driverA, driverB;
const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const ADMIN = { email: 'owner@groups.test', password: 'AdminPass123' };
const MILES_PER_DEGREE_LAT = 69.09;
const south = (miles) => SHOP.latitude - miles / MILES_PER_DEGREE_LAT;

const poolOf = async (token) =>
  (await request(app).get('/api/driver/dashboard').set(bearer(token))).body.orders.filter((o) => !o.batchId);
const groupsIn = (orders) => {
  const groups = new Map();
  for (const o of orders) if (o.poolGroupId) groups.set(o.poolGroupId, [...(groups.get(o.poolGroupId) || []), o.externalOrderId]);
  return [...groups.values()];
};
const ids = {};

async function postOrder(ref, { readyInMinutes, dropoffMilesSouth, dropoffMilesEast = 0 }) {
  const o = await request(app).post('/api/restaurant/orders').set(bearer(merchant)).send({
    source: 'Deliveroo', externalOrderId: ref, customerName: 'Anna T.', customerPhone: '+442033195035',
    deliveryAddress: `${ref.slice(1)} Sheen Rd, Richmond`, postcode: 'TW9 1BP', prepMinutes: 20,
    dispatchType: 'open_platform', items: [],
  });
  assert.equal(o.status, 201, JSON.stringify(o.body));
  const { rows } = await pool.query('SELECT id FROM orders WHERE external_order_id = $1', [ref]);
  ids[ref] = rows[0].id;
  await pool.query(
    `UPDATE orders SET ready_at = now() + make_interval(mins => $2), pool_expires_at = now() + interval '1 hour',
            dropoff_latitude = $3, dropoff_longitude = $4
      WHERE id = $1`,
    [ids[ref], readyInMinutes, south(dropoffMilesSouth), SHOP.longitude + dropoffMilesEast / 43]
  );
}

before(async () => {
  stopDb = await startTestDatabase();
  app = require('../src/app');
  ({ pool } = require('../src/config/db'));
  await require('../src/db/migrate').runMigrations(pool, () => {});
  await require('../src/db/seedAdmin').seedAdmin(pool, { ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password }, () => {});
  admin = (await request(app).post('/api/auth/login').send(ADMIN)).body.tokens.accessToken;
  const set = await request(app).put('/api/admin/pricing').set(bearer(admin)).send({
    maxBatchSize: 4, maxPrepTimeWindowMinutes: 10, maxPickupRadiusMiles: 0.8, maxDropoffRadiusMiles: 1.5, noDistanceLimit: true,
  });
  assert.equal(set.status, 200, JSON.stringify(set.body));

  const m = await request(app).post('/api/auth/signup').send({
    role: 'restaurant', email: 'shop@groups.test', password: 'Passw0rd123', fullName: 'Shop Staff',
    phone: '020 8940 5561', restaurantName: 'Quadrant Kitchen', address: '40 The Quadrant', postcode: 'TW9 1BP',
  });
  merchant = m.body.tokens.accessToken;
  await pool.query('UPDATE restaurants SET latitude = $1, longitude = $2', [SHOP.latitude, SHOP.longitude]);

  for (const [n, plate] of [['Alpha Rider', 'GR12 AAA'], ['Bravo Rider', 'GR12 BBB']]) {
    const d = await request(app).post('/api/auth/signup').send({
      role: 'driver', email: `${n.split(' ')[0].toLowerCase()}@groups.test`, password: 'Passw0rd123', fullName: n,
      phone: n.startsWith('A') ? '+44 7841 940011' : '+44 7841 940012', vehicle: 'Car', plateNumber: plate,
    });
    if (n.startsWith('A')) driverA = d.body.tokens.accessToken;
    else driverB = d.body.tokens.accessToken;
  }
  await pool.query(`UPDATE driver_profiles SET status = 'approved_online'`);

  // Six single orders from the same kitchen:
  //  #A1 #A2 #A3  ready together, delivered within a mile of each other, 2 mi south
  //  #B1 #B2      ready together 25 min later, delivered next to each other, 2 mi east
  //  #C1          ready with the A orders, but delivered 6 mi away
  await postOrder('#A1', { readyInMinutes: 10, dropoffMilesSouth: 2 });
  await postOrder('#A2', { readyInMinutes: 14, dropoffMilesSouth: 2.6 });
  await postOrder('#A3', { readyInMinutes: 12, dropoffMilesSouth: 2.3, dropoffMilesEast: 0.4 });
  await postOrder('#B1', { readyInMinutes: 35, dropoffMilesSouth: 0, dropoffMilesEast: 2 });
  await postOrder('#B2', { readyInMinutes: 38, dropoffMilesSouth: 0.2, dropoffMilesEast: 2.3 });
  await postOrder('#C1', { readyInMinutes: 11, dropoffMilesSouth: 6 });
});

after(async () => {
  global.fetch = realFetch;
  if (pool) await pool.end();
  if (stopDb) await stopDb();
});

test('six single orders show as one triple, one double and one single', async () => {
  const orders = await poolOf(driverA);
  assert.equal(orders.length, 6);
  const groups = groupsIn(orders).map((g) => g.join(' '));
  assert.deepEqual(groups.sort(), ['#A1 #A3 #A2', '#B1 #B2']);
  const c1 = orders.find((o) => o.externalOrderId === '#C1');
  assert.equal(c1.poolGroupId, undefined);
  // A group's orders are listed next to each other, soonest ready first.
  const refs = orders.map((o) => o.externalOrderId);
  assert.equal(refs.indexOf('#A3'), refs.indexOf('#A1') + 1);
  assert.equal(refs.indexOf('#A2'), refs.indexOf('#A1') + 2);
  // Each order is priced at the place it would take in the run: 1st, 2nd, 3rd.
  const { body } = await request(app).get('/api/admin/dashboard').set(bearer(admin));
  const tiers = body.algorithm.steppedDriverPayoutsGbp;
  const a = ['#A1', '#A3', '#A2'].map((r) => orders.find((o) => o.externalOrderId === r).nextPayoutGbp);
  assert.ok(a[0] >= tiers[0] && a[1] >= tiers[1] && a[2] >= tiers[2], JSON.stringify({ a, tiers }));
});

test('the admin\'s drop-off radius decides what counts as near', async () => {
  await request(app).put('/api/admin/pricing').set(bearer(admin)).send({ maxDropoffRadiusMiles: 0.3 });
  assert.deepEqual(groupsIn(await poolOf(driverA)).map((g) => g.join(' ')), []);
  await request(app).put('/api/admin/pricing').set(bearer(admin)).send({ maxDropoffRadiusMiles: 1.5 });
  // Prep times further apart than the window are never grouped.
  await request(app).put('/api/admin/pricing').set(bearer(admin)).send({ maxPrepTimeWindowMinutes: 1 });
  assert.deepEqual(groupsIn(await poolOf(driverA)), []);
  await request(app).put('/api/admin/pricing').set(bearer(admin)).send({ maxPrepTimeWindowMinutes: 10 });
});

test('a group never has more orders than the places left in the run', async () => {
  await request(app).put('/api/admin/pricing').set(bearer(admin)).send({ maxBatchSize: 2 });
  const groups = groupsIn(await poolOf(driverA));
  assert.ok(groups.length >= 2 && groups.every((g) => g.length === 2), JSON.stringify(groups));
  await request(app).put('/api/admin/pricing').set(bearer(admin)).send({ maxBatchSize: 4 });
});

test('accepting the triple adds all three to the run, and the driver can still add one more after', async () => {
  const triple = ['#A1', '#A3', '#A2'].map((r) => ids[r]);
  const res = await request(app).post('/api/driver/pool-group/add').set(bearer(driverA)).send({ orderIds: triple });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  assert.equal(res.body.ok, true);
  assert.equal(res.body.message, '3 orders accepted. Head to the merchant.');
  const run = res.body.dashboard.orders.filter((o) => o.batchId);
  assert.deepEqual(run.map((o) => [o.externalOrderId, o.batchPosition]), [['#A1', 1], ['#A3', 2], ['#A2', 3]]);
  assert.equal(new Set(run.map((o) => o.batchId)).size, 1);

  // One place left: the double is shown as two singles now, and either can be added.
  const left = await poolOf(driverA);
  assert.deepEqual(left.map((o) => o.externalOrderId).sort(), ['#B1', '#B2', '#C1']);
  assert.deepEqual(groupsIn(left), []);
  const one = await request(app).post(`/api/driver/pool/${ids['#C1']}/add`).set(bearer(driverA));
  assert.equal(one.body.ok, true, JSON.stringify(one.body));
  assert.equal(one.body.message, 'Added as Order #4 in your run.');

  // Driver B no longer sees the taken orders.
  assert.deepEqual((await poolOf(driverB)).map((o) => o.externalOrderId).sort(), ['#B1', '#B2']);
});

test('if one order of a double was just taken, the other is still added', async () => {
  const taken = await request(app).post(`/api/driver/pool/${ids['#B1']}/add`).set(bearer(driverB));
  assert.equal(taken.body.ok, true);
  // Driver A is full (4 of 4): nothing can be added.
  const full = await request(app).post('/api/driver/pool-group/add').set(bearer(driverA))
    .send({ orderIds: [ids['#B1'], ids['#B2']] });
  assert.equal(full.body.ok, false);

  // Driver B already has #B1 and takes the double: only #B2 is new.
  const res = await request(app).post('/api/driver/pool-group/add').set(bearer(driverB))
    .send({ orderIds: [ids['#B1'], ids['#B2']] });
  assert.equal(res.body.ok, true, JSON.stringify(res.body));
  assert.match(res.body.message, /^1 of 2 orders added\./);
  const run = res.body.dashboard.orders.filter((o) => o.batchId).map((o) => [o.externalOrderId, o.batchPosition]);
  assert.deepEqual(run, [['#B1', 1], ['#B2', 2]]);
});

test('rejecting a group removes all its orders from that driver\'s pool only', async () => {
  await postOrder('#D1', { readyInMinutes: 50, dropoffMilesSouth: 3 });
  await postOrder('#D2', { readyInMinutes: 52, dropoffMilesSouth: 3.2 });
  await request(app).put('/api/admin/pricing').set(bearer(admin)).send({ maxBatchSize: 8 });
  const before = groupsIn(await poolOf(driverB));
  assert.deepEqual(before.map((g) => g.join(' ')), ['#D1 #D2']);
  const res = await request(app).post('/api/driver/pool-group/reject').set(bearer(driverB))
    .send({ orderIds: [ids['#D1'], ids['#D2']] });
  assert.equal(res.status, 200);
  assert.deepEqual(await poolOf(driverB), []);
  assert.deepEqual(groupsIn(await poolOf(driverA)).map((g) => g.join(' ')), ['#D1 #D2']);
});

test('a group must list at least one order', async () => {
  const res = await request(app).post('/api/driver/pool-group/add').set(bearer(driverA)).send({ orderIds: [] });
  assert.equal(res.status, 400);
});
