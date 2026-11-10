const db = require('../config/db');
const AppError = require('../utils/AppError');

/**
 * Restaurant <-> driver chat.
 *
 * A restaurant and a driver can message each other while the driver has an
 * accepted order from that restaurant (and for an hour after delivering it, for
 * follow-ups like a missing item). Past threads always stay readable in the inbox.
 */
const AFTER_DELIVERY_MINUTES = 60;

/** Pairs that are allowed to message right now, with the orders that link them. */
const ACTIVE_LINKS = `
  SELECT o.restaurant_id, o.assigned_driver_id AS driver_id, o.id AS order_id, o.external_order_id
    FROM orders o
   WHERE o.assigned_driver_id IS NOT NULL
     AND (o.status IN ('driver_assigned', 'picked_up')
          OR (o.status = 'delivered' AND o.delivered_at > now() - make_interval(mins => ${AFTER_DELIVERY_MINUTES})))
`;

/** Which side of the chat a signed-in user is on. */
function partyOf(user) {
  if (user.role === 'restaurant' && user.restaurant_id) {
    return { role: 'restaurant', id: user.restaurant_id, column: 'restaurant_id', userId: user.id };
  }
  if (user.role === 'driver' && user.driver_id) {
    return { role: 'driver', id: user.driver_id, column: 'driver_id', userId: user.id };
  }
  throw new AppError(403, 'FORBIDDEN', 'Chat is for restaurants and drivers.');
}

const toMessage = (row) => ({
  id: row.id,
  conversationId: row.conversation_id,
  body: row.body,
  senderRole: row.sender_role,
  createdAt: new Date(row.created_at).toISOString(),
});

const iso = (d) => (d ? new Date(d).toISOString() : null);

/** Start threads for every pair that can talk now, so they appear in the inbox. */
async function syncConversations(party) {
  await db.query(
    `INSERT INTO conversations (restaurant_id, driver_id)
     SELECT DISTINCT l.restaurant_id, l.driver_id FROM (${ACTIVE_LINKS}) l WHERE l.${party.column} = $1
     ON CONFLICT (restaurant_id, driver_id) DO NOTHING`,
    [party.id]
  );
}

const CONVERSATION_SELECT = `
  SELECT c.*,
         r.name AS restaurant_name, r.address AS restaurant_address, r.phone AS restaurant_phone,
         r.owner_user_id AS restaurant_user_id, ru.last_seen_at AS restaurant_last_seen_at,
         du.id AS driver_user_id, du.full_name AS driver_name, du.phone AS driver_phone,
         du.last_seen_at AS driver_last_seen_at, d.vehicle AS driver_vehicle, d.driver_type,
         lm.body AS last_body, lm.sender_role AS last_sender_role, lm.created_at AS last_created_at,
         (SELECT array_agg(DISTINCT l.external_order_id)
            FROM (${ACTIVE_LINKS}) l
           WHERE l.restaurant_id = c.restaurant_id AND l.driver_id = c.driver_id) AS active_orders
    FROM conversations c
    JOIN restaurants r ON r.id = c.restaurant_id
    JOIN users ru ON ru.id = r.owner_user_id
    JOIN driver_profiles d ON d.id = c.driver_id
    JOIN users du ON du.id = d.user_id
    LEFT JOIN LATERAL (
      SELECT body, sender_role, created_at FROM messages m
       WHERE m.conversation_id = c.id ORDER BY m.created_at DESC LIMIT 1
    ) lm ON true
`;

/**
 * The thread as one side sees it: who the other side is, the last message,
 * how many messages are unread and whether they can still send.
 */
async function toConversation(row, party, isOnline) {
  const viewerIsRestaurant = party.role === 'restaurant';
  const lastRead = viewerIsRestaurant ? row.restaurant_last_read_at : row.driver_last_read_at;
  const otherRole = viewerIsRestaurant ? 'driver' : 'restaurant';
  const { rows } = await db.query(
    `SELECT count(*)::int AS n FROM messages
      WHERE conversation_id = $1 AND sender_role = $2 AND created_at > $3`,
    [row.id, otherRole, lastRead]
  );
  const counterpart = viewerIsRestaurant
    ? {
        userId: row.driver_user_id,
        role: 'driver',
        name: row.driver_name,
        phone: row.driver_phone || '',
        subtitle: row.driver_type === 'restaurant_own' ? `In-house · ${row.driver_vehicle}` : row.driver_vehicle,
        lastSeenAt: iso(row.driver_last_seen_at),
      }
    : {
        userId: row.restaurant_user_id,
        role: 'restaurant',
        name: row.restaurant_name,
        phone: row.restaurant_phone || '',
        subtitle: row.restaurant_address,
        lastSeenAt: iso(row.restaurant_last_seen_at),
      };
  counterpart.online = isOnline(counterpart.userId);

  const activeOrders = (row.active_orders || []).filter(Boolean);
  return {
    id: row.id,
    counterpart,
    lastMessage: row.last_body
      ? { body: row.last_body, senderRole: row.last_sender_role, createdAt: iso(row.last_created_at) }
      : null,
    unreadCount: rows[0].n,
    canMessage: activeOrders.length > 0,
    activeOrders,
    /** When the other side last opened this thread (for "Seen"). */
    otherLastReadAt: iso(viewerIsRestaurant ? row.driver_last_read_at : row.restaurant_last_read_at),
    updatedAt: iso(row.last_message_at || row.created_at),
  };
}

