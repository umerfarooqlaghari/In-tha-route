const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-1234';
process.env.BCRYPT_ROUNDS = '4';
process.env.PUSH_DISABLED = 'true';
process.env.S3_BUCKET = '';
delete process.env.GOOGLE_MAPS_API_KEY;

const { startTestDatabase } = require('./helpers/testDb');

const realFetch = global.fetch;
global.fetch = async (url, init) => {
  if (String(url).startsWith('https://api.postcodes.io/postcodes/')) {
    return new Response(JSON.stringify({ result: { latitude: 51.4613, longitude: -0.3037 } }), { status: 200 });
  }
  return realFetch(url, init);
};

let stopDb, app, pool, seedAdmin;
const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const ADMIN = { email: 'boss@account.test', password: 'AdminPass123' };
const PNG = Buffer.concat([Buffer.from('89504e470d0a1a0a', 'hex'), Buffer.alloc(400, 3)]).toString('base64');

const login = (email, password) => request(app).post('/api/auth/login').send({ email, password });
const signupMerchant = (email, extra = {}) =>
  request(app).post('/api/auth/signup').send({
    role: 'restaurant', email, password: 'Passw0rd123', fullName: 'Shop Staff', phone: '020 8940 5541',
    restaurantName: 'Account Kitchen', address: '9 The Square, Richmond', postcode: 'TW9 1DT', ...extra,
  });
const signupDriver = (email) =>
  request(app).post('/api/auth/signup').send({
    role: 'driver', email, password: 'Passw0rd123', fullName: 'Rider Acc', phone: '+44 7841 930001',
    vehicle: 'Car', plateNumber: 'AC12 CNT',
  });
const postOrder = (token, ref) =>
  request(app).post('/api/restaurant/orders').set(bearer(token)).send({
    source: 'Deliveroo', externalOrderId: ref, customerName: 'Anna T.', customerPhone: '+442033195035',
    deliveryAddress: '19 Rosemont Rd, Richmond', postcode: 'TW10 6QN', prepMinutes: 20, dispatchType: 'open_platform', items: [],
  });

before(async () => {
  stopDb = await startTestDatabase();
  app = require('../src/app');
  ({ pool } = require('../src/config/db'));
  ({ seedAdmin } = require('../src/db/seedAdmin'));
  await require('../src/db/migrate').runMigrations(pool, () => {});
  await seedAdmin(pool, { ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password }, () => {});
});

after(async () => {
  global.fetch = realFetch;
  if (pool) await pool.end();
  if (stopDb) await stopDb();
});

