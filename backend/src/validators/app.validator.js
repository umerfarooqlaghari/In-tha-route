const { z } = require('zod');
const { VEHICLES } = require('../constants/roles');
const {
  emailSchema,
  passwordSchema,
  fullNameSchema,
  phoneSchema,
  postcodeSchema,
} = require('./auth.validator');

const DRIVER_POLICIES = ['open_platform', 'own_drivers', 'hybrid'];
const shortText = (max) => z.string().trim().max(max).optional().default('');

const imageSchema = z.object({
  imageBase64: z.string({ error: 'A photo is required.' }).min(100, 'A photo is required.'),
  mimeType: z.string().trim().toLowerCase().default('image/jpeg'),
});

const createOrderSchema = z
  .object({
    source: z.string({ error: 'Order source is required.' }).trim().min(1).max(40),
    externalOrderId: shortText(60),
    customerName: shortText(120),
    customerPhone: shortText(40),
    phoneAccessCode: shortText(40),
    directCustomerPhone: shortText(40),
    deliveryAddress: z
      .string({ error: 'Delivery address is required.' })
      .trim()
      .min(3, 'Delivery address is required.')
      .max(300),
    postcode: postcodeSchema,
    deliveryInstructions: shortText(1000),
    orderTotalGbp: z.coerce.number().min(0).max(100000).default(0),
    items: z
      .array(
        z.object({
          quantity: z.coerce.number().int().min(1).max(999),
          name: z.string().trim().min(1).max(200),
          price: z.coerce.number().min(0).max(100000),
        })
      )
      .max(200)
      .default([]),
    prepMinutes: z.coerce
      .number({ error: 'Preparation time is required.' })
      .int()
      .min(1, 'Preparation time must be at least 1 minute.')
      .max(180, 'Preparation time is too long.'),
    dispatchType: z.enum(['open_platform', 'own_driver'], { error: 'Choose who delivers this order.' }),
    ownDriverId: z.uuid('Choose one of your drivers.').optional(),
  })
  .refine((o) => o.dispatchType !== 'own_driver' || o.ownDriverId, {
    path: ['ownDriverId'],
    message: 'Choose one of your drivers.',
  });

// In-house drivers are created by their restaurant and sign in with these details.
const addOwnDriverSchema = z.object({
  fullName: fullNameSchema,
  email: emailSchema,
  password: passwordSchema,
  phone: z.union([z.literal('').transform(() => undefined), phoneSchema]).optional(),
  vehicle: z.enum(VEHICLES, { error: `Vehicle must be one of: ${VEHICLES.join(', ')}.` }),
  plateNumber: z.string().trim().toUpperCase().max(20, 'Plate number is too long.').optional(),
});

const policySchema = z.object({
  driverPolicy: z.enum(DRIVER_POLICIES, { error: `Policy must be one of: ${DRIVER_POLICIES.join(', ')}.` }),
});

const availabilitySchema = z.object({ online: z.boolean({ error: 'online must be true or false.' }) });

// Ranges match the limits the admin Pricing screen enforces.
const pricingSchema = z
  .object({
    baseDistanceMiles: z.number().min(0.5).max(20),
    baseRestaurantChargeGbp: z.number().min(2.5, 'Restaurant fee must be at least £2.50.').max(12, 'Restaurant fee must be at most £12.00.'),
    extraMileRestaurantChargeGbp: z.number().min(0).max(10),
    extraMileDriverPayoutGbp: z.number().min(0).max(10),
    maxBatchSize: z.number().int().min(1, 'Max batch must be at least 1.').max(5, 'Max batch must be at most 5.'),
    steppedDriverPayoutsGbp: z
      .array(z.number().min(0.5, 'Driver pay must be at least £0.50.').max(8, 'Driver pay must be at most £8.00.'))
      .min(1)
      .max(8),
    maxPrepTimeWindowMinutes: z.number().int().min(1).max(120),
    maxPickupRadiusMiles: z.number().min(0).max(20),
  })
  .partial()
  .refine((o) => Object.keys(o).length > 0, { message: 'Nothing to update.' });

const locationSchema = z.object({
  latitude: z.number({ error: 'latitude is required.' }).min(-90).max(90),
  longitude: z.number({ error: 'longitude is required.' }).min(-180).max(180),
});

const historySchema = z.object({
  before: z.iso.datetime({ offset: true }).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(30),
});

const rejectSchema = z.object({ reason: z.string().trim().max(300).optional() });
const cancelSchema = z.object({ reason: z.string().trim().max(300).default('') });
const uuidSchema = z.uuid('Invalid id.');

module.exports = {
  imageSchema,
  createOrderSchema,
  addOwnDriverSchema,
  policySchema,
  availabilitySchema,
  pricingSchema,
  locationSchema,
  historySchema,
  rejectSchema,
  cancelSchema,
  uuidSchema,
};
