const { ROLES, PUBLIC_SIGNUP_ROLES } = require('../constants/roles');
const authService = require('../services/auth.service');
const { toPublicUser } = require('../services/user.service');
const AppError = require('../utils/AppError');
const { SIGNUP_SCHEMAS, loginSchema, refreshSchema } = require('../validators/auth.validator');
const { parse } = require('../middleware/validate');
const push = require('../services/push.service');
const db = require('../config/db');
const drivers = require('../services/driver.service');
const dispatch = require('../services/dispatch.service');
const { z } = require('zod');

const pushTokenSchema = z.object({
  token: z.string({ error: 'token is required.' }).trim().refine(push.isValidToken, 'Not an Expo push token.'),
  platform: z.enum(['ios', 'android', 'unknown']).default('unknown'),
});

async function signup(req, res) {
  const role = req.body && req.body.role;
  if (role === ROLES.ADMIN) {
    throw new AppError(403, 'ADMIN_SIGNUP_FORBIDDEN', 'Admin accounts cannot be registered.');
  }
  if (!PUBLIC_SIGNUP_ROLES.includes(role)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Validation failed.', [
      { field: 'role', message: `Role must be one of: ${PUBLIC_SIGNUP_ROLES.join(', ')}.` },
    ]);
  }
  const data = parse(SIGNUP_SCHEMAS[role], req.body);
  res.status(201).json(await authService.signup(data));
}

async function login(req, res) {
  // Only email and password are read. A role sent by the client is discarded;
  // the role in the response comes from the database.
  const data = parse(loginSchema, req.body);
  res.json(await authService.login(data));
}

async function refresh(req, res) {
  const { refreshToken } = parse(refreshSchema, req.body);
  res.json(await authService.refresh(refreshToken));
}

async function logout(req, res) {
  const { refreshToken } = parse(refreshSchema, req.body);
  const userId = await authService.logout(refreshToken);
  if (userId) await goOffline(userId);
  res.status(204).end();
}

/**
 * A driver who signs out is no longer online: merchants and admins stop seeing them as
 * "Online", and an offer waiting for them goes to the next driver.
 */
async function goOffline(userId) {
  const { rows } = await db.query(
    `SELECT id FROM driver_profiles WHERE user_id = $1 AND status = 'approved_online'`,
    [userId]
  );
  if (!rows[0]) return;
  await drivers.setOnline(rows[0].id, false);
  const released = await dispatch.releaseOffer(rows[0].id);
  push.later(async () => {
    for (const id of released) await dispatch.notifyNearbyDrivers(id);
  });
}

async function me(req, res) {
  res.json({ user: toPublicUser(req.user) });
}

/** The app registers this phone for push notifications (after sign-in). */
async function savePushToken(req, res) {
  const { token, platform } = parse(pushTokenSchema, req.body);
  await push.register(req.user.id, token, platform);
  res.status(204).end();
}

/** The app stops notifications to this phone (before sign-out). */
async function removePushToken(req, res) {
  const { token } = parse(pushTokenSchema.pick({ token: true }), req.body);
  await push.unregister(req.user.id, token);
  res.status(204).end();
}

module.exports = { signup, login, refresh, logout, me, savePushToken, removePushToken };
