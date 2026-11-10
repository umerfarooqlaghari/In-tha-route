const express = require('express');

const c = require('../controllers/driver.controller');
const { ROLES } = require('../constants/roles');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const approved = require('../middleware/requireApprovedDriver');
const h = require('../utils/asyncHandler');

// All routes: signed-in drivers only, acting on their own data.
const router = express.Router();
router.use(authenticate, authorize(ROLES.DRIVER));

router.get('/dashboard', h(c.dashboard)); // batch, pool, earnings, documents
router.post('/documents/:id/upload', h(c.uploadDocument)); // KYC photo (open to pending drivers)

// Everything below needs an approved driver.
router.put('/availability', approved, h(c.setAvailability)); // online / offline
router.get('/history', approved, h(c.orderHistory)); // past deliveries and pay
router.put('/location', approved, h(c.updateLocation)); // GPS position while the app is open
router.post('/batch/accept', approved, h(c.acceptBatch));
router.post('/batch/decline', approved, h(c.declineBatch));
router.post('/batch/advance', approved, h(c.advanceStop)); // "Picked up" / "Delivered"
router.post('/batch/next', approved, h(c.nextBatch)); // "Find new orders" / "Refresh"
router.post('/pool/:id/add', approved, h(c.addPoolOrder)); // add a pool order to my route

module.exports = router;
