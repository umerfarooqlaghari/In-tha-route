const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-1234';
process.env.BCRYPT_ROUNDS = '4';

const { startTestDatabase } = require('./helpers/testDb');

/** A tiny in-memory S3 (path-style PUT / GET / DELETE / HEAD), enough for the real AWS SDK. */
function startFakeS3() {
  const objects = new Map(); // "bucket/key" -> { body, type }
  const server = http.createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname.slice(1));
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (req.method === 'PUT') {
        objects.set(path, { body: Buffer.concat(chunks), type: req.headers['content-type'] });
        res.writeHead(200, { ETag: '"x"' }).end();
      } else if (req.method === 'GET' && objects.has(path)) {
        const o = objects.get(path);
        res.writeHead(200, { 'Content-Type': o.type, 'Content-Length': o.body.length }).end(o.body);
      } else if (req.method === 'HEAD') {
        res.writeHead(200).end();
      } else if (req.method === 'DELETE') {
        objects.delete(path);
        res.writeHead(204).end();
      } else {
        res.writeHead(404, { 'Content-Type': 'application/xml' })
          .end('<?xml version="1.0"?><Error><Code>NoSuchKey</Code><Message>missing</Message></Error>');
      }
    });
  });
  return new Promise((resolve) =>
    server.listen(0, '127.0.0.1', () => resolve({ objects, port: server.address().port, close: () => server.close() }))
  );
}

const ADMIN = { email: 'owner@intharoute.test', password: 'AdminPass123' };
const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const photo = (byte) => Buffer.alloc(300, byte).toString('base64');

let stopDb, s3, app, pool, adminToken, driver;

before(async () => {
  stopDb = await startTestDatabase();
  s3 = await startFakeS3();
  Object.assign(process.env, {
    S3_BUCKET: 'itr-test',
    S3_ENDPOINT: `http://127.0.0.1:${s3.port}`,
    S3_KEY_PREFIX: 'test',
    AWS_REGION: 'eu-west-2',
    AWS_ACCESS_KEY_ID: 'test',
    AWS_SECRET_ACCESS_KEY: 'test',
  });

  app = require('../src/app');
  ({ pool } = require('../src/config/db'));
  await require('../src/db/migrate').runMigrations(pool, () => {});
  await require('../src/db/seedAdmin').seedAdmin(pool, { ADMIN_EMAIL: ADMIN.email, ADMIN_PASSWORD: ADMIN.password }, () => {});
  adminToken = (await request(app).post('/api/auth/login').send(ADMIN)).body.tokens.accessToken;

  const signup = await request(app).post('/api/auth/signup').send({
    role: 'driver',
    email: 'rider@files.test',
    password: 'Passw0rd123',
    fullName: 'File Rider',
    phone: '+44 7841 000000',
    vehicle: 'Car',
    plateNumber: 'ab12 cde',
  });
  assert.equal(signup.status, 201);
  driver = { token: signup.body.tokens.accessToken, id: signup.body.user.driver.id, userId: signup.body.user.id };
});

after(async () => {
  if (pool) await pool.end();
  if (s3) s3.close();
  if (stopDb) await stopDb();
});

const documents = async () =>
  (await pool.query('SELECT id, file_id FROM kyc_documents WHERE driver_id = $1 ORDER BY doc_type', [driver.id])).rows;

const upload = (docId, byte) =>
  request(app)
    .post(`/api/driver/documents/${docId}/upload`)
    .set(bearer(driver.token))
    .send({ imageBase64: photo(byte), mimeType: 'image/jpeg' });

describe('KYC photos in S3', () => {
  test('an upload goes to the bucket, not the database', async () => {
    const [doc] = await documents();
    const res = await upload(doc.id, 1);
    assert.equal(res.status, 200, JSON.stringify(res.body));

    const { rows } = await pool.query('SELECT storage, object_key, data FROM files');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].storage, 's3');
    assert.equal(rows[0].data, null);
    assert.match(rows[0].object_key, new RegExp(`^kyc/${driver.userId}/[0-9a-f-]+\\.jpg$`));
    const stored = s3.objects.get(`itr-test/test/${rows[0].object_key}`);
    assert.ok(stored, 'object is in the bucket under the key prefix');
    assert.deepEqual(stored.body, Buffer.alloc(300, 1));
    assert.equal(stored.type, 'image/jpeg');
  });

  test('the admin sees the photo read back from S3', async () => {
    const [doc] = await documents();
    const res = await request(app).get(`/api/admin/kyc-documents/${doc.id}/file`).set(bearer(adminToken));
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'image/jpeg');
    assert.deepEqual(res.body, Buffer.alloc(300, 1));
  });

  test('re-uploading replaces the old object', async () => {
    const [doc] = await documents();
    assert.equal((await upload(doc.id, 2)).status, 200);
    assert.equal(s3.objects.size, 1);
    assert.deepEqual([...s3.objects.values()][0].body, Buffer.alloc(300, 2));
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM files')).rows[0].n, 1);
  });

  test('a missing object answers 404, not a crash', async () => {
    const [doc] = await documents();
    s3.objects.clear();
    const res = await request(app).get(`/api/admin/kyc-documents/${doc.id}/file`).set(bearer(adminToken));
    assert.equal(res.status, 404);
    assert.equal((await upload(doc.id, 3)).status, 200); // restore for the next tests
  });

  test('photos saved in the database before S3 still open, and can be moved', async () => {
    const [, doc2] = await documents();
    const legacy = await pool.query(
      `INSERT INTO files (owner_user_id, mime_type, size_bytes, data) VALUES ($1, 'image/png', 3, '\\x010203') RETURNING id`,
      [driver.userId]
    );
    await pool.query(`UPDATE kyc_documents SET file_id = $1, status = 'pending' WHERE id = $2`, [legacy.rows[0].id, doc2.id]);

    let res = await request(app).get(`/api/admin/kyc-documents/${doc2.id}/file`).set(bearer(adminToken));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, Buffer.from([1, 2, 3]));

    const { moveFilesToS3 } = require('../src/db/moveFilesToS3');
    const moved = await moveFilesToS3(pool, require('../src/services/storage.service'), () => {});
    assert.equal(moved, 1);
    const { rows } = await pool.query('SELECT storage, data FROM files WHERE id = $1', [legacy.rows[0].id]);
    assert.deepEqual(rows[0], { storage: 's3', data: null });

    res = await request(app).get(`/api/admin/kyc-documents/${doc2.id}/file`).set(bearer(adminToken));
    assert.deepEqual(res.body, Buffer.from([1, 2, 3]));
    assert.equal(await moveFilesToS3(pool, require('../src/services/storage.service'), () => {}), 0);
  });

  test('rejecting the driver deletes their photos from the bucket', async () => {
    assert.equal(s3.objects.size, 2);
    const res = await request(app)
      .post(`/api/admin/drivers/${driver.id}/reject`)
      .set(bearer(adminToken))
      .send({ reason: 'Blurry photos' });
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(s3.objects.size, 0);
    assert.equal((await pool.query('SELECT count(*)::int AS n FROM files')).rows[0].n, 0);
  });

  test('the database refuses a row that is in neither place', async () => {
    await assert.rejects(
      pool.query(`INSERT INTO files (mime_type, size_bytes, storage) VALUES ('image/jpeg', 1, 's3')`),
      /files_location_chk/
    );
  });
});
