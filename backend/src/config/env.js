const crypto = require('crypto');

const NODE_ENV = process.env.NODE_ENV || 'development';

let jwtSecret = process.env.JWT_SECRET;
if (!jwtSecret || jwtSecret.length < 32) {
  if (NODE_ENV === 'production') {
    throw new Error('JWT_SECRET must be set to at least 32 characters in production.');
  }
  // Development convenience: tokens stop working when the server restarts.
  jwtSecret = crypto.randomBytes(48).toString('hex');
  console.warn('JWT_SECRET is not set (or too short); using a temporary secret for this run.');
}

const int = (value, fallback) => {
  const n = parseInt(value, 10);
  return Number.isFinite(n) && n > 0 ? n : fallback;
};

module.exports = {
  NODE_ENV,
  JWT_SECRET: jwtSecret,
  ACCESS_TOKEN_TTL_SECONDS: int(process.env.ACCESS_TOKEN_TTL_SECONDS, 15 * 60),
  REFRESH_TOKEN_TTL_DAYS: int(process.env.REFRESH_TOKEN_TTL_DAYS, 30),
  BCRYPT_ROUNDS: int(process.env.BCRYPT_ROUNDS, 12),
};
