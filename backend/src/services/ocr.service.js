const AppError = require('../utils/AppError');

/**
 * Reads a photographed delivery receipt with Google Gemini and returns its fields.
 * Needs GEMINI_API_KEY.
 *
 * Speed: several models are raced as a "hedged" chain. The first model starts at once;
 * if it fails the next starts immediately, and if it is merely slow the next one starts
 * after GEMINI_HEDGE_MS anyway. The first good answer wins and the others are cancelled.
 *
 * GEMINI_MODELS replaces the chain (comma separated, fastest first). Each entry may set
 * its thinking level as "model:level" (minimal | low | medium | high | off).
 */
// Chosen from a benchmark on the client's sample receipts (Nov 2026): fastest accurate first.
const DEFAULT_CHAIN = 'gemini-3-flash-preview:minimal,gemini-3.5-flash:minimal,gemini-flash-lite-latest:low,gemini-3.1-flash-lite:minimal';

const int = (v, fallback) => (Number(v) > 0 ? Number(v) : fallback);
const HEDGE_MS = int(process.env.GEMINI_HEDGE_MS, 3500); // start the next model if no answer by then
const ATTEMPT_TIMEOUT_MS = int(process.env.GEMINI_ATTEMPT_TIMEOUT_MS, 15000); // give up on one model
const TOTAL_TIMEOUT_MS = int(process.env.GEMINI_TOTAL_TIMEOUT_MS, 25000); // give up on the scan

function modelChain() {
  // GEMINI_MODEL (single, older setting) is tried first, with the default chain behind it.
  const single = process.env.GEMINI_MODEL ? `${process.env.GEMINI_MODEL},` : '';
  const raw = process.env.GEMINI_MODELS || single + DEFAULT_CHAIN;
  return raw
    .split(',')
    .map((entry) => entry.trim())
    .filter(Boolean)
    .map((entry) => {
      const [name, level] = entry.split(':').map((x) => x.trim());
      return { name, level: level || (/^gemini-2\./.test(name) ? 'off' : 'low') };
    });
}

// Names the mobile app has badges for.
const SOURCES = ['Deliveroo', 'Uber Eats', 'Just Eat', 'Eat Presto POS', 'Other'];

const PROMPT = `You are reading a photo of a printed UK restaurant delivery receipt
(Deliveroo, Uber Eats, Just Eat, or the restaurant's own website / POS such as Eat Presto).
First decide isReceipt: true only if the photo clearly shows a printed delivery / order receipt.
If it does not (blank, blurry beyond reading, a person, a screen, anything else), set isReceipt to false
and leave every other field empty. Never invent example or placeholder values.

Extract the fields below exactly as printed. Use an empty string when a field is not on the receipt.

- sourcePlatform: one of ${SOURCES.join(', ')}. Use "Eat Presto POS" for Eat Presto receipts and "Other" if unsure.
- externalOrderId: the order number or reference as printed (keep a leading #).
- customerName
- customerPhone: the phone number printed for the customer. Deliveroo and Uber Eats print a shared proxy number.
- phoneAccessCode: the access code / PIN printed after the proxy number (after a #), without the #.
- directCustomerPhone: a personal mobile number the customer wrote inside the address or notes, if any.
- deliveryAddress: flat / house number, street and town, written once, without the postcode.
- postcode: the UK delivery postcode.
- deliveryInstructions: delivery notes for the driver (door, intercom, cutlery and similar).
- suggestedPrepMinutes: minutes from a "Prepare by ... (40min)" line, otherwise 0.
- targetDeliveryTime: the delivery or due time printed, as HH:MM, otherwise "".
- orderTotalGbp: the order total in pounds as a number.
- items: every line item with quantity, name and line price in pounds.

Ignore handwriting on the receipt. Do not guess values that are not printed.`;

