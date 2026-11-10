const db = require('../config/db');
const { ROLES } = require('../constants/roles');
const AppError = require('../utils/AppError');
const { hashPassword, verifyPassword, DUMMY_HASH } = require('./password.service');
const tokens = require('./token.service');
const users = require('./user.service');

const UNIQUE_VIOLATION = '23505';

/** `data` has already been validated against the schema for its role. */
async function signup(data) {
  const passwordHash = await hashPassword(data.password);
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const { rows } = await client.query(
      `INSERT INTO users (email, password_hash, role, full_name, phone)
       VALUES ($1, $2, $3, $4, $5) RETURNING id`,
      [data.email, passwordHash, data.role, data.fullName, data.phone]
    );
    const userId = rows[0].id;

    if (data.role === ROLES.RESTAURANT) {
      await client.query(
        `INSERT INTO restaurants (owner_user_id, name, address, postcode, phone, pickup_safety_note)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [userId, data.restaurantName, data.address, data.postcode, data.phone, data.pickupSafetyNote || null]
      );
    } else if (data.role === ROLES.DRIVER) {
      // Type and status are fixed here: self-registered drivers are platform
      // drivers awaiting KYC, whatever the request body says.
      await client.query(
        `INSERT INTO driver_profiles (user_id, driver_type, vehicle, plate_number, status)
         VALUES ($1, 'platform_contracted', $2, $3, 'pending_kyc')`,
        [userId, data.vehicle, data.plateNumber || null]
      );
    }

    const user = await users.findById(userId, client);
    const issued = await tokens.issueTokens(user, client);
    await client.query('COMMIT');
    return { user: users.toPublicUser(user), tokens: issued };
  } catch (err) {
    await client.query('ROLLBACK');
    if (err.code === UNIQUE_VIOLATION) {
      throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists.');
    }
    throw err;
  } finally {
    client.release();
  }
}

async function login({ email, password }) {
  const user = await users.findByEmail(email);
  // Same error and similar timing whether the email or the password is wrong.
  const ok = await verifyPassword(password, user ? user.password_hash : DUMMY_HASH);
  if (!user || !ok) {
    throw new AppError(401, 'INVALID_CREDENTIALS', 'Invalid email or password.');
  }
  if (!user.is_active) {
    throw new AppError(403, 'ACCOUNT_DISABLED', 'This account has been disabled.');
  }
  await db.query('UPDATE users SET last_login_at = now() WHERE id = $1', [user.id]);
  return { user: users.toPublicUser(user), tokens: await tokens.issueTokens(user) };
}

async function refresh(refreshToken) {
  const userId = await tokens.consumeRefreshToken(refreshToken);
  const user = await users.findById(userId);
  if (!user || !user.is_active) {
    throw new AppError(401, 'INVALID_REFRESH_TOKEN', 'Refresh token is invalid or expired.');
  }
  return { user: users.toPublicUser(user), tokens: await tokens.issueTokens(user) };
}

const logout = (refreshToken) => tokens.revokeRefreshToken(refreshToken);

module.exports = { signup, login, refresh, logout };
