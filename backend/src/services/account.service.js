const crypto = require('crypto');
const db = require('../config/db');
const { ROLES } = require('../constants/roles');
const AppError = require('../utils/AppError');
const { hashPassword, verifyPassword } = require('./password.service');
const tokens = require('./token.service');
const users = require('./user.service');
const files = require('./file.service');

const UNIQUE_VIOLATION = '23505';
const LOGO_MAX_BYTES = 2 * 1024 * 1024;

async function checkPassword(user, password, field = 'currentPassword') {
  if (!(await verifyPassword(password, user.password_hash))) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Validation failed.', [
      { field, message: 'That password is not right.' },
    ]);
  }
}

/** Your own name and/or email. A new email needs the current password. */
async function updateAccount(user, { fullName, email, currentPassword }) {
  const emailChanges = email !== undefined && email !== user.email;
  if (emailChanges) {
    if (!currentPassword) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Validation failed.', [
        { field: 'currentPassword', message: 'Enter your current password to change your email.' },
      ]);
    }
    await checkPassword(user, currentPassword);
  }
  try {
    await db.query(
      `UPDATE users SET full_name = COALESCE($2, full_name), email = COALESCE($3, email), updated_at = now()
        WHERE id = $1`,
      [user.id, fullName ?? null, emailChanges ? email : null]
    );
  } catch (err) {
    if (err.code === UNIQUE_VIOLATION) {
      throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists.');
    }
    throw err;
  }
  return users.toPublicUser(await users.findById(user.id));
}

/**
 * New password. Every other signed-in device is signed out; this one gets fresh tokens
 * so it stays signed in.
 */
async function changePassword(user, { currentPassword, newPassword }) {
  await checkPassword(user, currentPassword);
  const hash = await hashPassword(newPassword);
  await db.query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [user.id, hash]);
  // Removed rather than revoked: another device using an old token is then simply signed out,
  // and is not taken for a stolen token (which would also sign out this device).
  await db.query('DELETE FROM refresh_tokens WHERE user_id = $1', [user.id]);
  const fresh = await users.findById(user.id);
  return { user: users.toPublicUser(fresh), tokens: await tokens.issueTokens(fresh) };
}

/** The merchant's business name. */
async function renameRestaurant(user, name) {
  await db.query('UPDATE restaurants SET name = $2, updated_at = now() WHERE id = $1', [user.restaurant_id, name]);
  return users.toPublicUser(await users.findById(user.id));
}

/** Saves a new logo and removes the old one. */
async function setLogo(user, { imageBase64, mimeType }) {
  const { data } = files.decodeImage(imageBase64, mimeType);
  if (data.length > LOGO_MAX_BYTES) {
    throw new AppError(413, 'IMAGE_TOO_LARGE', 'That logo is too large. Please use one under 2 MB.');
  }
  const fileId = await files.saveImage({ imageBase64, mimeType, ownerUserId: user.id, folder: 'logos' });
  const { rows } = await db.query(
    `UPDATE restaurants r SET logo_file_id = $2, updated_at = now()
       FROM (SELECT logo_file_id FROM restaurants WHERE id = $1 FOR UPDATE) old
      WHERE r.id = $1 RETURNING old.logo_file_id AS previous`,
    [user.restaurant_id, fileId]
  );
  if (rows[0]?.previous) await files.deleteFile(rows[0].previous);
  return users.toPublicUser(await users.findById(user.id));
}

async function removeLogo(user) {
  const { rows } = await db.query(
    `UPDATE restaurants r SET logo_file_id = NULL, updated_at = now()
       FROM (SELECT logo_file_id FROM restaurants WHERE id = $1 FOR UPDATE) old
      WHERE r.id = $1 RETURNING old.logo_file_id AS previous`,
    [user.restaurant_id]
  );
  if (rows[0]?.previous) await files.deleteFile(rows[0].previous);
  return users.toPublicUser(await users.findById(user.id));
}

/** A merchant's logo, for anyone (it is shown in browsers as a plain image). */
async function logoFile(fileId) {
  const { rows } = await db.query('SELECT 1 FROM restaurants WHERE logo_file_id = $1', [fileId]);
  if (!rows[0]) return null;
  return files.getFile(fileId);
}

const blocked = (code, message) => new AppError(409, code, message);