const RESPONSE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    isReceipt: { type: 'BOOLEAN' },
    sourcePlatform: { type: 'STRING', enum: SOURCES },
    externalOrderId: { type: 'STRING' },
    customerName: { type: 'STRING' },
    customerPhone: { type: 'STRING' },
    phoneAccessCode: { type: 'STRING' },
    directCustomerPhone: { type: 'STRING' },
    deliveryAddress: { type: 'STRING' },
    postcode: { type: 'STRING' },
    deliveryInstructions: { type: 'STRING' },
    suggestedPrepMinutes: { type: 'INTEGER' },
    targetDeliveryTime: { type: 'STRING' },
    orderTotalGbp: { type: 'NUMBER' },
    items: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          quantity: { type: 'INTEGER' },
          name: { type: 'STRING' },
          price: { type: 'NUMBER' },
        },
        required: ['quantity', 'name', 'price'],
      },
    },
  },
  required: ['isReceipt', 'sourcePlatform', 'deliveryAddress', 'postcode', 'items'],
  propertyOrdering: [
    'isReceipt', 'sourcePlatform', 'externalOrderId', 'customerName', 'customerPhone', 'phoneAccessCode',
    'directCustomerPhone', 'deliveryAddress', 'postcode', 'deliveryInstructions', 'suggestedPrepMinutes',
    'targetDeliveryTime', 'orderTotalGbp', 'items',
  ],
};

const text = (v) => (typeof v === 'string' ? v.trim() : '');
const number = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);


function generationConfig({ name, level }, { withThinking = true } = {}) {
  const config = { responseMimeType: 'application/json', responseSchema: RESPONSE_SCHEMA };
  if (!withThinking) return config;
  // Gemini 3 models are tuned for the default temperature, so it is left alone.
  if (level === 'off' && /^gemini-2\./.test(name)) config.thinkingConfig = { thinkingBudget: 0 };
  else if (level !== 'off') config.thinkingConfig = { thinkingLevel: level };
  return config;
}

/** Failure of one model; `next` says whether another model may still succeed. */
class AttemptError extends Error {
  constructor(code, message, next = true) {
    super(message);
    this.code = code;
    this.next = next;
  }
}

async function callModel(model, imageBase64, mimeType, apiKey, signal) {
  const request = (config) =>
    fetch(`https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model.name)}:generateContent`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
      signal: AbortSignal.any([signal, AbortSignal.timeout(ATTEMPT_TIMEOUT_MS)]),
      body: JSON.stringify({
        contents: [{ parts: [{ text: PROMPT }, { inline_data: { mime_type: mimeType, data: imageBase64 } }] }],
        generationConfig: config,
      }),
    });

  let res;
  try {
    res = await request(generationConfig(model));
    if (res.status === 400) {
      const detail = await res.text().catch(() => '');
      // A model that rejects the thinking setting is retried once without it.
      if (/API_KEY_INVALID|API key not valid/.test(detail)) {
        throw new AttemptError('OCR_KEY_INVALID', `${model.name}: 400 ${detail.slice(0, 300)}`, false);
      }
      if (/thinking/i.test(detail)) res = await request(generationConfig(model, { withThinking: false }));
      else throw new AttemptError('OCR_FAILED', `${model.name}: 400 ${detail.slice(0, 300)}`);
    }
  } catch (err) {
    if (err instanceof AttemptError) throw err;
    throw new AttemptError('OCR_UNAVAILABLE', `${model.name}: ${err.name === 'TimeoutError' ? 'timed out' : err.name}`);
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    // A bad or blocked key fails the same way on every model: stop at once.
    if (res.status === 401 || res.status === 403 || /API_KEY_INVALID|API key not valid/.test(detail)) {
      throw new AttemptError('OCR_KEY_INVALID', `${model.name}: ${res.status} ${detail.slice(0, 300)}`, false);
    }
    throw new AttemptError('OCR_FAILED', `${model.name}: ${res.status} ${detail.slice(0, 300)}`);
  }

  let parsed;
  try {
    const body = await res.json();
    parsed = JSON.parse(body.candidates[0].content.parts[0].text);
  } catch {
    throw new AttemptError('OCR_UNREADABLE', `${model.name}: answer was not valid JSON`);
  }
  return toDraft(parsed, model.name);
}

/** Drops a house number some models repeat at the end ("19 Rosemont Rd, London, 19"). */
function cleanAddress(value) {
  const address = text(value);
  const lead = address.match(/^(\d+[a-z]?)\b/i);
  return lead ? address.replace(new RegExp(`,\\s*${lead[1]}$`, 'i'), '') : address;
}

