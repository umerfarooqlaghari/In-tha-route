const { z } = require('zod');
const { emailSchema, passwordSchema } = require('./auth.validator');

const currentPassword = z
  .string({ error: 'Enter your current password.' })
  .min(1, 'Enter your current password.')
  .max(200);

/** Your own name and email. Changing the email needs your current password. */
const updateAccountSchema = z
  .object({
    fullName: z.string().trim().min(2, 'Name must be at least 2 characters.').max(100, 'Name is too long.').optional(),
    email: emailSchema.optional(),
    currentPassword: currentPassword.optional(),
  })
  .refine((v) => v.fullName !== undefined || v.email !== undefined, {
    message: 'Nothing to update.',
    path: ['fullName'],
  });

const changePasswordSchema = z.object({
  currentPassword,
  newPassword: passwordSchema,
});

const deleteAccountSchema = z.object({ password: currentPassword });

const restaurantProfileSchema = z.object({
  name: z
    .string({ error: 'Merchant name is required.' })
    .trim()
    .min(2, 'Merchant name must be at least 2 characters.')
    .max(100, 'Merchant name is too long.'),
});

// Logos are shown in browsers too, so only formats every browser can draw.
const LOGO_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
const logoSchema = z.object({
  imageBase64: z.string({ error: 'Choose a logo image.' }).min(100, 'Choose a logo image.'),
  mimeType: z
    .string()
    .trim()
    .toLowerCase()
    .default('image/jpeg')
    .refine((t) => LOGO_TYPES.includes(t), 'Please use a JPEG, PNG or WebP image.'),
});

module.exports = { updateAccountSchema, changePasswordSchema, deleteAccountSchema, restaurantProfileSchema, logoSchema };