/** Stops the deletion if it would leave work half done or the platform without an admin. */
async function checkCanDelete(user, client) {
  if (user.role === ROLES.ADMIN) {
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM users
        WHERE role = 'admin' AND is_active AND deleted_at IS NULL AND id <> $1`,
      [user.id]
    );
    if (rows[0].n === 0) {
      throw blocked('LAST_ADMIN', 'You are the only admin, so this account cannot be deleted.');
    }
  }
  if (user.role === ROLES.RESTAURANT) {
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM orders WHERE restaurant_id = $1 AND status NOT IN ('delivered', 'cancelled')`,
      [user.restaurant_id]
    );
    if (rows[0].n > 0) {
      throw blocked(
        'ACTIVE_ORDERS',
        `You have ${rows[0].n} order${rows[0].n === 1 ? '' : 's'} in progress. Finish or cancel ${rows[0].n === 1 ? 'it' : 'them'} first.`
      );
    }
  }
  if (user.role === ROLES.DRIVER) {
    const { rows } = await client.query(
      `SELECT count(*)::int AS n FROM orders
        WHERE assigned_driver_id = $1 AND status IN ('driver_assigned', 'picked_up')`,
      [user.driver_id]
    );
    if (rows[0].n > 0) {
      throw blocked('ACTIVE_ORDERS', 'You have deliveries in progress. Finish them first.');
    }
  }
}

/**
 * Closes the account for good. The login and personal details are wiped; past orders,
 * credit purchases and earnings stay, shown as a deleted account. The email is free again.
 */
async function deleteAccount(user, password) {
  await checkPassword(user, password, 'password');

  if (user.role === ROLES.DRIVER) {
    // An offer waiting for this driver goes to the next one first.
    const dispatch = require('./dispatch.service');
    await dispatch.releaseOffer(user.driver_id).catch(() => []);
  }

  const unusable = await hashPassword(crypto.randomBytes(32).toString('hex'));
  const { removedFiles, signedOut } = await db.withTransaction(async (client) => {
    await client.query('SELECT 1 FROM users WHERE id = $1 FOR UPDATE', [user.id]);
    if (user.role === ROLES.ADMIN) await client.query("SELECT 1 FROM users WHERE role = 'admin' FOR UPDATE");
    await checkCanDelete(user, client);

    const removed = [];
    const others = [];
    await client.query(
      `UPDATE users SET email = $2, full_name = 'Deleted account', phone = NULL, password_hash = $3,
              is_active = false, deleted_at = now(), updated_at = now()
        WHERE id = $1`,
      [user.id, `deleted-${user.id}@deleted.invalid`, unusable]
    );
    await client.query('DELETE FROM push_tokens WHERE user_id = $1', [user.id]);

    if (user.role === ROLES.RESTAURANT) {
      const { rows } = await client.query(
        `UPDATE restaurants r SET name = 'Deleted merchant', phone = '', pickup_safety_note = NULL,
                logo_file_id = NULL, updated_at = now()
           FROM (SELECT logo_file_id FROM restaurants WHERE id = $1) old
          WHERE r.id = $1 RETURNING old.logo_file_id AS logo`,
        [user.restaurant_id]
      );
      if (rows[0]?.logo) removed.push(rows[0].logo);
      // The merchant's own drivers worked only for this shop, so they can no longer sign in.
      const own = await client.query(
        `UPDATE users u SET is_active = false, updated_at = now()
           FROM driver_profiles d
          WHERE d.user_id = u.id AND d.employer_restaurant_id = $1 AND d.driver_type = 'restaurant_own'
          RETURNING u.id`,
        [user.restaurant_id]
      );
      others.push(...own.rows.map((r) => r.id));
      await client.query(
        `UPDATE driver_profiles SET status = 'offline', updated_at = now()
          WHERE employer_restaurant_id = $1 AND driver_type = 'restaurant_own' AND status = 'approved_online'`,
        [user.restaurant_id]
      );
    }

    if (user.role === ROLES.DRIVER) {
      // Identity documents are personal: the files go, the record of their review stays.
      const docs = await client.query(
        `UPDATE kyc_documents k SET file_id = NULL, expires_on = NULL, updated_at = now()
           FROM (SELECT id, file_id FROM kyc_documents WHERE driver_id = $1 AND file_id IS NOT NULL) old
          WHERE k.id = old.id RETURNING old.file_id`,
        [user.driver_id]
      );
      removed.push(...docs.rows.map((r) => r.file_id));
      await client.query(
        `UPDATE driver_profiles SET plate_number = NULL, last_latitude = NULL, last_longitude = NULL,
                last_location_at = NULL,
                status = CASE WHEN status = 'approved_online' THEN 'offline' ELSE status END, updated_at = now()
          WHERE id = $1`,
        [user.driver_id]
      );
      await client.query(
        'UPDATE driver_online_sessions SET ended_at = now() WHERE driver_id = $1 AND ended_at IS NULL',
        [user.driver_id]
      );
    }
    return { removedFiles: removed, signedOut: [user.id, ...others] };
  });

  const realtime = require('./realtime.service');
  for (const id of signedOut) {
    await tokens.revokeAllForUser(id);
    realtime.sendTo(id, { type: 'error', code: id === user.id ? 'ACCOUNT_DELETED' : 'ACCOUNT_DISABLED' });
  }
  for (const id of removedFiles) await files.deleteFile(id);
}

module.exports = {
  updateAccount,
  changePassword,
  renameRestaurant,
  setLogo,
  removeLogo,
  logoFile,
  deleteAccount,
  LOGO_MAX_BYTES,
};
