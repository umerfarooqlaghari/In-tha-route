const crypto = require('crypto');
const jwt = require('jsonwebtoken');

const db = require('../config/db');
const { JWT_SECRET, ACCESS_TOKEN_TTL_SECONDS, REFRESH_TOKEN_TTL_DAYS } = require('../config/env');
const AppError = require('../utils/AppError');

const ISSUER = 'in-tha-route-api';
const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex');

function signAccessToken(user) {
  return jwt.sign({ role: user.role, typ: 'access' }, JWT_SECRET, {
    subject: user.id,
    issuer: ISSUER,
    algorithm: 'HS256',
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  });
}

function verifyAccessToken(token) {
  const payload = jwt.verify(token, JWT_SECRET, { issuer: ISSUER, algorithms: ['HS256'] });
  if (payload.typ !== 'access') throw new Error('Wrong token type');
  return payload;
}

// Refresh tokens are opaque random strings; only their hash is stored.
async function createRefreshToken(userId, client = db) {
  const token = crypto.randomBytes(48).toString('base64url');
  await client.query(
    `INSERT INTO refresh_tokens (user_id, token_hash, expires_at)
     VALUES ($1, $2, now() + make_interval(days => $3))`,
    [userId, sha256(token), REFRESH_TOKEN_TTL_DAYS]
  );
  return token;
}

async function issueTokens(user, client = db) {
  return {
    accessToken: signAccessToken(user),
    refreshToken: await createRefreshToken(user.id, client),
    tokenType: 'Bearer',
    expiresIn: ACCESS_TOKEN_TTL_SECONDS,
  };
}

/**
 * Single-use refresh tokens: the presented token is revoked and the caller gets
 * the owning user id. Presenting an already-revoked token is treated as theft
 * and revokes every session for that user.
 */
async function consumeRefreshToken(token) {
  const invalid = new AppError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid or expired.');
  const { rows } = await db.query(
    `UPDATE refresh_tokens SET revoked_at = now()
      WHERE token_hash = $1 AND revoked_at IS NULL AND expires_at > now()
      RETURNING user_id`,
    [sha256(token)]
  );
  if (rows[0]) return rows[0].user_id;

  const reused = await db.query(
    'SELECT user_id FROM refresh_tokens WHERE token_hash = $1 AND revoked_at IS NOT NULL',
    [sha256(token)]
  );
  if (reused.rows[0]) await revokeAllForUser(reused.rows[0].user_id);
  throw invalid;
}

async function revokeRefreshToken(token) {
  await db.query(
    'UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL',
    [sha256(token)]
  );
}

async function revokeAllForUser(userId) {
  await db.query(
    'UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL',
    [userId]
  );
}

module.exports = {
  signAccessToken,
  verifyAccessToken,
  issueTokens,
  consumeRefreshToken,
  revokeRefreshToken,
  revokeAllForUser,
};
