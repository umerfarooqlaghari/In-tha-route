const { z } = require('zod');
const { ROLES, VEHICLES } = require('../constants/roles');

const emailSchema = z
  .string({ error: 'Email is required.' })
  .trim()
  .toLowerCase()
  .max(254, 'Email is too long.')
  .pipe(z.email('Enter a valid email address.'));

// bcrypt only reads the first 72 bytes, so longer passwords are rejected rather than truncated.
const passwordSchema = z
  .string({ error: 'Password is required.' })
  .min(8, 'Password must be at least 8 characters.')
  .refine((v) => Buffer.byteLength(v, 'utf8') <= 72, 'Password must be at most 72 characters.')
  .refine((v) => /[A-Za-z]/.test(v) && /\d/.test(v), 'Password must contain a letter and a number.');

const fullNameSchema = z
  .string({ error: 'Full name is required.' })
  .trim()
  .min(2, 'Full name must be at least 2 characters.')
  .max(100, 'Full name is too long.');

// UK numbers only (the app operates in South West London): +44… or 0…
const phoneSchema = z
  .string({ error: 'Phone number is required.' })
  .transform((v) => v.replace(/[\s\-().]/g, ''))
  .refine((v) => /^(\+44\d{9,10}|0\d{9,10})$/.test(v), 'Enter a valid UK phone number.');

const postcodeSchema = z
  .string({ error: 'Postcode is required.' })
  .transform((v) => v.replace(/\s+/g, '').toUpperCase())
  .refine((v) => /^[A-Z]{1,2}\d[A-Z\d]?\d[A-Z]{2}$/.test(v), 'Enter a valid UK postcode.')
  .transform((v) => `${v.slice(0, -3)} ${v.slice(-3)}`);

const base = {
  email: emailSchema,
  password: passwordSchema,
  fullName: fullNameSchema,
  phone: phoneSchema,
};

const restaurantSignupSchema = z.object({
  ...base,
  role: z.literal(ROLES.RESTAURANT),
  restaurantName: z
    .string({ error: 'Restaurant name is required.' })
    .trim()
    .min(2, 'Restaurant name must be at least 2 characters.')
    .max(120, 'Restaurant name is too long.'),
  address: z
    .string({ error: 'Address is required.' })
    .trim()
    .min(5, 'Address must be at least 5 characters.')
    .max(200, 'Address is too long.'),
  postcode: postcodeSchema,
  pickupSafetyNote: z.string().trim().max(500, 'Pickup note is too long.').optional(),
});

const driverSignupSchema = z
  .object({
    ...base,
    role: z.literal(ROLES.DRIVER),
    vehicle: z.enum(VEHICLES, { error: `Vehicle must be one of: ${VEHICLES.join(', ')}.` }),
    plateNumber: z
      .string()
      .trim()
      .toUpperCase()
      .max(20, 'Plate number is too long.')
      .optional()
      .transform((v) => v || undefined),
  })
  .refine((d) => d.vehicle === 'E-Bike' || d.plateNumber, {
    path: ['plateNumber'],
    message: 'Plate number is required for this vehicle.',
  });

const SIGNUP_SCHEMAS = {
  [ROLES.RESTAURANT]: restaurantSignupSchema,
  [ROLES.DRIVER]: driverSignupSchema,
};

const loginSchema = z.object({
  email: emailSchema,
  password: z.string({ error: 'Password is required.' }).min(1, 'Password is required.').max(200),
});

const refreshSchema = z.object({
  refreshToken: z.string({ error: 'refreshToken is required.' }).min(1, 'refreshToken is required.').max(500),
});

module.exports = {
  emailSchema,
  passwordSchema,
  fullNameSchema,
  phoneSchema,
  postcodeSchema,
  SIGNUP_SCHEMAS,
  loginSchema,
  refreshSchema,
};