function toDraft(parsed, modelName) {
  const items = (Array.isArray(parsed.items) ? parsed.items : [])
    .map((i) => ({ quantity: Math.max(1, Math.round(number(i.quantity)) || 1), name: text(i.name), price: number(i.price) }))
    .filter((i) => i.name);

  if (parsed.isReceipt === false) {
    throw new AttemptError('OCR_UNREADABLE', `${modelName}: photo is not a receipt`, false);
  }
  if (!text(parsed.deliveryAddress) && !text(parsed.postcode) && items.length === 0) {
    throw new AttemptError('OCR_UNREADABLE', `${modelName}: no order details found`);
  }

  return {
    source: SOURCES.includes(parsed.sourcePlatform) ? parsed.sourcePlatform : 'Other',
    externalOrderId: text(parsed.externalOrderId),
    customerName: text(parsed.customerName),
    customerPhone: text(parsed.customerPhone),
    phoneAccessCode: text(parsed.phoneAccessCode).replace(/^#/, ''),
    directCustomerPhone: text(parsed.directCustomerPhone),
    deliveryAddress: cleanAddress(parsed.deliveryAddress),
    postcode: text(parsed.postcode),
    deliveryInstructions: text(parsed.deliveryInstructions),
    suggestedPrepMinutes: Math.max(0, Math.round(number(parsed.suggestedPrepMinutes))),
    printedTime: text(parsed.targetDeliveryTime),
    orderTotalGbp: number(parsed.orderTotalGbp),
    items,
  };
}

const USER_MESSAGES = {
  OCR_KEY_INVALID: [503, 'Receipt scanning is not set up correctly. Ask the administrator to check the Gemini API key.'],
  OCR_UNREADABLE: [422, 'We could not find order details in that photo. Retake it with the whole receipt in frame.'],
  OCR_FAILED: [502, 'The receipt could not be read. Please try again.'],
  OCR_UNAVAILABLE: [502, 'The receipt reader could not be reached. Please try again.'],
};

/**
 * Races the model chain (see the top of this file) and returns the first good draft.
 * @returns {Promise<object>} the draft, with `model` and `ms` for the logs.
 */
async function scanReceipt(imageBase64, mimeType) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new AppError(503, 'OCR_NOT_CONFIGURED', 'Receipt scanning is not set up yet. Ask the administrator to add the Gemini API key.');
  }

  const chain = modelChain();
  const started = Date.now();
  const cancelAll = new AbortController();
  const failures = [];

  try {
    return await new Promise((resolve, reject) => {
      let nextIndex = 0;
      let running = 0;
      let settled = false;
      let hedgeTimer = null;

      const finish = (fn, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(hedgeTimer);
        clearTimeout(totalTimer);
        fn(value);
      };

      const giveUp = () => {
        // A model that read the photo but found nothing is the most useful thing to tell the user.
        const code =
          failures.find((f) => f.code === 'OCR_KEY_INVALID')?.code ||
          failures.find((f) => f.code === 'OCR_UNREADABLE')?.code ||
          failures.at(-1)?.code ||
          'OCR_UNAVAILABLE';
        console.error(`Receipt scan failed after ${Date.now() - started} ms: ${failures.map((f) => f.message.replace(/\s+/g, ' ').slice(0, 200)).join(' | ')}`);
        const [status, message] = USER_MESSAGES[code];
        finish(reject, new AppError(status, code, message));
      };

      const launch = () => {
        if (settled || nextIndex >= chain.length) return;
        const model = chain[nextIndex++];
        running += 1;
        clearTimeout(hedgeTimer);
        hedgeTimer = setTimeout(launch, HEDGE_MS); // slow answer: start the next model too

        callModel(model, imageBase64, mimeType, apiKey, cancelAll.signal).then(
          (draft) => {
            const ms = Date.now() - started;
            if (!settled) console.log(`Receipt scanned by ${model.name} in ${ms} ms.`);
            finish(resolve, draft);
          },
          (err) => {
            running -= 1;
            if (settled) return;
            failures.push(err);
            if (err.next === false) return giveUp();
            if (nextIndex < chain.length) launch(); // failed: start the next model at once
            else if (running === 0) giveUp();
          }
        );
      };

      const totalTimer = setTimeout(() => {
        failures.push(new AttemptError('OCR_UNAVAILABLE', `no answer within ${TOTAL_TIMEOUT_MS} ms`));
        giveUp();
      }, TOTAL_TIMEOUT_MS);

      launch();
    });
  } finally {
    cancelAll.abort(); // stop the models that lost the race
  }
}

module.exports = { scanReceipt, modelChain, SOURCES, PROMPT, RESPONSE_SCHEMA };
