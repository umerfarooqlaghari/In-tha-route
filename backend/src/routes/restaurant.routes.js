const express = require('express');

const c = require('../controllers/restaurant.controller');
const { ROLES } = require('../constants/roles');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const { scanLimiter } = require('../middleware/rateLimit');
const h = require('../utils/asyncHandler');

// All routes: signed-in restaurant users only, scoped to their own restaurant.
const router = express.Router();
router.use(authenticate, authorize(ROLES.RESTAURANT));

router.get('/dashboard', h(c.dashboard)); // orders, in-house drivers, policy, fee
router.post('/receipts/scan', scanLimiter, h(c.scanReceipt)); // photo -> draft order (OCR)
router.post('/orders', h(c.createOrder)); // post an order
router.get('/orders/:id/receipt', h(c.orderReceipt)); // the scanned receipt photo
router.post('/orders/:id/ready', h(c.markOrderReady)); // "Mark ready"
router.post('/orders/:id/cancel', h(c.cancelOrder)); // before the driver collects it
router.post('/drivers', h(c.addDriver)); // add an in-house driver
router.patch('/policy', h(c.updatePolicy)); // delivery settings

module.exports = router;
