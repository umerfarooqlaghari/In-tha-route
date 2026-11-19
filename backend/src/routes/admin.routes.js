const express = require('express');

const c = require('../controllers/admin.controller');
const { ROLES } = require('../constants/roles');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const h = require('../utils/asyncHandler');

// All routes: admin only.
const router = express.Router();
router.use(authenticate, authorize(ROLES.ADMIN));

router.get('/dashboard', h(c.dashboard)); // live orders, totals, drivers, restaurants, pricing
router.put('/pricing', h(c.updatePricing)); // fees, payouts, batching rules
router.post('/drivers/:id/approve', h(c.approveDriver));
router.post('/drivers/:id/reject', h(c.rejectDriver));
router.patch('/restaurants/:id/policy', h(c.updateRestaurantPolicy));
router.patch('/restaurants/:id/fee', h(c.updateRestaurantFee)); // this merchant's own per-delivery fee (null: standard)
router.patch('/restaurants/:id/status', h(c.updateRestaurantStatus)); // disable / enable the merchant's account
router.post('/restaurants/:id/credits', h(c.adjustRestaurantCredits)); // add or remove credits by hand
router.get('/credits', h(c.creditActivity)); // credit activity across merchants
router.post('/orders/:id/cancel', h(c.cancelOrder)); // any order not delivered yet
router.post('/orders/:id/release', h(c.releaseOrder)); // take off the driver, back to the pool
router.get('/orders/:id/receipt', h(c.orderReceipt)); // the scanned receipt photo
router.get('/kyc-documents/:id/file', h(c.documentFile)); // uploaded photo

module.exports = router;
