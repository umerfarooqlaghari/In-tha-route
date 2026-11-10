const { Pool } = require('pg');

const connectionString = process.env.DATABASE_URL;

if (!connectionString) {
  console.warn('DATABASE_URL is not set; database queries will fail.');
}

// Render's external hostnames (and most hosted Postgres) require SSL.
// Local databases and Render's internal hostnames (no dots, e.g. "dpg-abc123-a") do not.
const needsSsl = (url) => {
  if (!url) return false;
  try {
    const { hostname } = new URL(url);
    return hostname.includes('.') && hostname !== '127.0.0.1';
  } catch {
    return false;
  }
};

const pool = new Pool({
  connectionString,
  ssl: needsSsl(connectionString) ? { rejectUnauthorized: false } : false,
});

pool.on('error', (err) => {
  console.error('Unexpected database error:', err.message);
});

/** Runs `fn(client)` inside a transaction; rolls back if it throws. */
async function withTransaction(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

module.exports = {
  pool,
  query: (text, params) => pool.query(text, params),
  withTransaction,
};
