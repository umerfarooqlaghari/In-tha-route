const { ROLES } = require('../constants/roles');
const { hashPassword } = require('../services/password.service');
const { passwordSchema, emailSchema } = require('../validators/auth.validator');

/**
 * Creates the admin account from ADMIN_EMAIL / ADMIN_PASSWORD / ADMIN_NAME.
 * Safe to run repeatedly: an existing admin is left untouched.
 * This is the only code path that can create an admin.
 */
async function seedAdmin(pool, env = process.env, log = console.log) {
  if (!env.ADMIN_EMAIL || !env.ADMIN_PASSWORD) {
    throw new Error('ADMIN_EMAIL and ADMIN_PASSWORD must be set to seed the admin account.');
  }
  const email = emailSchema.safeParse(env.ADMIN_EMAIL);
  if (!email.success) throw new Error('ADMIN_EMAIL is not a valid email address.');
  const password = passwordSchema.safeParse(env.ADMIN_PASSWORD);
  if (!password.success) {
    throw new Error(`ADMIN_PASSWORD is too weak: ${password.error.issues[0].message}`);
  }
  const fullName = (env.ADMIN_NAME || 'Admin').trim();

  const existing = await pool.query('SELECT id, role FROM users WHERE email = $1', [email.data]);
  if (existing.rows[0]) {
    if (existing.rows[0].role !== ROLES.ADMIN) {
      throw new Error(`${email.data} is already registered as a ${existing.rows[0].role}.`);
    }
    log(`Admin ${email.data} already exists; left unchanged.`);
    return { created: false, id: existing.rows[0].id };
  }

  const passwordHash = await hashPassword(password.data);
  const { rows } = await pool.query(
    `INSERT INTO users (email, password_hash, role, full_name)
     VALUES ($1, $2, $3, $4) RETURNING id`,
    [email.data, passwordHash, ROLES.ADMIN, fullName]
  );
  log(`Admin ${email.data} created.`);
  return { created: true, id: rows[0].id };
}

module.exports = { seedAdmin };

if (require.main === module) {
  require('dotenv').config();
  const { pool } = require('../config/db');
  seedAdmin(pool)
    .then(() => pool.end())
    .catch(async (err) => {
      console.error(err.message);
      await pool.end();
      process.exit(1);
    });
}
