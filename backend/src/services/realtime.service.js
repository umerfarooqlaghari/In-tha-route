const { WebSocketServer } = require('ws');

const db = require('../config/db');
const { verifyAccessToken } = require('./token.service');
const { findById } = require('./user.service');

/**
 * Live connection for the mobile app (`wss://<host>/ws`).
 *
 * The app keeps one socket open while it is in the foreground and closes it when
 * it goes to the background, so "has an open socket" means "online now". When the
 * last socket closes, `users.last_seen_at` is stamped for "Active 5 min ago".
 *
 * Client -> server:  { type: 'auth', token }  (first message, within 10 s)
 *                    { type: 'ping' }
 * Server -> client:  { type: 'ready' }
 *                    { type: 'message', conversationId, message }
 *                    { type: 'read', conversationId, role, readAt }
 *                    { type: 'presence', userId, online, lastSeenAt }
 *                    { type: 'error', code }  then close (e.g. TOKEN_EXPIRED: refresh and reconnect)
 *
 * Presence is kept in memory: fine for one server instance. Running several
 * instances would need a shared store (e.g. Redis pub/sub).
 */
const AUTH_TIMEOUT_MS = 10_000;
const HEARTBEAT_MS = 30_000;
const CHAT_ROLES = ['restaurant', 'driver'];

/** user id -> open sockets (a user can be signed in on more than one phone) */
const sockets = new Map();

const isOnline = (userId) => (sockets.get(userId)?.size ?? 0) > 0;

function sendTo(userId, payload) {
  const set = sockets.get(userId);
  if (!set) return;
  const data = JSON.stringify(payload);
  for (const ws of set) {
    if (ws.readyState === ws.OPEN) ws.send(data);
  }
}

async function announcePresence(userId, online) {
  try {
    const { rows } = await db.query(
      'UPDATE users SET last_seen_at = now() WHERE id = $1 RETURNING last_seen_at',
      [userId]
    );
    const lastSeenAt = rows[0] ? new Date(rows[0].last_seen_at).toISOString() : null;
    // Loaded here to avoid a require cycle (chat.service is used by the controllers too).
    const { counterpartUserIds } = require('./chat.service');
    for (const id of await counterpartUserIds(userId)) {
      sendTo(id, { type: 'presence', userId, online, lastSeenAt });
    }
  } catch (err) {
    console.error('Presence update failed:', err.message);
  }
}

function register(userId, ws) {
  let set = sockets.get(userId);
  if (!set) {
    set = new Set();
    sockets.set(userId, set);
  }
  const wasOffline = set.size === 0;
  set.add(ws);
  if (wasOffline) announcePresence(userId, true);
}

function unregister(userId, ws) {
  const set = sockets.get(userId);
  if (!set || !set.delete(ws)) return;
  if (set.size === 0) {
    sockets.delete(userId);
    announcePresence(userId, false);
  }
}

async function authenticate(ws, token) {
  let payload;
  try {
    payload = verifyAccessToken(String(token || ''));
  } catch (err) {
    return { error: err.name === 'TokenExpiredError' ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN' };
  }
  const user = await findById(payload.sub);
  if (!user) return { error: 'INVALID_TOKEN' };
  if (!user.is_active) return { error: 'ACCOUNT_DISABLED' };
  if (!CHAT_ROLES.includes(user.role)) return { error: 'FORBIDDEN' };
  return { user };
}

/** Attaches the WebSocket server to the HTTP server. */
function attach(server) {
  const wss = new WebSocketServer({ server, path: '/ws', maxPayload: 16 * 1024 });

  wss.on('connection', (ws) => {
    ws.isAlive = true;
    ws.on('pong', () => {
      ws.isAlive = true;
    });

    const authTimer = setTimeout(() => ws.close(4001, 'Authentication required'), AUTH_TIMEOUT_MS);

    ws.on('message', async (raw) => {
      let msg;
      try {
        msg = JSON.parse(raw.toString());
      } catch {
        return;
      }
      if (msg.type === 'ping') {
        ws.send(JSON.stringify({ type: 'pong' }));
        return;
      }
      if (msg.type !== 'auth' || ws.userId) return;

      clearTimeout(authTimer);
      const { user, error } = await authenticate(ws, msg.token).catch(() => ({ error: 'SERVER_ERROR' }));
      if (error) {
        ws.send(JSON.stringify({ type: 'error', code: error }));
        ws.close(4001, error);
        return;
      }
      if (ws.readyState !== ws.OPEN) return;
      ws.userId = user.id;
      register(user.id, ws);
      ws.send(JSON.stringify({ type: 'ready' }));
    });

    ws.on('close', () => {
      clearTimeout(authTimer);
      if (ws.userId) unregister(ws.userId, ws);
    });
    ws.on('error', () => {});
  });

  // Drop connections that stopped answering (phone lost signal, app killed).
  const heartbeat = setInterval(() => {
    for (const ws of wss.clients) {
      if (!ws.isAlive) {
        ws.terminate();
        continue;
      }
      ws.isAlive = false;
      ws.ping();
    }
  }, HEARTBEAT_MS);
  wss.on('close', () => clearInterval(heartbeat));

  return wss;
}

module.exports = { attach, isOnline, sendTo };
