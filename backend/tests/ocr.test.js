const { test, describe, beforeEach, afterEach } = require('node:test');
const assert = require('node:assert/strict');

process.env.GEMINI_API_KEY = 'test-key';
process.env.GEMINI_MODELS = 'model-a:minimal,model-b:low,model-c:off';
process.env.GEMINI_HEDGE_MS = '100';
process.env.GEMINI_ATTEMPT_TIMEOUT_MS = '2000';
process.env.GEMINI_TOTAL_TIMEOUT_MS = '3000';
delete process.env.GEMINI_MODEL;

const { scanReceipt } = require('../src/services/ocr.service');

const RECEIPT = {
  isReceipt: true,
  sourcePlatform: 'Deliveroo',
  externalOrderId: '#8680',
  customerName: 'Anna T.',
  deliveryAddress: '19 Rosemont Rd, Richmond, 19',
  postcode: 'TW10 6QN',
  orderTotalGbp: 51.25,
  items: [{ quantity: 1, name: 'Papad Basket', price: 6 }],
};

const answer = (body) =>
  new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text: JSON.stringify(body) }] } }] }), { status: 200 });
const error = (status, message) => new Response(JSON.stringify({ error: { code: status, message } }), { status });
const wait = (ms, signal) =>
  new Promise((resolve, reject) => {
    const t = setTimeout(resolve, ms);
    signal?.addEventListener('abort', () => {
      clearTimeout(t);
      reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
    });
  });

let realFetch, calls, behaviour;

beforeEach(() => {
  realFetch = global.fetch;
  calls = [];
  global.fetch = async (url, init) => {
    const model = decodeURIComponent(url.match(/models\/([^:]+):/)[1]);
    const config = JSON.parse(init.body).generationConfig;
    calls.push({ model, at: Date.now(), thinking: config.thinkingConfig });
    return behaviour[model](init.signal, calls.filter((c) => c.model === model).length);
  };
});
afterEach(() => {
  global.fetch = realFetch;
});

const scan = () => scanReceipt('aGVsbG8=', 'image/jpeg');

describe('receipt scanning model chain', () => {
  test('the first model answers: only one request is made', async () => {
    behaviour = { 'model-a': async () => answer(RECEIPT) };
    const draft = await scan();
    assert.equal(draft.externalOrderId, '#8680');
    assert.equal(draft.deliveryAddress, '19 Rosemont Rd, Richmond'); // repeated house number dropped
    assert.deepEqual(calls.map((c) => c.model), ['model-a']);
    assert.deepEqual(calls[0].thinking, { thinkingLevel: 'minimal' });
  });

  test('a failing model hands over to the next one at once', async () => {
    behaviour = {
      'model-a': async () => error(503, 'This model is currently experiencing high demand.'),
      'model-b': async () => answer(RECEIPT),
    };
    const draft = await scan();
    assert.equal(draft.customerName, 'Anna T.');
    assert.deepEqual(calls.map((c) => c.model), ['model-a', 'model-b']);
    assert.ok(calls[1].at - calls[0].at < 50, 'no hedge delay after a failure');
  });

  test('a slow model is raced by the next one, and the faster answer wins', async () => {
    behaviour = {
      'model-a': async (signal) => {
        await wait(1500, signal);
        return answer({ ...RECEIPT, customerName: 'slow' });
      },
      'model-b': async () => answer({ ...RECEIPT, customerName: 'fast' }),
    };
    const started = Date.now();
    const draft = await scan();
    assert.equal(draft.customerName, 'fast');
    assert.ok(Date.now() - started < 600, 'did not wait for the slow model');
    assert.deepEqual(calls.map((c) => c.model), ['model-a', 'model-b']);
  });

  test('a model that rejects the thinking level is retried without it', async () => {
    behaviour = {
      'model-a': async (signal, n) =>
        n === 1 ? error(400, 'Thinking level MINIMAL is not supported for this model.') : answer(RECEIPT),
    };
    await scan();
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[0].thinking, { thinkingLevel: 'minimal' });
    assert.equal(calls[1].thinking, undefined);
  });

  test('an invalid API key stops straight away', async () => {
    behaviour = { 'model-a': async () => error(400, 'API key not valid. Please pass a valid API key.') };
    await assert.rejects(scan(), (err) => err.status === 503 && err.code === 'OCR_KEY_INVALID');
    assert.equal(calls.length, 1);
  });

  test('a photo that is not a receipt is refused, never invented', async () => {
    behaviour = { 'model-a': async () => answer({ isReceipt: false, sourcePlatform: 'Other', deliveryAddress: '', postcode: '', items: [] }) };
    await assert.rejects(scan(), (err) => err.status === 422 && err.code === 'OCR_UNREADABLE');
    assert.equal(calls.length, 1);
  });

  test('when every model fails the user gets a clear error', async () => {
    behaviour = {
      'model-a': async () => error(429, 'quota'),
      'model-b': async () => error(503, 'busy'),
      'model-c': async () => error(500, 'internal'),
    };
    await assert.rejects(scan(), (err) => err.status === 502 && err.code === 'OCR_FAILED');
    assert.deepEqual(calls.map((c) => c.model), ['model-a', 'model-b', 'model-c']);
  });

  test('if nothing answers in time the scan gives up at the total limit', async () => {
    behaviour = {
      'model-a': async (signal) => wait(10000, signal),
      'model-b': async (signal) => wait(10000, signal),
      'model-c': async (signal) => wait(10000, signal),
    };
    const started = Date.now();
    await assert.rejects(scan(), (err) => err.code === 'OCR_UNAVAILABLE');
    const took = Date.now() - started;
    assert.ok(took >= 1900 && took < 3200, `gave up after ${took} ms`);
  });
});
