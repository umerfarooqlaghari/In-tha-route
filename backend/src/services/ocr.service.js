const AppError = require('../utils/AppError');

/**
 * Reads a photographed delivery receipt with Google Gemini and returns its fields.
 * Needs GEMINI_API_KEY. GEMINI_MODEL can override the model name.
 */
const MODEL = process.env.GEMINI_MODEL || 'gemini-2.5-flash';
const TIMEOUT_MS = 45000;

// Names the mobile app has badges for.
const SOURCES = ['Deliveroo', 'Uber Eats', 'Just Eat', 'Eat Presto POS', 'Other'];

const PROMPT = `You are reading a photo of a printed UK restaurant delivery receipt
(Deliveroo, Uber Eats, Just Eat, or the restaurant's own website / POS such as Eat Presto).
Extract the fields below exactly as printed. Use an empty string when a field is not on the receipt.

- sourcePlatform: one of ${SOURCES.join(', ')}. Use "Eat Presto POS" for Eat Presto receipts and "Other" if unsure.
- externalOrderId: the order number or reference as printed (keep a leading #).
- customerName
- customerPhone: the phone number printed for the customer. Deliveroo and Uber Eats print a shared proxy number.
- phoneAccessCode: the access code / PIN printed after the proxy number (after a #), without the #.
- directCustomerPhone: a personal mobile number the customer wrote inside the address or notes, if any.
- deliveryAddress: street address and town, without the postcode.
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
  required: ['sourcePlatform', 'deliveryAddress', 'postcode', 'items'],
};

const text = (v) => (typeof v === 'string' ? v.trim() : '');
const number = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0);

async function scanReceipt(imageBase64, mimeType) {
  const apiKey = process.env.GEMINI_API_KEY;
  if (!apiKey) {
    throw new AppError(503, 'OCR_NOT_CONFIGURED', 'Receipt scanning is not set up yet. Ask the administrator to add the Gemini API key.');
  }

  let res;
  try {
    res = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(MODEL)}:generateContent`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-goog-api-key': apiKey },
        signal: AbortSignal.timeout(TIMEOUT_MS),
        body: JSON.stringify({
          contents: [
            { parts: [{ text: PROMPT }, { inline_data: { mime_type: mimeType, data: imageBase64 } }] },
          ],
          generationConfig: {
            temperature: 0,
            responseMimeType: 'application/json',
            responseSchema: RESPONSE_SCHEMA,
          },
        }),
      }
    );
  } catch {
    throw new AppError(502, 'OCR_UNAVAILABLE', 'The receipt reader could not be reached. Please try again.');
  }

  if (!res.ok) {
    const detail = await res.text().catch(() => '');
    console.error(`Gemini request failed (${res.status}): ${detail.slice(0, 500)}`);
    throw new AppError(502, 'OCR_FAILED', 'The receipt could not be read. Please try again.');
  }

  let parsed;
  try {
    const body = await res.json();
    parsed = JSON.parse(body.candidates[0].content.parts[0].text);
  } catch {
    throw new AppError(422, 'OCR_UNREADABLE', 'We could not read that receipt. Retake the photo with the whole receipt in frame.');
  }

  const items = (Array.isArray(parsed.items) ? parsed.items : [])
    .map((i) => ({ quantity: Math.max(1, Math.round(number(i.quantity)) || 1), name: text(i.name), price: number(i.price) }))
    .filter((i) => i.name);

  if (!text(parsed.deliveryAddress) && !text(parsed.postcode) && items.length === 0) {
    throw new AppError(422, 'OCR_UNREADABLE', 'We could not find order details in that photo. Retake it with the whole receipt in frame.');
  }

  return {
    source: SOURCES.includes(parsed.sourcePlatform) ? parsed.sourcePlatform : 'Other',
    externalOrderId: text(parsed.externalOrderId),
    customerName: text(parsed.customerName),
    customerPhone: text(parsed.customerPhone),
    phoneAccessCode: text(parsed.phoneAccessCode).replace(/^#/, ''),
    directCustomerPhone: text(parsed.directCustomerPhone),
    deliveryAddress: text(parsed.deliveryAddress),
    postcode: text(parsed.postcode),
    deliveryInstructions: text(parsed.deliveryInstructions),
    suggestedPrepMinutes: Math.max(0, Math.round(number(parsed.suggestedPrepMinutes))),
    printedTime: text(parsed.targetDeliveryTime),
    orderTotalGbp: number(parsed.orderTotalGbp),
    items,
  };
}

module.exports = { scanReceipt, SOURCES };
