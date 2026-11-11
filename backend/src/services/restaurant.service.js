const db = require('../config/db');
const AppError = require('../utils/AppError');
const geo = require('./geo.service');

const WITH_COUNTS = `
  SELECT r.*,
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
    activeOrdersCount: row.active_orders ?? 0,
    completedTodayCount: row.completed_today ?? 0,
    pickupSafetyNote: row.pickup_safety_note || '',
    coords: row.latitude != null ? { latitude: row.latitude, longitude: row.longitude } : null,
  };
}

async function getWithCounts(id, client = db) {
  const { rows } = await client.query(`${WITH_COUNTS} WHERE r.id = $1`, [id]);
  return rows[0] || null;
}

async function listWithCounts(client = db) {
  const { rows } = await client.query(`${WITH_COUNTS} ORDER BY r.name`);
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

async function updatePolicy(id, driverPolicy) {
  const { rowCount } = await db.query(
    'UPDATE restaurants SET driver_policy = $1, updated_at = now() WHERE id = $2',
    [driverPolicy, id]
  );
  if (rowCount === 0) throw new AppError(404, 'RESTAURANT_NOT_FOUND', 'Restaurant not found.');
}

module.exports = { toPartner, getWithCounts, listWithCounts, ensureCoords, updatePolicy };
