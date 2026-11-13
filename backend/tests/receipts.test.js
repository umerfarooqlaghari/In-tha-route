const { test, describe, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('http');
const request = require('supertest');

process.env.NODE_ENV = 'test';
process.env.JWT_SECRET = 'test-secret-test-secret-test-secret-1234';
process.env.BCRYPT_ROUNDS = '4';
process.env.PUSH_DISABLED = 'true';
delete process.env.GOOGLE_MAPS_API_KEY;

const { startTestDatabase } = require('./helpers/testDb');

/** A tiny in-memory S3 (path-style PUT / GET / DELETE / HEAD), enough for the real AWS SDK. */
function startFakeS3() {
  const objects = new Map(); // "bucket/key" -> { body, type }
  const state = { failPuts: false };
  const server = http.createServer((req, res) => {
    const path = decodeURIComponent(new URL(req.url, 'http://x').pathname.slice(1));
    const chunks = [];
    req.on('data', (c) => chunks.push(c));
    req.on('end', () => {
      if (req.method === 'PUT' && state.failPuts) {
        res.writeHead(403, { 'Content-Type': 'application/xml' })
          .end('<?xml version="1.0"?><Error><Code>AccessDenied</Code><Message>no</Message></Error>');
      } else if (req.method === 'PUT') {
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
    server.listen(0, '127.0.0.1', () =>
      resolve({ objects, state, port: server.address().port, close: () => server.close() })
    )
  );
}

/* ---- Fake outside services: postcodes.io only. The receipt reader is stubbed below. ---- */
const POSTCODES = {
  TW91DT: { latitude: 51.4613, longitude: -0.3037 },
  TW106QN: { latitude: 51.4545, longitude: -0.297 },
};
const realFetch = global.fetch;
global.fetch = async (url, init = {}) => {
  const u = String(url);
  if (u.startsWith('https://api.postcodes.io/postcodes/')) {
    const hit = POSTCODES[decodeURIComponent(u.split('/').pop())];
    return new Response(JSON.stringify(hit ? { result: hit } : { error: 'Invalid postcode' }), {
      status: hit ? 200 : 404,
      headers: { 'Content-Type': 'application/json' },
    });
  }
  return realFetch(url, init);
};

const RECEIPT = {
  sourcePlatform: 'Uber Eats',
  externalOrderId: '#R1001',
  customerName: 'Liam Test',
  customerPhone: '+441388436844',
  deliveryAddress: '22 Kings Road, Richmond',
  postcode: 'TW10 6QN',
  deliveryInstructions: '',
  orderTotalGbp: 18.5,
  items: [{ quantity: 1, name: 'Chicken biryani', price: 18.5 }],
  suggestedPrepMinutes: 20,
};

const ADMIN = { email: 'owner@intharoute.test', password: 'AdminPass123' };
const bearer = (token) => ({ Authorization: `Bearer ${token}` });
const photoBytes = (byte) => Buffer.alloc(400, byte);
const photo = (byte) => photoBytes(byte).toString('base64');

let stopDb, s3, app, pool, ocr, adminToken, driverToken;
const NOTE = 'Leave at the side door, ring twice';
const saffron = {};
const other = {};

const scan = (who, byte) =>
  request(app)
    .post('/api/restaurant/receipts/scan')
    .set(bearer(who.token))
    .send({ imageBase64: photo(byte), mimeType: 'image/jpeg' });

const post = (who, extra) =>
  request(app)
    .post('/api/restaurant/orders')
    .set(bearer(who.token))
    .send({
      source: 'Uber Eats',
      customerName: 'Liam Test',
      customerPhone: '+441388436844',
      deliveryAddress: '22 Kings Road, Richmond',
      postcode: 'TW10 6QN',
      prepMinutes: 20,
      dispatchType: 'open_platform',
      items: [],
      ...extra,
    });

const receiptFiles = async () =>
  (await pool.query(`SELECT id, owner_user_id, storage, object_key, folder FROM files WHERE folder = 'receipts' ORDER BY created_at`)).rows;

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

  // The receipt reader (Gemini) is never called in tests.
  ocr = require('../src/services/ocr.service');
  ocr.scanReceipt = async () => ({ ...RECEIPT });

  for (const [who, email, name] of [[saffron, 'saffron@receipts.test', 'Saffron'], [other, 'other@receipts.test', 'Other Place']]) {
    const res = await request(app).post('/api/auth/signup').send({
      role: 'restaurant', email, password: 'Passw0rd123', fullName: `${name} Staff`,
      phone: '020 8940 5521', restaurantName: name, address: '5 The Square, Richmond', postcode: 'TW9 1DT',
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    Object.assign(who, { token: res.body.tokens.accessToken, userId: res.body.user.id });
  }
  const d = await request(app).post('/api/auth/signup').send({
    role: 'driver', email: 'rider@receipts.test', password: 'Passw0rd123', fullName: 'Receipt Rider',
    phone: '+44 7841 000000', vehicle: 'Car', plateNumber: 'ab12 cde',
  });
  assert.equal(d.status, 201, JSON.stringify(d.body));
  driverToken = d.body.tokens.accessToken;
  await pool.query(`UPDATE driver_profiles SET status = 'offline' WHERE id = $1`, [d.body.user.driver.id]);
});

after(async () => {
  global.fetch = realFetch;
  if (pool) await pool.end();
  if (s3) s3.close();
  if (stopDb) await stopDb();
});

describe('receipt photos are kept with the order', () => {
  let draft, order;

  test('a scan saves the photo in the bucket under receipts/', async () => {
    const res = await scan(saffron, 1);
    assert.equal(res.status, 200, JSON.stringify(res.body));
    draft = res.body.draft;
    assert.match(draft.receiptFileId, /^[0-9a-f-]{36}$/);

    const rows = await receiptFiles();
    assert.equal(rows.length, 1);
    assert.equal(rows[0].id, draft.receiptFileId);
    assert.equal(rows[0].storage, 's3');
    assert.match(rows[0].object_key, new RegExp(`^receipts/${saffron.userId}/[0-9a-f-]+\\.jpg$`));
    const stored = s3.objects.get(`itr-test/test/${rows[0].object_key}`);
    assert.ok(stored, 'object is in the bucket');
    assert.deepEqual(stored.body, photoBytes(1));
  });

  test('posting the order links the photo to it', async () => {
    const res = await post(saffron, {
      externalOrderId: draft.externalOrderId,
      receiptFileId: draft.receiptFileId,
      deliveryInstructions: NOTE,
    });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    order = res.body.order;
    assert.equal(order.hasReceipt, true);
    assert.equal(res.body.dashboard.orders.find((o) => o.id === order.id).hasReceipt, true);
    const { rows } = await pool.query('SELECT receipt_file_id FROM orders WHERE id = $1', [order.id]);
    assert.equal(rows[0].receipt_file_id, draft.receiptFileId);
  });

  test('the restaurant opens its own receipt', async () => {
    const res = await request(app).get(`/api/restaurant/orders/${order.id}/receipt`).set(bearer(saffron.token));
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'image/jpeg');
    assert.deepEqual(res.body, photoBytes(1));
  });

  test('the admin sees the flag and opens the receipt', async () => {
    const dash = await request(app).get('/api/admin/dashboard').set(bearer(adminToken));
    assert.equal(dash.body.orders.find((o) => o.id === order.id).hasReceipt, true);
    const res = await request(app).get(`/api/admin/orders/${order.id}/receipt`).set(bearer(adminToken));
    assert.equal(res.status, 200);
    assert.deepEqual(res.body, photoBytes(1));
  });

  test('another restaurant cannot open it', async () => {
    const res = await request(app).get(`/api/restaurant/orders/${order.id}/receipt`).set(bearer(other.token));
    assert.equal(res.status, 404);
  });

  test('a driver browsing the pool cannot open it and sees no note or photo flag', async () => {
    let res = await request(app).get(`/api/restaurant/orders/${order.id}/receipt`).set(bearer(driverToken));
    assert.equal(res.status, 403);
    res = await request(app).get(`/api/admin/orders/${order.id}/receipt`).set(bearer(driverToken));
    assert.equal(res.status, 403);
    await request(app).put('/api/driver/availability').set(bearer(driverToken)).send({ online: true });
    await request(app).put('/api/driver/location').set(bearer(driverToken)).send({ latitude: 51.4613, longitude: -0.3037 });
    const dash = await request(app).get('/api/driver/dashboard').set(bearer(driverToken));
    assert.equal(dash.status, 200, JSON.stringify(dash.body));
    assert.ok(dash.body.orders.some((o) => o.id === order.id && !o.batchId), 'the order is in the pool');
    assert.ok(!JSON.stringify(dash.body).includes('hasReceipt":true'));
    assert.ok(!JSON.stringify(dash.body).includes(draft.receiptFileId));
    assert.ok(!JSON.stringify(dash.body).includes(NOTE));
    res = await request(app).get(`/api/driver/orders/${order.id}/receipt`).set(bearer(driverToken));
    assert.equal(res.status, 404);
  });

  test('the driver who takes the order sees the note and opens the receipt', async () => {
    let res = await request(app).post(`/api/driver/pool/${order.id}/add`).set(bearer(driverToken));
    assert.equal(res.body.ok, true, JSON.stringify(res.body));
    const mine = res.body.dashboard.orders.find((o) => o.id === order.id);
    assert.equal(mine.hasReceipt, true);
    assert.equal(mine.deliveryInstructions, NOTE);
    assert.ok(!JSON.stringify(res.body).includes(draft.receiptFileId), 'the file id itself is never sent');
    res = await request(app).get(`/api/driver/orders/${order.id}/receipt`).set(bearer(driverToken));
    assert.equal(res.status, 200);
    assert.equal(res.headers['content-type'], 'image/jpeg');
    assert.deepEqual(res.body, photoBytes(1));
  });

  test('another driver cannot open it, nor can a restaurant through the driver route', async () => {
    const d = await request(app).post('/api/auth/signup').send({
      role: 'driver', email: 'second@receipts.test', password: 'Passw0rd123', fullName: 'Second Rider',
      phone: '+44 7841 000001', vehicle: 'Car', plateNumber: 'ab12 cdf',
    });
    assert.equal(d.status, 201, JSON.stringify(d.body));
    await pool.query(`UPDATE driver_profiles SET status = 'offline' WHERE id = $1`, [d.body.user.driver.id]);
    let res = await request(app).get(`/api/driver/orders/${order.id}/receipt`).set(bearer(d.body.tokens.accessToken));
    assert.equal(res.status, 404);
    res = await request(app).get(`/api/driver/orders/${order.id}/receipt`).set(bearer(saffron.token));
    assert.equal(res.status, 403);
  });

  test('the driver keeps it until the run is finished, not afterwards', async () => {
    const mine = () => request(app).get(`/api/driver/orders/${order.id}/receipt`).set(bearer(driverToken));
    await request(app).post('/api/driver/batch/advance').set(bearer(driverToken)).expect(200); // picked up
    assert.equal((await mine()).status, 200);
    await request(app).post('/api/driver/batch/advance').set(bearer(driverToken)).expect(200); // delivered
    assert.equal((await mine()).status, 200, 'still on the "Batch complete" screen');
    await request(app).post('/api/driver/batch/next').set(bearer(driverToken)).expect(200); // run closed
    assert.equal((await mine()).status, 404);
    // The restaurant and the admin still have it.
    const res = await request(app).get(`/api/admin/orders/${order.id}/receipt`).set(bearer(adminToken));
    assert.equal(res.status, 200);
  });

  test('one photo cannot be put on a second order', async () => {
    const res = await post(saffron, { externalOrderId: '#R1002', receiptFileId: draft.receiptFileId });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.order.hasReceipt, false);
  });

  test("another restaurant's photo is ignored, the order still goes through", async () => {
    const theirs = (await scan(other, 2)).body.draft.receiptFileId;
    assert.ok(theirs);
    const res = await post(saffron, { externalOrderId: '#R1003', receiptFileId: theirs });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.order.hasReceipt, false);
    // Still free for its real owner.
    const own = await post(other, { externalOrderId: '#R2001', receiptFileId: theirs });
    assert.equal(own.body.order.hasReceipt, true);
  });

  test('an order typed without a scan, or with a broken photo id, has no receipt', async () => {
    let res = await post(saffron, { externalOrderId: '#R1004' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.order.hasReceipt, false);
    res = await post(saffron, { externalOrderId: '#R1005', receiptFileId: 'not-an-id' });
    assert.equal(res.status, 201, JSON.stringify(res.body));
    assert.equal(res.body.order.hasReceipt, false);
    const photoRes = await request(app).get(`/api/restaurant/orders/${res.body.order.id}/receipt`).set(bearer(saffron.token));
    assert.equal(photoRes.status, 404);
  });

  test('the same photo posted twice at once lands on one order only', async () => {
    const id = (await scan(saffron, 3)).body.draft.receiptFileId;
    const both = await Promise.all([
      post(saffron, { externalOrderId: '', receiptFileId: id }),
      post(saffron, { externalOrderId: '', receiptFileId: id }),
    ]);
    assert.deepEqual(both.map((r) => r.status), [201, 201]);
    assert.equal(both.filter((r) => r.body.order.hasReceipt).length, 1);
  });

  test('a photo that is not a receipt is not kept', async () => {
    const before = (await receiptFiles()).length;
    const AppError = require('../src/utils/AppError');
    ocr.scanReceipt = async () => {
      throw new AppError(422, 'OCR_UNREADABLE', 'That does not look like a receipt.');
    };
    const res = await scan(saffron, 4);
    assert.equal(res.status, 422);
    assert.equal((await receiptFiles()).length, before);
    ocr.scanReceipt = async () => ({ ...RECEIPT });
  });

  test('if storage is down the scan still works, without a photo', async () => {
    s3.state.failPuts = true;
    const before = (await receiptFiles()).length;
    const res = await scan(saffron, 5);
    s3.state.failPuts = false;
    assert.equal(res.status, 200, JSON.stringify(res.body));
    assert.equal(res.body.draft.receiptFileId, undefined);
    assert.equal(res.body.draft.customerName, 'Liam Test');
    assert.equal((await receiptFiles()).length, before);
  });
});

describe('scans that never became an order', () => {
  test('are removed after a day, bucket object included; linked and fresh ones stay', async () => {
    const files = require('../src/services/file.service');
    const stale = (await scan(saffron, 6)).body.draft.receiptFileId;
    const fresh = (await scan(saffron, 7)).body.draft.receiptFileId;
    const linkedCount = (await pool.query('SELECT count(*)::int AS n FROM orders WHERE receipt_file_id IS NOT NULL')).rows[0].n;
    // Everything except the fresh scan is two days old.
    await pool.query(`UPDATE files SET created_at = now() - interval '2 days' WHERE id <> $1`, [fresh]);
    const staleKey = (await pool.query('SELECT object_key FROM files WHERE id = $1', [stale])).rows[0].object_key;
    assert.ok(s3.objects.has(`itr-test/test/${staleKey}`));

    const removed = await files.deleteUnpostedReceipts();
    assert.ok(removed >= 1);

    const left = (await receiptFiles()).map((r) => r.id);
    assert.ok(!left.includes(stale), 'the old unposted scan is gone');
    assert.ok(left.includes(fresh), 'a recent scan is kept');
    assert.ok(!s3.objects.has(`itr-test/test/${staleKey}`), 'its bucket object is gone');
    assert.equal(
      (await pool.query('SELECT count(*)::int AS n FROM orders WHERE receipt_file_id IS NOT NULL')).rows[0].n,
      linkedCount,
      'photos on orders are never removed'
    );
    assert.equal(s3.objects.size, left.length);
  });

  test('driver documents are never touched by the clean-up', async () => {
    const files = require('../src/services/file.service');
    const id = await files.saveImage({ imageBase64: photo(9), mimeType: 'image/png', ownerUserId: saffron.userId });
    await pool.query(`UPDATE files SET created_at = now() - interval '30 days' WHERE id = $1`, [id]);
    await files.deleteUnpostedReceipts();
    assert.equal((await pool.query('SELECT folder FROM files WHERE id = $1', [id])).rows[0].folder, 'kyc');
  });
});
