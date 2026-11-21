const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-1234';
process.env.BCRYPT_ROUNDS = '4';
process.env.S3_BUCKET = ''; // tests never touch the real bucket

const { startTestDatabase } = require('./helpers/testDb');

const ADMIN = { email: 'owner@kycexpiry.test', password: 'AdminPass123' };
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document';
const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const b64 = (buf) => buf.toString('base64');
const pdf = Buffer.concat([Buffer.from('%PDF-1.7\n'), Buffer.alloc(300, 7)]);

let stopDb, app, pool, adminToken, driver;

const docsOf = async () => (await request(app).get('/api/driver/dashboard').set(bearer(driver.token))).body.me.kycDocuments;
const setExpiry = (docId, expiresOn, token = adminToken) =>
  request(app).patch(`/api/admin/kyc-documents/${docId}/expiry`).set(bearer(token)).send({ expiresOn });
const upload = (docId) =>
  request(app).post(`/api/driver/documents/${docId}/upload`).set(bearer(driver.token)).send({ imageBase64: b64(pdf), mimeType: 'application/pdf' });
const isoIn = (days) => new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);

before(async () => {
  stopDb = await startTestDatabase();
  app = require('../src/app');
  ({ pool } = require('../src/config/db'));
  await require('../src/db/migrate').runMigrations(pool, () => {});
  await require('../src/db/seedAdmin').seedAdmin(pool, { ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password }, () => {});
  adminToken = (await request(app).post('/api/auth/login').send(ADMIN)).body.tokens.accessToken;
  const res = await request(app).post('/api/auth/signup').send({
    role: 'driver', email: 'ex1@kycexpiry.test', password: 'Passw0rd123', fullName: 'Ex Rider',
    phone: '+44 7841 000201', vehicle: 'Car', plateNumber: 'ex12 abc',
  });
  driver = { token: res.body.tokens.accessToken, id: res.body.user.driver.id };
});

after(async () => {
  if (pool) await pool.end();
  if (stopDb) await stopDb();
});

const byType = async (type) => (await docsOf()).find((d) => d.type === type);

test('licence, insurance, ID and right to work can expire; NI and bank cannot', async () => {
  const docs = await docsOf();
  assert.deepEqual(
    docs.filter((d) => d.canExpire).map((d) => d.type),
    ['driving_licence', 'vehicle_insurance', 'identity', 'right_to_work']
  );
  const ni = docs.find((d) => d.type === 'ni_number');
  await upload(ni.id);
  const res = await setExpiry(ni.id, isoIn(100));
  assert.equal(res.status, 400);
  assert.equal(res.body.error.code, 'DOCUMENT_DOES_NOT_EXPIRE');
});

test('an admin sets an expiry date on an uploaded document, and the state follows the date', async () => {
  const licence = await byType('driving_licence');
  assert.equal((await setExpiry(licence.id, isoIn(200))).body.error?.code, 'DOCUMENT_NOT_UPLOADED');
  assert.equal((await upload(licence.id)).status, 200);

  let res = await setExpiry(licence.id, isoIn(200));
  assert.equal(res.status, 200, JSON.stringify(res.body));
  let doc = await byType('driving_licence');
  assert.equal(doc.expiresOn, isoIn(200));
  assert.equal(doc.expiryState, 'valid');
  // The admin dashboard shows it too.
  const adminDoc = res.body.dashboard.drivers.find((d) => d.id === driver.id).kycDocuments.find((d) => d.id === licence.id);
  assert.equal(adminDoc.expiresOn, isoIn(200));

  await setExpiry(licence.id, isoIn(10));
  assert.equal((await byType('driving_licence')).expiryState, 'expiring');
  await setExpiry(licence.id, isoIn(-3));
  assert.equal((await byType('driving_licence')).expiryState, 'expired');

  await setExpiry(licence.id, null);
  doc = await byType('driving_licence');
  assert.equal(doc.expiresOn, null);
  assert.equal(doc.expiryState, null);
});

test('a new upload clears the old date; bad dates and non-admins are refused', async () => {
  const insurance = await byType('vehicle_insurance');
  await upload(insurance.id);
  assert.equal((await setExpiry(insurance.id, isoIn(90))).status, 200);
  await upload(insurance.id);
  assert.equal((await byType('vehicle_insurance')).expiresOn, null);

  assert.equal((await setExpiry(insurance.id, '2027-02-30')).status, 400);
  assert.equal((await setExpiry(insurance.id, '31/03/2027')).status, 400);
  assert.equal((await setExpiry(insurance.id, isoIn(90), driver.token)).status, 403);
});
