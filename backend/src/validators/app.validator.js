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
    // hybrid: the pool, open to the restaurant's own drivers and platform drivers alike.
    dispatchType: z.enum(['open_platform', 'own_driver', 'hybrid'], { error: 'Choose who delivers this order.' }),
    ownDriverId: z.uuid('Choose one of your drivers.').optional(),
    // The photo saved by the scan this order came from.
    receiptFileId: z.uuid().optional().catch(undefined),
    // The merchant was told this receipt is already posted and chose to post it again.
    repeat: z.boolean().optional().default(false),
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
    maxBatchSize: z.number().int().min(1, 'Max batch must be at least 1.').max(8, 'Max batch must be at most 8.'),
    steppedDriverPayoutsGbp: z
      .array(z.number().min(0.5, 'Driver pay must be at least £0.50.').max(8, 'Driver pay must be at most £8.00.'))
      .min(1)
      .max(8),
    maxPrepTimeWindowMinutes: z.number().int().min(1).max(120),
    maxPickupRadiusMiles: z.number().min(0).max(20),
    offerRadiusMiles: z.number().min(0.5, 'Driver radius must be at least 0.5 miles.').max(20, 'Driver radius must be at most 20 miles.'),
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

const analyticsSchema = z.object({
  days: z.coerce.number().int().refine((d) => [7, 30, 90].includes(d), 'Choose 7, 30 or 90 days.').default(7),
});

const rejectSchema = z.object({ reason: z.string().trim().max(300).optional() });
const cancelSchema = z.object({ reason: z.string().trim().max(300).default('') });
const uuidSchema = z.uuid('Invalid id.');
const assignDriverSchema = z.object({ ownDriverId: z.uuid('Choose one of your drivers.') });

// Credits (1 credit = £1).
const buyCreditsSchema = z.object({
  amountGbp: z.coerce
    .number({ error: 'Enter an amount.' })
    .min(10, 'The smallest top-up is £10.')
    .max(5000, 'The largest top-up is £5,000.')
    .refine((n) => Number.isInteger(Math.round(n * 100)) && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6, 'Use whole pence.'),
  returnUrl: z.string().trim().max(500).optional(),
});
const confirmCheckoutSchema = z.object({ sessionId: z.string().trim().min(5).max(255) });
const adjustCreditsSchema = z.object({
  credits: z.coerce
    .number({ error: 'Enter the number of credits.' })
    .refine((n) => n !== 0, 'Enter a number other than 0.')
    .refine((n) => Math.abs(n) <= 100000, 'That is too many credits.'),
  note: z.string().trim().max(200).default(''),
});
const customFeeSchema = z.object({
  // null: back to the standard fee for every merchant.
  customFeeGbp: z.union([z.null(), z.coerce.number().min(0, 'The fee cannot be negative.').max(100, 'The fee is too high.')]),
});
// YYYY-MM-DD, a real date; null clears it.
const documentExpirySchema = z.object({
  expiresOn: z
    .string()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use a date like 2027-03-31.')
    .refine((d) => !Number.isNaN(Date.parse(d)) && new Date(d).toISOString().slice(0, 10) === d, 'That date doesn’t exist.')
    .nullable(),
});
const merchantStatusSchema = z.object({ active: z.boolean({ error: 'active must be true or false.' }) });
const creditsListSchema = z.object({
  kind: z.enum(['purchase', 'grant', 'adjustment', 'delivery']).optional(),
  limit: z.coerce.number().int().min(1).max(500).default(100),
});

module.exports = {
  imageSchema,
  createOrderSchema,
  addOwnDriverSchema,
  policySchema,
  availabilitySchema,
  pricingSchema,
  locationSchema,
  historySchema,
  analyticsSchema,
  rejectSchema,
  cancelSchema,
  uuidSchema,
  assignDriverSchema,
  buyCreditsSchema,
  confirmCheckoutSchema,
  adjustCreditsSchema,
  customFeeSchema,
  merchantStatusSchema,
  documentExpirySchema,
  creditsListSchema,
};