async function findRow(party, conversationId) {
  const { rows } = await db.query(`${CONVERSATION_SELECT} WHERE c.id = $1 AND c.${party.column} = $2`, [
    conversationId,
    party.id,
  ]);
  if (!rows[0]) throw new AppError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found.');
  return rows[0];
}

/** Inbox: every thread, newest activity first. */
async function listConversations(party, isOnline) {
  await syncConversations(party);
  const { rows } = await db.query(
    `${CONVERSATION_SELECT} WHERE c.${party.column} = $1
      ORDER BY coalesce(c.last_message_at, c.created_at) DESC LIMIT 200`,
    [party.id]
  );
  return Promise.all(rows.map((r) => toConversation(r, party, isOnline)));
}

async function getConversation(party, conversationId, isOnline) {
  return toConversation(await findRow(party, conversationId), party, isOnline);
}

/** Opens (or starts) the thread for one order, from the order's restaurant or its driver. */
async function openForOrder(party, orderId, isOnline) {
  const { rows } = await db.query(
    `SELECT restaurant_id, assigned_driver_id FROM orders WHERE id = $1 AND ${party.role === 'restaurant' ? 'restaurant_id' : 'assigned_driver_id'} = $2`,
    [orderId, party.id]
  );
  const order = rows[0];
  if (!order) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.');
  if (!order.assigned_driver_id) {
    throw new AppError(409, 'CHAT_CLOSED', 'You can message once a driver has accepted this order.');
  }
  await syncConversations(party);
  const existing = await db.query(
    'SELECT id FROM conversations WHERE restaurant_id = $1 AND driver_id = $2',
    [order.restaurant_id, order.assigned_driver_id]
  );
  if (!existing.rows[0]) {
    throw new AppError(409, 'CHAT_CLOSED', 'You can message once a driver has accepted this order.');
  }
  return getConversation(party, existing.rows[0].id, isOnline);
}

/** A page of messages, newest last. `before` (ISO time) loads older ones. */
async function listMessages(party, conversationId, { before, limit = 50 } = {}) {
  await findRow(party, conversationId);
  const { rows } = await db.query(
    `SELECT * FROM messages
      WHERE conversation_id = $1 AND ($2::timestamptz IS NULL OR created_at < $2)
      ORDER BY created_at DESC LIMIT $3`,
    [conversationId, before || null, Math.min(Math.max(Number(limit) || 50, 1), 100)]
  );
  return rows.reverse().map(toMessage);
}

/** Marks the thread read for this side. */
async function markRead(party, conversationId) {
  const column = party.role === 'restaurant' ? 'restaurant_last_read_at' : 'driver_last_read_at';
  const { rows } = await db.query(
    `UPDATE conversations SET ${column} = now() WHERE id = $1 AND ${party.column} = $2 RETURNING ${column} AS read_at`,
    [conversationId, party.id]
  );
  if (!rows[0]) throw new AppError(404, 'CONVERSATION_NOT_FOUND', 'Conversation not found.');
  return iso(rows[0].read_at);
}

/** Sends a message; returns it with the user ids of both sides, for live delivery. */
async function sendMessage(party, conversationId, body) {
  const row = await findRow(party, conversationId);
  const { rows: links } = await db.query(
    `SELECT 1 FROM (${ACTIVE_LINKS}) l WHERE l.restaurant_id = $1 AND l.driver_id = $2 LIMIT 1`,
    [row.restaurant_id, row.driver_id]
  );
  if (!links[0]) {
    throw new AppError(
      409,
      'CHAT_CLOSED',
      'This chat is closed. You can message again when there is an active order together.'
    );
  }

  const message = await db.withTransaction(async (client) => {
    const { rows } = await client.query(
      `INSERT INTO messages (conversation_id, sender_role, sender_user_id, body)
       VALUES ($1, $2, $3, $4) RETURNING *`,
      [conversationId, party.role, party.userId, body]
    );
    const readColumn = party.role === 'restaurant' ? 'restaurant_last_read_at' : 'driver_last_read_at';
    // Sending counts as having read everything before it.
    await client.query(
      `UPDATE conversations SET last_message_at = $2, ${readColumn} = $2 WHERE id = $1`,
      [conversationId, rows[0].created_at]
    );
    return rows[0];
  });

  return {
    message: toMessage(message),
    restaurantUserId: row.restaurant_user_id,
    driverUserId: row.driver_user_id,
  };
}

/** Both user ids of a thread. */
async function participants(conversationId) {
  const { rows } = await db.query(
    `SELECT r.owner_user_id AS restaurant_user_id, d.user_id AS driver_user_id
       FROM conversations c
       JOIN restaurants r ON r.id = c.restaurant_id
       JOIN driver_profiles d ON d.id = c.driver_id
      WHERE c.id = $1`,
    [conversationId]
  );
  return rows[0] || null;
}

/** Everyone this user has a thread with — they get this user's online/offline updates. */
async function counterpartUserIds(userId) {
  const { rows } = await db.query(
    `SELECT d.user_id AS id
       FROM conversations c
       JOIN restaurants r ON r.id = c.restaurant_id
       JOIN driver_profiles d ON d.id = c.driver_id
      WHERE r.owner_user_id = $1
     UNION
     SELECT r.owner_user_id
       FROM conversations c
       JOIN restaurants r ON r.id = c.restaurant_id
       JOIN driver_profiles d ON d.id = c.driver_id
      WHERE d.user_id = $1`,
    [userId]
  );
  return rows.map((r) => r.id);
}

module.exports = {
  partyOf,
  listConversations,
  getConversation,
  openForOrder,
  listMessages,
  markRead,
  sendMessage,
  participants,
  counterpartUserIds,
};
