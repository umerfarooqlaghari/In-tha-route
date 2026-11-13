const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-1234';
process.env.BCRYPT_ROUNDS = '4';
process.env.S3_BUCKET = ''; // empty, so the bucket in .env is not picked up: tests never touch the real one

const { startTestDatabase } = require('./helpers/testDb');

const ADMIN = { email: 'owner@rtw.test', password: 'AdminPass123' };
const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const photo = Buffer.alloc(300, 9).toString('base64');

let stopDb, app, pool, adminToken, driver;

const myDocs = async () =>
  (await request(app).get('/api/driver/dashboard').set(bearer(driver.token))).body.me.kycDocuments;
const upload = (docId) =>
  request(app)
    .post(`/api/driver/documents/${docId}/upload`)
    .set(bearer(driver.token))
    .send({ imageBase64: photo, mimeType: 'image/png' });
const approve = () => request(app).post(`/api/admin/drivers/${driver.id}/approve`).set(bearer(adminToken));

before(async () => {
  stopDb = await startTestDatabase();
  app = require('../src/app');
  ({ pool } = require('../src/config/db'));
  await require('../src/db/migrate').runMigrations(pool, () => {});
  await require('../src/db/seedAdmin').seedAdmin(pool, { ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password }, () => {});
  adminToken = (await request(app).post('/api/auth/login').send(ADMIN)).body.tokens.accessToken;
  const signup = await request(app).post('/api/auth/signup').send({
    role: 'driver', email: 'rider@rtw.test', password: 'Passw0rd123', fullName: 'Rtw Rider',
    phone: '+44 7841 000002', vehicle: 'Car', plateNumber: 'ab12 cdg',
  });
  assert.equal(signup.status, 201);
  driver = { token: signup.body.tokens.accessToken, id: signup.body.user.driver.id };
});

after(async () => {
  if (pool) await pool.end();
  if (stopDb) await stopDb();
});

test('a new driver is asked for six documents, right to work last', async () => {
  const docs = await myDocs();
  assert.equal(docs.length, 6);
  assert.equal(docs[5].type, 'right_to_work');
  assert.equal(docs[5].title, 'Right to Work in the UK');
  assert.equal(docs[5].status, 'missing');
});

test('the admin sees the right to work document and cannot approve without it', async () => {
  const docs = await myDocs();
  for (const d of docs.slice(0, 5)) assert.equal((await upload(d.id)).status, 200);

  const list = await request(app).get('/api/admin/dashboard').set(bearer(adminToken));
  const seen = JSON.stringify(list.body);
  assert.ok(seen.includes('Right to Work in the UK'), 'admin dashboard lists the document');

  const res = await approve();
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'DOCUMENTS_MISSING');

  assert.equal((await upload(docs[5].id)).status, 200);
  assert.equal((await approve()).status, 200);
  assert.ok((await myDocs()).every((d) => d.status === 'verified'));
});

test('a driver approved before the document existed keeps working and can have it verified later', async () => {
  // As the migration leaves an earlier driver: approved, with the new slot still empty.
  await pool.query(
    `UPDATE kyc_documents SET status = 'missing', file_id = NULL WHERE driver_id = $1 AND doc_type = 'right_to_work'`,
    [driver.id]
  );
  const before = await pool.query('SELECT status FROM driver_profiles WHERE id = $1', [driver.id]);
  assert.equal(before.rows[0].status, 'offline');

  const rtw = (await myDocs())[5];
  assert.equal((await upload(rtw.id)).status, 200);
  assert.equal((await myDocs())[5].status, 'pending');
  assert.equal((await approve()).status, 200);
  assert.equal((await myDocs())[5].status, 'verified');
  const after = await pool.query('SELECT status FROM driver_profiles WHERE id = $1', [driver.id]);
  assert.equal(after.rows[0].status, 'offline');
});