describe('name and email', () => {
  let token;
  before(async () => {
    token = (await signupDriver('name@account.test')).body.tokens.accessToken;
    await signupDriver('taken@account.test');
  });

  test('the name can be changed without a password', async () => {
    const res = await request(app).patch('/api/auth/account').set(bearer(token)).send({ fullName: '  Rider Renamed ' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.user.fullName, 'Rider Renamed');
  });

  test('a new email needs the right current password', async () => {
    const none = await request(app).patch('/api/auth/account').set(bearer(token)).send({ email: 'new@account.test' });
    assert.equal(none.status, 400);
    assert.equal(none.body.error.details[0].field, 'currentPassword');
    const wrong = await request(app).patch('/api/auth/account').set(bearer(token))
      .send({ email: 'new@account.test', currentPassword: 'Wrong12345' });
    assert.equal(wrong.status, 400);
    assert.equal(wrong.body.error.details[0].field, 'currentPassword');
  });

  test('an email someone else uses is refused', async () => {
    const res = await request(app).patch('/api/auth/account').set(bearer(token))
      .send({ email: 'TAKEN@account.test', currentPassword: 'Passw0rd123' });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'EMAIL_TAKEN');
  });

  test('the new email is saved in lowercase and is the one to log in with', async () => {
    const res = await request(app).patch('/api/auth/account').set(bearer(token))
      .send({ email: ' New.Name@Account.TEST ', currentPassword: 'Passw0rd123' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.user.email, 'new.name@account.test');
    assert.equal((await login('name@account.test', 'Passw0rd123')).status, 401);
    assert.equal((await login('NEW.NAME@account.test', 'Passw0rd123')).status, 200);
  });
});

describe('password', () => {
  let session, other;
  before(async () => {
    session = (await signupDriver('pw@account.test')).body.tokens;
    other = (await login('pw@account.test', 'Passw0rd123')).body.tokens;
  });

  test('the current password must be right, and the new one needs a capital letter', async () => {
    const wrong = await request(app).put('/api/auth/account/password').set(bearer(session.accessToken))
      .send({ currentPassword: 'Wrong12345', newPassword: 'NewPassw0rd' });
    assert.equal(wrong.status, 400);
    assert.equal(wrong.body.error.details[0].field, 'currentPassword');
    const weak = await request(app).put('/api/auth/account/password').set(bearer(session.accessToken))
      .send({ currentPassword: 'Passw0rd123', newPassword: 'newpassw0rd' });
    assert.equal(weak.status, 400);
    assert.match(JSON.stringify(weak.body), /capital letter/);
  });

  test('changing it signs out other devices and keeps this one signed in', async () => {
    const res = await request(app).put('/api/auth/account/password').set(bearer(session.accessToken))
      .send({ currentPassword: 'Passw0rd123', newPassword: 'NewPassw0rd' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.ok(res.body.tokens.refreshToken);
    assert.equal((await request(app).post('/api/auth/refresh').send({ refreshToken: other.refreshToken })).status, 401);
    assert.equal((await request(app).post('/api/auth/refresh').send({ refreshToken: res.body.tokens.refreshToken })).status, 200);
    assert.equal((await login('pw@account.test', 'Passw0rd123')).status, 401);
    assert.equal((await login('pw@account.test', 'NewPassw0rd')).status, 200);
  });
});

describe('merchant name and logo', () => {
  let token;
  before(async () => {
    token = (await signupMerchant('logo@account.test')).body.tokens.accessToken;
  });

  test('the business name can be changed', async () => {
    const res = await request(app).patch('/api/restaurant/profile').set(bearer(token)).send({ name: 'Renamed Kitchen' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.user.restaurant.name, 'Renamed Kitchen');
    const dash = await request(app).get('/api/restaurant/dashboard').set(bearer(token));
    assert.equal(dash.body.restaurants[0].name, 'Renamed Kitchen');
  });

  test('a logo is uploaded, shown publicly, and replacing it removes the old one', async () => {
    const bad = await request(app).put('/api/restaurant/logo').set(bearer(token)).send({ imageBase64: PNG, mimeType: 'image/heic' });
    assert.equal(bad.status, 400);

    const first = await request(app).put('/api/restaurant/logo').set(bearer(token)).send({ imageBase64: PNG, mimeType: 'image/png' });
    assert.equal(first.status, 200, JSON.stringify(first.body));
    const url = first.body.user.restaurant.logoUrl;
    assert.match(url, /^\/api\/files\/logos\/[0-9a-f-]{36}$/);
    const img = await request(app).get(url);
    assert.equal(img.status, 200);
    assert.equal(img.headers['content-type'], 'image/png');
    assert.equal(img.headers['cross-origin-resource-policy'], 'cross-origin');
    const dash = await request(app).get('/api/restaurant/dashboard').set(bearer(token));
    assert.equal(dash.body.restaurants[0].logoUrl, url);

    const second = await request(app).put('/api/restaurant/logo').set(bearer(token)).send({ imageBase64: PNG, mimeType: 'image/png' });
    assert.notEqual(second.body.user.restaurant.logoUrl, url);
    assert.equal((await request(app).get(url)).status, 404);

    const removed = await request(app).delete('/api/restaurant/logo').set(bearer(token));
    assert.equal(removed.body.user.restaurant.logoUrl, null);
    assert.equal((await request(app).get(second.body.user.restaurant.logoUrl)).status, 404);
  });

  test('other files cannot be fetched through the logo address', async () => {
    const { rows } = await pool.query("SELECT id FROM files WHERE folder <> 'logos' LIMIT 1");
    if (rows[0]) assert.equal((await request(app).get(`/api/files/logos/${rows[0].id}`)).status, 404);
    assert.equal((await request(app).get('/api/files/logos/not-a-uuid')).status, 404);
  });
});

describe('deleting an account', () => {
  test('needs the right password', async () => {
    const token = (await signupDriver('wrongdel@account.test')).body.tokens.accessToken;
    const res = await request(app).delete('/api/auth/account').set(bearer(token)).send({ password: 'Wrong12345' });
    assert.equal(res.status, 400);
    assert.equal(res.body.error.details[0].field, 'password');
  });

  test('a merchant with an order in progress must finish it first; then the account closes but orders stay', async () => {
    const s = await signupMerchant('closing@account.test', { restaurantName: 'Closing Kitchen' });
    const token = s.body.tokens.accessToken;
    const restaurantId = s.body.user.restaurant.id;
    await request(app).put('/api/restaurant/logo').set(bearer(token)).send({ imageBase64: PNG, mimeType: 'image/png' });
    const own = await request(app).post('/api/restaurant/drivers').set(bearer(token)).send({
      fullName: 'Shop Rider', email: 'shoprider@account.test', password: 'Passw0rd123', phone: '+44 7841 930099', vehicle: 'Car',
    });
    assert.equal(own.status, 201);
    const order = await postOrder(token, '#DEL1');
    assert.equal(order.status, 201, JSON.stringify(order.body));
    const orderId = order.body.order?.id ?? order.body.dashboard.orders[0].id;

    const blocked = await request(app).delete('/api/auth/account').set(bearer(token)).send({ password: 'Passw0rd123' });
    assert.equal(blocked.status, 409);
    assert.equal(blocked.body.error.code, 'ACTIVE_ORDERS');

    await request(app).post(`/api/restaurant/orders/${orderId}/cancel`).set(bearer(token)).send({ reason: 'Closing' });
    const res = await request(app).delete('/api/auth/account').set(bearer(token)).send({ password: 'Passw0rd123' });
    assert.equal(res.status, 204, JSON.stringify(res.body));

    assert.equal((await request(app).get('/api/restaurant/dashboard').set(bearer(token))).status, 403);
    assert.equal((await login('closing@account.test', 'Passw0rd123')).status, 401);
    // Their own driver worked only for this shop.
    assert.equal((await login('shoprider@account.test', 'Passw0rd123')).status, 403);

    const { rows } = await pool.query(
      `SELECT u.email, u.full_name, u.phone, u.deleted_at, r.name, r.logo_file_id,
              (SELECT count(*)::int FROM orders o WHERE o.restaurant_id = r.id) AS orders
         FROM restaurants r JOIN users u ON u.id = r.owner_user_id WHERE r.id = $1`,
      [restaurantId]
    );
    assert.equal(rows[0].full_name, 'Deleted account');
    assert.equal(rows[0].name, 'Deleted merchant');
    assert.equal(rows[0].phone, null);
    assert.equal(rows[0].logo_file_id, null);
    assert.ok(rows[0].deleted_at);
    assert.equal(rows[0].orders, 1);
    assert.doesNotMatch(rows[0].email, /closing/);

    const admin = (await login(ADMIN.email, ADMIN.password)).body.tokens.accessToken;
    const dash = await request(app).get('/api/admin/dashboard').set(bearer(admin));
    assert.ok(!dash.body.restaurants.some((r) => r.id === restaurantId));

    // The email is free to sign up again.
    assert.equal((await signupMerchant('closing@account.test')).status, 201);
  });

  test('a driver can delete their account; documents are removed', async () => {
    const s = await signupDriver('leaving@account.test');
    const token = s.body.tokens.accessToken;
    const docs = (await request(app).get('/api/driver/dashboard').set(bearer(token))).body.me.kycDocuments;
    const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(300, 7)]).toString('base64');
    await request(app).post(`/api/driver/documents/${docs[0].id}/upload`).set(bearer(token)).send({ imageBase64: pdf, mimeType: 'application/pdf' });

    const res = await request(app).delete('/api/auth/account').set(bearer(token)).send({ password: 'Passw0rd123' });
    assert.equal(res.status, 204, JSON.stringify(res.body));
    assert.equal((await login('leaving@account.test', 'Passw0rd123')).status, 401);
    const { rows } = await pool.query(
      `SELECT count(*)::int AS n FROM kyc_documents k JOIN driver_profiles d ON d.id = k.driver_id
        WHERE d.user_id = $1 AND k.file_id IS NOT NULL`,
      [s.body.user.id]
    );
    assert.equal(rows[0].n, 0);
    const admin = (await login(ADMIN.email, ADMIN.password)).body.tokens.accessToken;
    const drivers = (await request(app).get('/api/admin/dashboard').set(bearer(admin))).body.drivers;
    assert.ok(!drivers.some((d) => d.email === 'leaving@account.test'));
  });

  test('the only admin cannot delete their account', async () => {
    const admin = (await login(ADMIN.email, ADMIN.password)).body.tokens.accessToken;
    const res = await request(app).delete('/api/auth/account').set(bearer(admin)).send({ password: ADMIN.password });
    assert.equal(res.status, 409);
    assert.equal(res.body.error.code, 'LAST_ADMIN');
  });
});

describe('admin from the env', () => {
  test('once an admin exists, the env is ignored, even with old or weak values', async () => {
    const admin = (await login(ADMIN.email, ADMIN.password)).body.tokens.accessToken;
    await request(app).patch('/api/auth/account').set(bearer(admin))
      .send({ email: 'boss.new@account.test', currentPassword: ADMIN.password });
    await request(app).put('/api/auth/account/password').set(bearer(admin))
      .send({ currentPassword: ADMIN.password, newPassword: 'NewAdminPass1' });

    // Next deploy: the env still has the first email and password (or a password without a capital).
    for (const pw of [ADMIN.password, 'oldpassword1']) {
      const result = await seedAdmin(pool, { ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: pw }, () => {});
      assert.equal(result.created, false);
    }
    const { rows } = await pool.query("SELECT email FROM users WHERE role = 'admin'");
    assert.deepEqual(rows.map((r) => r.email), ['boss.new@account.test']);
    assert.equal((await login(ADMIN.email, ADMIN.password)).status, 401);
    assert.equal((await login('boss.new@account.test', 'NewAdminPass1')).status, 200);
  });
});
