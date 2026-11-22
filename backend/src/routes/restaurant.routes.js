const express = require('express');

const c = require('../controllers/restaurant.controller');
const account = require('../controllers/account.controller');
const { ROLES } = require('../constants/roles');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const { scanLimiter } = require('../middleware/rateLimit');
const h = require('../utils/asyncHandler');

// All routes: signed-in restaurant users only, scoped to their own restaurant.
const router = express.Router();
router.use(authenticate, authorize(ROLES.RESTAURANT));

router.get('/dashboard', h(c.dashboard)); // orders, in-house drivers, policy, fee
router.get('/history', h(c.orderHistory)); // delivered orders
router.get('/analytics', h(c.orderAnalytics)); // ?days=7|30|90
router.post('/receipts/scan', scanLimiter, h(c.scanReceipt)); // photo -> draft order (OCR)
router.post('/orders', h(c.createOrder)); // post an order
router.get('/orders/:id/receipt', h(c.orderReceipt)); // the scanned receipt photo
router.post('/orders/:id/ready', h(c.markOrderReady)); // "Mark ready"
router.post('/orders/:id/cancel', h(c.cancelOrder)); // before the driver collects it
router.post('/orders/:id/find-drivers', h(c.findDriversAgain)); // nobody took it: back into the pool
router.post('/orders/:id/assign-driver', h(c.assignOwnDriver)); // nobody took it: give it to my driver
router.post('/drivers', h(c.addDriver)); // add an in-house driver
router.patch('/policy', h(c.updatePolicy)); // delivery settings
router.patch('/profile', h(account.updateRestaurantProfile)); // business name
router.put('/logo', h(account.uploadLogo)); // business logo (JPEG, PNG or WebP)
router.delete('/logo', h(account.removeLogo));
router.get('/credits', h(c.creditsOverview)); // balance, deliveries left, activity
router.post('/credits/checkout', h(c.buyCredits)); // card payment (Stripe Checkout)
router.post('/credits/confirm', h(c.confirmCredits)); // back from Stripe

module.exports = router;
