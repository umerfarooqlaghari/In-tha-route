const ROLES = Object.freeze({
  RESTAURANT: 'restaurant',
  DRIVER: 'driver',
  ADMIN: 'admin',
});

// Roles a member of the public may register as. Admin is created by the seeder only.
const PUBLIC_SIGNUP_ROLES = Object.freeze([ROLES.RESTAURANT, ROLES.DRIVER]);

const VEHICLES = Object.freeze(['Motorcycle / Scooter', 'Car', 'E-Bike']);

module.exports = { ROLES, PUBLIC_SIGNUP_ROLES, VEHICLES };
