const express = require('express');

const controller = require('../controllers/auth.controller');
const authenticate = require('../middleware/authenticate');
const { authLimiter } = require('../middleware/rateLimit');
const asyncHandler = require('../utils/asyncHandler');

const router = express.Router();

/**
 * @swagger
 * components:
 *   securitySchemes:
 *     bearerAuth:
 *       type: http
 *       scheme: bearer
 *       bearerFormat: JWT
 *   schemas:
 *     AuthResponse:
 *       type: object
 *       properties:
 *         user:
 *           type: object
 *           properties:
 *             id: { type: string, format: uuid }
 *             email: { type: string }
 *             role: { type: string, enum: [restaurant, driver, admin] }
 *             fullName: { type: string }
 *             phone: { type: string, nullable: true }
 *             isActive: { type: boolean }
 *             restaurant: { type: object, description: Present for restaurant users }
 *             driver: { type: object, description: Present for driver users }
 *         tokens:
 *           type: object
 *           properties:
 *             accessToken: { type: string }
 *             refreshToken: { type: string }
 *             tokenType: { type: string, example: Bearer }
 *             expiresIn: { type: integer, example: 900 }
 *
 * /api/auth/signup:
 *   post:
 *     summary: Register a restaurant or a platform driver
 *     description: Admin accounts cannot be registered here; role "admin" returns 403.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [role, email, password, fullName, phone]
 *             properties:
 *               role: { type: string, enum: [restaurant, driver] }
 *               email: { type: string, format: email }
 *               password: { type: string, minLength: 8, description: Letter and number required }
 *               fullName: { type: string }
 *               phone: { type: string, example: "07700900123" }
 *               restaurantName: { type: string, description: restaurant only (required) }
 *               address: { type: string, description: restaurant only (required) }
 *               postcode: { type: string, example: "TW9 1DT", description: restaurant only (required) }
 *               pickupSafetyNote: { type: string, description: restaurant only (optional) }
 *               vehicle: { type: string, enum: ["Motorcycle / Scooter", "Car", "E-Bike"], description: driver only (required) }
 *               plateNumber: { type: string, description: driver only (required unless E-Bike) }
 *     responses:
 *       201: { description: Account created, content: { application/json: { schema: { $ref: '#/components/schemas/AuthResponse' } } } }
 *       400: { description: Validation failed }
 *       403: { description: Admin signup is not allowed }
 *       409: { description: Email already registered }
 *
 * /api/auth/login:
 *   post:
 *     summary: Sign in (all roles)
 *     description: The role is read from the database. Any role sent in the body is ignored.
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: object
 *             required: [email, password]
 *             properties:
 *               email: { type: string, format: email }
 *               password: { type: string }
 *     responses:
 *       200: { description: Signed in, content: { application/json: { schema: { $ref: '#/components/schemas/AuthResponse' } } } }
 *       401: { description: Invalid email or password }
 *       403: { description: Account disabled }
 *
 * /api/auth/refresh:
 *   post:
 *     summary: Exchange a refresh token for a new token pair (single use)
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [refreshToken], properties: { refreshToken: { type: string } } }
 *     responses:
 *       200: { description: New tokens }
 *       401: { description: Refresh token invalid, expired or already used }
 *
 * /api/auth/logout:
 *   post:
 *     summary: Revoke a refresh token
 *     tags: [Auth]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema: { type: object, required: [refreshToken], properties: { refreshToken: { type: string } } }
 *     responses:
 *       204: { description: Signed out }
 *
 * /api/auth/me:
 *   get:
 *     summary: The signed-in user's profile
 *     tags: [Auth]
 *     security: [{ bearerAuth: [] }]
 *     responses:
 *       200: { description: Current user }
 *       401: { description: Missing, invalid or expired access token }
 */
router.post('/signup', authLimiter, asyncHandler(controller.signup));
router.post('/login', authLimiter, asyncHandler(controller.login));
router.post('/refresh', authLimiter, asyncHandler(controller.refresh));
router.post('/logout', asyncHandler(controller.logout));
router.get('/me', authenticate, asyncHandler(controller.me));

module.exports = router;
