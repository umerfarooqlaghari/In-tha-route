const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-1234';
process.env.BCRYPT_ROUNDS = '4';
delete process.env.S3_BUCKET;

const { startTestDatabase } = require('./helpers/testDb');

let stopDb, app, pool;

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

test('without S3_BUCKET, KYC photos are kept in the database', async () => {
  const signup = await request(app).post('/api/auth/signup').send({
    role: 'driver', email: 'db@files.test', password: 'Passw0rd123', fullName: 'Db Rider',
    phone: '+44 7841 000001', vehicle: 'Car', plateNumber: 'ab12 cdf',
  });
  const { rows: docs } = await pool.query('SELECT id FROM kyc_documents WHERE driver_id = $1 LIMIT 1', [signup.body.user.driver.id]);
  const res = await request(app)
    .post(`/api/driver/documents/${docs[0].id}/upload`)
    .set({ Authorization: `Bearer ${signup.body.tokens.accessToken}` })
    .send({ imageBase64: Buffer.alloc(300, 7).toString('base64'), mimeType: 'image/png' });
  assert.equal(res.status, 200, JSON.stringify(res.body));
  const { rows } = await pool.query('SELECT storage, object_key, data FROM files');
  assert.equal(rows[0].storage, 'db');
  assert.equal(rows[0].object_key, null);
  assert.deepEqual(rows[0].data, Buffer.alloc(300, 7));
});
