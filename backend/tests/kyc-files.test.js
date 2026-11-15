const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-1234';
process.env.BCRYPT_ROUNDS = '4';
process.env.S3_BUCKET = ''; // tests never touch the real bucket

const { startTestDatabase } = require('./helpers/testDb');

const ADMIN = { email: 'owner@kycfiles.test', password: 'AdminPass123' };
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const b64 = (buf) => buf.toString('base64');
const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(300, 7)]);
const docx = Buffer.concat([Buffer.from('504b0304', 'hex'), Buffer.alloc(300, 3)]);

let stopDb, app, pool, adminToken, driver, other;

const signupDriver = async (n) => {
  const res = await request(app).post('/api/auth/signup').send({
    role: 'driver', email: `kf${n}@kycfiles.test`, password: 'Passw0rd123', fullName: `Kf Rider ${n}`,
    phone: `+44 7841 00010${n}`, vehicle: 'Car', plateNumber: `kf${n}2 abc`,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return { token: res.body.tokens.accessToken, id: res.body.user.driver.id };
};
const docsOf = async (who) =>
  (await request(app).get('/api/driver/dashboard').set(bearer(who.token))).body.me.kycDocuments;
const upload = (who, docId, data, mimeType) =>
  request(app).post(`/api/driver/documents/${docId}/upload`).set(bearer(who.token)).send({ imageBase64: b64(data), mimeType });

before(async () => {
  stopDb = await startTestDatabase();
  app = require('../src/app');
  ({ pool } = require('../src/config/db'));
  await require('../src/db/migrate').runMigrations(pool, () => {});
  await require('../src/db/seedAdmin').seedAdmin(pool, { ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password }, () => {});
  adminToken = (await request(app).post('/api/auth/login').send(ADMIN)).body.tokens.accessToken;
  driver = await signupDriver(1);
  other = await signupDriver(2);
});

after(async () => {
  if (pool) await pool.end();
  if (stopDb) await stopDb();
});

test('a driver can upload a PDF and a .docx, and the apps are told which it is', async () => {
  const [first, second, third] = await docsOf(driver);
  assert.equal((await upload(driver, first.id, pdf, 'application/pdf')).status, 200);
  assert.equal((await upload(driver, second.id, docx, DOCX)).status, 200);
  assert.equal((await upload(driver, third.id, Buffer.alloc(300, 9), 'image/png')).status, 200);
  const docs = await docsOf(driver);
  assert.deepEqual(docs.slice(0, 4).map((d) => d.fileType), ['pdf', 'word', 'image', undefined]);
  assert.equal(docs[0].status, 'pending');
  assert.deepEqual(docs.slice(0, 4).map((d) => d.value), ['PDF submitted', '.docx file submitted', 'Photo submitted', 'Nothing uploaded yet']);
});

test('the driver and the admin can open the file; another driver cannot', async () => {
  const [first] = await docsOf(driver);
  const mine = await request(app).get(`/api/driver/documents/${first.id}/file`).set(bearer(driver.token));
  assert.equal(mine.status, 200);
  assert.equal(mine.headers['content-type'], 'application/pdf');
  assert.ok(Buffer.from(mine.body).subarray(0, 5).equals(Buffer.from('%PDF-')));

  const admin = await request(app).get(`/api/admin/kyc-documents/${first.id}/file`).set(bearer(adminToken));
  assert.equal(admin.status, 200);
  assert.equal(admin.headers['content-type'], 'application/pdf');

  const stranger = await request(app).get(`/api/driver/documents/${first.id}/file`).set(bearer(other.token));
  assert.equal(stranger.status, 404);
});

test('old .doc files, fakes and other types are refused', async () => {
  const [doc] = await docsOf(other);
  const oldDoc = await upload(other, doc.id, Buffer.alloc(300, 1), 'application/msword');
  assert.equal(oldDoc.status, 400);
  assert.match(oldDoc.body.error.message, /photo, a PDF or a \.docx/);

  const fakePdf = await upload(other, doc.id, Buffer.alloc(300, 1), 'application/pdf');
  assert.equal(fakePdf.status, 400);
  assert.match(fakePdf.body.error.message, /could not be read/);

  assert.equal((await upload(other, doc.id, Buffer.alloc(300, 1), 'text/plain')).status, 400);
  assert.equal((await docsOf(other))[0].status, 'missing');
});

test('receipts are still photos only', async () => {
  const restaurant = await request(app).post('/api/auth/signup').send({
    role: 'restaurant', email: 'r@kycfiles.test', password: 'Passw0rd123', fullName: 'R Staff',
    phone: '020 8940 5521', restaurantName: 'Kf Kitchen', address: '5 The Square, Richmond', postcode: 'TW9 1DT',
  });
  const res = await request(app)
    .post('/api/restaurant/receipts/scan')
    .set(bearer(restaurant.body.tokens.accessToken))
    .send({ imageBase64: b64(pdf), mimeType: 'application/pdf' });
  assert.equal(res.status, 400);
  assert.match(res.body.error.message, /JPEG or PNG/);
});
