const db = require('../config/db');
const { ROLES } = require('../constants/roles');
const AppError = require('../utils/AppError');
const { londonDay, tripTimeLabel, weekdayLetter } = require('../utils/labels');
const { hashPassword } = require('./password.service');
const kyc = require('./kyc.service');

const DRIVER_SELECT = `
  SELECT d.*, u.full_name, u.email, u.phone, u.is_active, r.name AS employer_name
    FROM driver_profiles d
    JOIN users u ON u.id = d.user_id
    LEFT JOIN restaurants r ON r.id = d.employer_restaurant_id
`;

const isApproved = (status) => status === 'approved_online' || status === 'offline';

/** A position older than this is not used for dispatch or shown on the admin map. */
const LOCATION_FRESH_MINUTES = 10;

/** Last GPS fix if it is recent enough to trust, else null. */
function freshLocation(row, now = new Date()) {
  if (row.last_latitude == null || row.last_longitude == null || !row.last_location_at) return null;
  if (now - new Date(row.last_location_at) > LOCATION_FRESH_MINUTES * 60000) return null;
  return {
    latitude: row.last_latitude,
    longitude: row.last_longitude,
    updatedAt: new Date(row.last_location_at).toISOString(),
  };
}

/**
 * Shape the mobile app calls a "driver profile".
 * `status` follows the app's three values. For lists shown to admins and
 * restaurants an approved driver is always "approved_online" (the app reads
 * that as "Active"); the driver's own view carries the real online state.
 */
function toProfile(row, documents = [], { self = false } = {}) {
  const approved = isApproved(row.status);
  return {
    id: row.id,
    name: row.full_name,
    email: row.email,
    phone: row.phone || '—',
    driverType: row.driver_type,
    employerRestaurantId: row.employer_restaurant_id || undefined,
    employerRestaurantName: row.employer_name || undefined,
    vehicle: row.vehicle,
    plateNumber: row.plate_number || (row.driver_type === 'restaurant_own' ? 'In-House Fleet' : '—'),
    status: self ? (row.status === 'rejected' ? 'pending_kyc' : row.status) : approved ? 'approved_online' : 'pending_kyc',
    approval: approved ? 'approved' : row.status === 'rejected' ? 'rejected' : 'pending',
    isOnline: row.status === 'approved_online',
    location: freshLocation(row),
    rating: Number(row.rating),
    completedDeliveries: row.completed_deliveries,
    kycDocuments: documents,
  };
}

async function withDocuments(rows, options) {
  const docs = await kyc.listForDrivers(rows.map((r) => r.id));
  return rows.map((r) => toProfile(r, docs.get(r.id), options));
}

async function getRow(id, client = db) {
  const { rows } = await client.query(`${DRIVER_SELECT} WHERE d.id = $1`, [id]);
  return rows[0] || null;
}

async function getSelf(id) {
  const row = await getRow(id);
  if (!row) throw new AppError(404, 'DRIVER_NOT_FOUND', 'Driver profile not found.');
  return { row, profile: (await withDocuments([row], { self: true }))[0] };
}

async function listByRestaurant(restaurantId) {
  const { rows } = await db.query(
    `${DRIVER_SELECT} WHERE d.employer_restaurant_id = $1 AND d.driver_type = 'restaurant_own' AND u.is_active
      ORDER BY d.created_at DESC`,
    [restaurantId]
  );
  return withDocuments(rows);
}

async function listAll() {
  const { rows } = await db.query(`${DRIVER_SELECT} WHERE u.is_active ORDER BY d.created_at DESC`);
  return withDocuments(rows);
}

/**
 * A restaurant adds one of its own drivers. No documents and no approval:
 * the driver can sign in straight away with the email and password given here.
 */
async function createOwnDriver(restaurantId, data) {
  const passwordHash = await hashPassword(data.password);
  try {
    return await db.withTransaction(async (client) => {
      const user = await client.query(
        `INSERT INTO users (email, password_hash, role, full_name, phone)
         VALUES ($1, $2, $3, $4, $5) RETURNING id`,
        [data.email, passwordHash, ROLES.DRIVER, data.fullName, data.phone || null]
      );
      const profile = await client.query(
        `INSERT INTO driver_profiles (user_id, driver_type, employer_restaurant_id, vehicle, plate_number, status)
         VALUES ($1, 'restaurant_own', $2, $3, $4, 'offline') RETURNING id`,
        [user.rows[0].id, restaurantId, data.vehicle, data.plateNumber || null]
      );
      return profile.rows[0].id;
    });
  } catch (err) {
    if (err.code === '23505') {
      throw new AppError(409, 'EMAIL_TAKEN', 'An account with this email already exists.');
    }
    throw err;
  }
}

