const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');
const bcrypt = require('bcryptjs');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-1234';
process.env.BCRYPT_ROUNDS = '4';
process.env.S3_BUCKET = '';

const { startTestDatabase } = require('./helpers/testDb');

let stopDb, app, pool, merchantToken;
const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const merchant = (email, password) => ({
  role: 'restaurant', email, password, fullName: 'Case Staff', phone: '020 8940 5531',
  restaurantName: 'Case Kitchen', address: '7 The Square, Richmond', postcode: 'TW9 1DT',
});

before(async () => {
  stopDb = await startTestDatabase();
  app = require('../src/app');
  ({ pool } = require('../src/config/db'));
  await require('../src/db/migrate').runMigrations(pool, () => {});
});

after(async () => {
  if (pool) await pool.end();
  if (stopDb) await stopDb();
});

test('signup with capital letters in the email stores it in lowercase', async () => {
  const res = await request(app).post('/api/auth/signup').send(merchant('  Case.Owner@Example.TEST ', 'Passw0rd123'));
  assert.equal(res.status, 201);
  assert.equal(res.body.user.email, 'case.owner@example.test');
  merchantToken = res.body.tokens.accessToken;
  const { rows } = await pool.query("SELECT email FROM users WHERE email ILIKE 'case.owner@%'");
  assert.deepEqual(rows, [{ email: 'case.owner@example.test' }]);
});

test('login works with the email in any letter case, the password stays case-sensitive', async () => {
  for (const email of ['CASE.OWNER@EXAMPLE.TEST', 'Case.Owner@example.test', 'case.owner@example.test']) {
    const res = await request(app).post('/api/auth/login').send({ email, password: 'Passw0rd123' });
    assert.equal(res.status, 200, email);
  }
  const wrong = await request(app).post('/api/auth/login').send({ email: 'case.owner@example.test', password: 'passw0rd123' });
  assert.equal(wrong.status, 401);
});

test('the same email in different case cannot sign up twice', async () => {
  const res = await request(app).post('/api/auth/signup').send(merchant('CASE.OWNER@EXAMPLE.TEST', 'Passw0rd123'));
  assert.equal(res.status, 409);
  assert.equal(res.body.error.code, 'EMAIL_TAKEN');
});

test('a new password needs a capital letter (signup and adding a driver)', async () => {
  const signup = await request(app).post('/api/auth/signup').send(merchant('nocap@example.test', 'passw0rd123'));
  assert.equal(signup.status, 400);
  assert.match(JSON.stringify(signup.body), /capital letter/);

  const driver = { fullName: 'Low Rider', email: 'Low.Rider@Example.test', phone: '+44 7841 900131', vehicle: 'Car' };
  const bad = await request(app).post('/api/restaurant/drivers').set(bearer(merchantToken)).send({ ...driver, password: 'passw0rd123' });
  assert.equal(bad.status, 400);
  assert.match(JSON.stringify(bad.body), /capital letter/);

  const ok = await request(app).post('/api/restaurant/drivers').set(bearer(merchantToken)).send({ ...driver, password: 'Passw0rd123' });
  assert.equal(ok.status, 201);
  assert.ok(ok.body.dashboard.drivers.some((d) => d.email === 'low.rider@example.test'));
  const login = await request(app).post('/api/auth/login').send({ email: 'LOW.RIDER@EXAMPLE.TEST', password: 'Passw0rd123' });
  assert.equal(login.status, 200);
});

test('an account made before the capital-letter rule still logs in', async () => {
  const hash = await bcrypt.hash('oldpassw0rd', 4);
  await pool.query(
    "INSERT INTO users (email, password_hash, role, full_name) VALUES ('old.user@example.test', $1, 'admin', 'Old User')",
    [hash]
  );
  const res = await request(app).post('/api/auth/login').send({ email: 'Old.User@Example.test', password: 'oldpassw0rd' });
  assert.equal(res.status, 200);
});
