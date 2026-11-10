const { z } = require('zod');

const { parse } = require('../middleware/validate');
const chat = require('../services/chat.service');
const realtime = require('../services/realtime.service');
const v = require('../validators/app.validator');

const messageSchema = z.object({
  body: z
    .string({ error: 'Type a message.' })
    .trim()
    .min(1, 'Type a message.')
    .max(2000, 'Messages can be up to 2000 characters.'),
});
const openSchema = z.object({ orderId: z.uuid('Invalid order.') });
const pageSchema = z.object({
  before: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

/** Inbox for the signed-in restaurant or driver. */
async function listConversations(req, res) {
  const party = chat.partyOf(req.user);
  res.json({ conversations: await chat.listConversations(party, realtime.isOnline) });
}

/** Opens the thread for an order (from Live orders or the driver's current stop). */
async function openForOrder(req, res) {
  const party = chat.partyOf(req.user);
  const { orderId } = parse(openSchema, req.body);
  res.json({ conversation: await chat.openForOrder(party, orderId, realtime.isOnline) });
}

/** Tells the other side (and this user's other phones) that the thread was read. */
async function announceRead(party, conversationId, readAt) {
  const people = await chat.participants(conversationId);
  if (!people) return;
  const payload = { type: 'read', conversationId, role: party.role, readAt };
  realtime.sendTo(people.restaurant_user_id, payload);
  realtime.sendTo(people.driver_user_id, payload);
}

/** A page of messages; loading the newest page marks the thread read. */
async function listMessages(req, res) {
  const party = chat.partyOf(req.user);
  const conversationId = parse(v.uuidSchema, req.params.id);
  const { before, limit } = parse(pageSchema, req.query);
  const messages = await chat.listMessages(party, conversationId, { before, limit });
  if (!before) {
    const readAt = await chat.markRead(party, conversationId);
    announceRead(party, conversationId, readAt).catch(() => {});
  }
  res.json({ conversation: await chat.getConversation(party, conversationId, realtime.isOnline), messages });
}

async function sendMessage(req, res) {
  const party = chat.partyOf(req.user);
  const conversationId = parse(v.uuidSchema, req.params.id);
  const { body } = parse(messageSchema, req.body);
  const { message, restaurantUserId, driverUserId } = await chat.sendMessage(party, conversationId, body);
  // Live delivery to both sides (the sender may have the app open on another phone).
  const payload = { type: 'message', conversationId, message };
  realtime.sendTo(restaurantUserId, payload);
  realtime.sendTo(driverUserId, payload);
  res.status(201).json({ message });
}

async function markRead(req, res) {
  const party = chat.partyOf(req.user);
  const conversationId = parse(v.uuidSchema, req.params.id);
  const readAt = await chat.markRead(party, conversationId);
  announceRead(party, conversationId, readAt).catch(() => {});
  res.json({ readAt });
}

module.exports = { listConversations, openForOrder, listMessages, sendMessage, markRead };