/** Driver goes online / offline. Only approved drivers have an online state. */
async function setOnline(driverId, online) {
  return db.withTransaction(async (client) => {
    const { rows } = await client.query('SELECT status FROM driver_profiles WHERE id = $1 FOR UPDATE', [driverId]);
    if (!rows[0] || !isApproved(rows[0].status)) {
      throw new AppError(403, 'DRIVER_NOT_APPROVED', 'Your documents are still being reviewed.');
    }
    const next = online ? 'approved_online' : 'offline';
    if (rows[0].status === next) return;
    await client.query('UPDATE driver_profiles SET status = $1, updated_at = now() WHERE id = $2', [next, driverId]);
    if (online) {
      await client.query('INSERT INTO driver_online_sessions (driver_id) VALUES ($1)', [driverId]);
    } else {
      await client.query(
        'UPDATE driver_online_sessions SET ended_at = now() WHERE driver_id = $1 AND ended_at IS NULL',
        [driverId]
      );
    }
  });
}

/** Stores the driver's latest GPS position. */
async function updateLocation(driverId, { latitude, longitude }) {
  await db.query(
    `UPDATE driver_profiles
        SET last_latitude = $1, last_longitude = $2, last_location_at = now()
      WHERE id = $3`,
    [latitude, longitude, driverId]
  );
}

const shortArea = (address) => {
  const parts = String(address || '').split(',').map((p) => p.trim()).filter(Boolean);
  return parts[parts.length - 1] || 'Delivery';
};

/** Figures for the driver's Earnings screen: the last seven days, ending today. */
async function earnings(driverRow) {
  const driverId = driverRow.id;
  const [daily, trips, online, recent] = await Promise.all([
    db.query(
      `SELECT to_char(delivered_at AT TIME ZONE 'Europe/London', 'YYYY-MM-DD') AS day,
              sum(driver_payout_gbp) AS total
         FROM orders
        WHERE assigned_driver_id = $1 AND status = 'delivered' AND delivered_at >= now() - interval '8 days'
        GROUP BY 1`,
      [driverId]
    ),
    db.query(
      `SELECT count(*)::int AS n FROM batches
        WHERE driver_id = $1 AND status = 'completed' AND completed_at >= now() - interval '7 days'`,
      [driverId]
    ),
    db.query(
      `SELECT coalesce(sum(extract(epoch FROM (coalesce(ended_at, now())
                 - greatest(started_at, now() - interval '7 days')))), 0) AS seconds
         FROM driver_online_sessions
        WHERE driver_id = $1 AND coalesce(ended_at, now()) >= now() - interval '7 days'`,
      [driverId]
    ),
    db.query(
      `SELECT b.id, b.completed_at, count(o.id)::int AS orders, sum(o.driver_payout_gbp) AS pay,
              (array_agg(o.delivery_address ORDER BY o.batch_position))[1] AS address
         FROM batches b JOIN orders o ON o.batch_id = b.id
        WHERE b.driver_id = $1 AND b.status = 'completed'
        GROUP BY b.id ORDER BY b.completed_at DESC LIMIT 4`,
      [driverId]
    ),
  ]);

  const byDay = new Map(daily.rows.map((r) => [r.day, Number(r.total)]));
  const now = new Date();
  const week = [];
  for (let i = 6; i >= 0; i--) {
    const date = new Date(now.getTime() - i * 86400000);
    week.push({ day: weekdayLetter(date), value: byDay.get(londonDay(date)) || 0 });
  }

  return {
    week, // last entry is today
    totalGbp: Number(week.reduce((s, d) => s + d.value, 0).toFixed(2)),
    trips: trips.rows[0].n,
    onlineHours: Math.round(Number(online.rows[0].seconds) / 3600),
    rating: Number(driverRow.rating),
    recentTrips: recent.rows.map((t) => ({
      id: t.id,
      title: `${shortArea(t.address)} · ${t.orders} ${t.orders === 1 ? 'order' : 'orders'}`,
      time: tripTimeLabel(t.completed_at, now),
      pay: Number(t.pay),
    })),
  };
}

module.exports = {
  isApproved,
  toProfile,
  getRow,
  getSelf,
  listByRestaurant,
  listAll,
  createOwnDriver,
  setOnline,
  updateLocation,
  freshLocation,
  earnings,
  shortArea,
};
