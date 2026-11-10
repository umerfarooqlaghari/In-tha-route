const express = require('express');

const c = require('../controllers/chat.controller');
const { ROLES } = require('../constants/roles');
const authenticate = require('../middleware/authenticate');
const authorize = require('../middleware/authorize');
const { chatLimiter } = require('../middleware/rateLimit');
const h = require('../utils/asyncHandler');

// Restaurant <-> driver chat. Live updates arrive over the WebSocket at /ws.
const router = express.Router();
router.use(authenticate, authorize(ROLES.RESTAURANT, ROLES.DRIVER));

router.get('/conversations', h(c.listConversations)); // inbox
router.post('/open', h(c.openForOrder)); // { orderId } -> thread for that order
router.get('/conversations/:id/messages', h(c.listMessages)); // ?before=<ISO time>&limit=
router.post('/conversations/:id/messages', chatLimiter, h(c.sendMessage)); // { body }
router.post('/conversations/:id/read', h(c.markRead));

module.exports = router;
