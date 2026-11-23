const db = require('../config/db');
const AppError = require('../utils/AppError');
const geo = require('./geo.service');
const pricing = require('./pricing.service');

const WITH_COUNTS = `
  SELECT r.*,
         (SELECT u.is_active FROM users u WHERE u.id = r.owner_user_id) AS owner_active,
         (SELECT u.email FROM users u WHERE u.id = r.owner_user_id) AS owner_email,
         (SELECT u.full_name FROM users u WHERE u.id = r.owner_user_id) AS owner_name,
         (SELECT count(*) FROM orders o
           WHERE o.restaurant_id = r.id AND o.status NOT IN ('delivered', 'cancelled'))::int AS active_orders,
         (SELECT count(*) FROM orders o
           WHERE o.restaurant_id = r.id AND o.status = 'delivered'
             AND (o.delivered_at AT TIME ZONE 'Europe/London')::date
               = (now() AT TIME ZONE 'Europe/London')::date)::int AS completed_today
    FROM restaurants r
`;

/** Shape the mobile app calls a "restaurant partner". */
function toPartner(row) {
  return {
    id: row.id,
    name: row.name,
    address: row.address,
    postcode: row.postcode,
    phone: row.phone,
    driverPolicy: row.driver_policy,
    // Its own pool time in seconds, or null for the admin's standard time.
    poolWindowSeconds: row.pool_window_seconds ?? null,
    activeOrdersCount: row.active_orders ?? 0,
    completedTodayCount: row.completed_today ?? 0,
    pickupSafetyNote: row.pickup_safety_note || '',
    logoUrl: row.logo_file_id ? `/api/files/logos/${row.logo_file_id}` : null,
    coords: row.latitude != null ? { latitude: row.latitude, longitude: row.longitude } : null,
  };
}

async function getWithCounts(id, client = db) {
  const { rows } = await client.query(`${WITH_COUNTS} WHERE r.id = $1`, [id]);
  return rows[0] || null;
}

async function listWithCounts(client = db) {
  // Deleted merchants are kept for the records but no longer listed.
  const { rows } = await client.query(
    `${WITH_COUNTS} WHERE NOT EXISTS (SELECT 1 FROM users u WHERE u.id = r.owner_user_id AND u.deleted_at IS NOT NULL)
      ORDER BY r.name`
  );
  return rows;
}

/** Looks up and stores the restaurant's coordinates (its door when Google is set up) the first time they are needed. */
async function ensureCoords(row, client = db) {
  if (row.latitude != null && row.longitude != null) return row;
  const hit = await geo.locateAddress(row.address, row.postcode);
  if (hit.status !== 'ok') return row;
  await client.query('UPDATE restaurants SET latitude = $1, longitude = $2 WHERE id = $3', [
    hit.latitude,
    hit.longitude,
    row.id,
  ]);
  return { ...row, latitude: hit.latitude, longitude: hit.longitude };
}

/**
 * Delivery settings: who delivers, and the merchant's own pool time (null: the admin's
 * standard time). Orders waiting in the pool follow a new pool time straight away.
 */
async function updatePolicy(id, { driverPolicy, poolWindowSeconds }) {
  await db.withTransaction(async (client) => {
    const before = await pricing.poolWindowFor(client, id);
    const { rowCount } = await client.query(
      `UPDATE restaurants
          SET driver_policy = coalesce($2, driver_policy),
              pool_window_seconds = CASE WHEN $3 THEN $4::int ELSE pool_window_seconds END,
              updated_at = now()
        WHERE id = $1`,
      [id, driverPolicy ?? null, poolWindowSeconds !== undefined, poolWindowSeconds ?? null]
    );
    if (rowCount === 0) throw new AppError(404, 'RESTAURANT_NOT_FOUND', 'Restaurant not found.');
    const after = await pricing.poolWindowFor(client, id);
    await pricing.shiftPoolWindows(client, { bySeconds: after - before, restaurantId: id });
  });
}

/**
 * Admin: turns a merchant's account off or back on. A disabled merchant is signed out on
 * every device and cannot sign in; orders already posted still go out to be delivered.
 */
async function setActive(id, active) {
  const { rows } = await db.query('SELECT owner_user_id FROM restaurants WHERE id = $1', [id]);
  if (!rows[0]) throw new AppError(404, 'RESTAURANT_NOT_FOUND', 'Restaurant not found.');
  const ownerId = rows[0].owner_user_id;
  await db.query('UPDATE users SET is_active = $1, updated_at = now() WHERE id = $2', [active, ownerId]);
  if (!active) {
    // Loaded here: token.service and realtime.service are not needed by the rest of this file.
    await require('./token.service').revokeAllForUser(ownerId);
    require('./realtime.service').sendTo(ownerId, { type: 'error', code: 'ACCOUNT_DISABLED' });
  }
}

module.exports = { toPartner, getWithCounts, listWithCounts, ensureCoords, updatePolicy, setActive };
