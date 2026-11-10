const db = require('../config/db');

const USER_SELECT = `
  SELECT u.id, u.email, u.password_hash, u.role, u.full_name, u.phone, u.is_active,
         u.last_login_at, u.created_at,
         r.id AS restaurant_id, r.name AS restaurant_name, r.address AS restaurant_address,
         r.postcode AS restaurant_postcode, r.phone AS restaurant_phone,
         r.driver_policy, r.pickup_safety_note,
         d.id AS driver_id, d.driver_type, d.employer_restaurant_id, d.vehicle,
         d.plate_number, d.status AS driver_status
    FROM users u
    LEFT JOIN restaurants r ON r.owner_user_id = u.id
    LEFT JOIN driver_profiles d ON d.user_id = u.id
`;

const findByEmail = async (email, client = db) =>
  (await client.query(`${USER_SELECT} WHERE u.email = $1`, [email])).rows[0] || null;

const findById = async (id, client = db) =>
  (await client.query(`${USER_SELECT} WHERE u.id = $1`, [id])).rows[0] || null;

/** Shape returned to clients. Never includes the password hash. */
function toPublicUser(row) {
  const user = {
    id: row.id,
    email: row.email,
    role: row.role,
    fullName: row.full_name,
    phone: row.phone,
    isActive: row.is_active,
    createdAt: row.created_at,
  };
  if (row.restaurant_id) {
    user.restaurant = {
      id: row.restaurant_id,
      name: row.restaurant_name,
      address: row.restaurant_address,
      postcode: row.restaurant_postcode,
      phone: row.restaurant_phone,
      driverPolicy: row.driver_policy,
      pickupSafetyNote: row.pickup_safety_note,
    };
  }
  if (row.driver_id) {
    user.driver = {
      id: row.driver_id,
      driverType: row.driver_type,
      employerRestaurantId: row.employer_restaurant_id,
      vehicle: row.vehicle,
      plateNumber: row.plate_number,
      status: row.driver_status,
    };
  }
  return user;
}

module.exports = { findByEmail, findById, toPublicUser };
