const express = require('express');
const db = require('../config/db');

const router = express.Router();

router.use('/auth', require('./auth.routes'));
router.use('/restaurant', require('./restaurant.routes'));
router.use('/driver', require('./driver.routes'));
router.use('/admin', require('./admin.routes'));

/**
 * @swagger
 * /api/health:
 *   get:
 *     summary: Health check endpoint
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: API is healthy
 */
router.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

/**
 * @swagger
 * /api/health/db:
 *   get:
 *     summary: Database connectivity check
 *     tags: [Health]
 *     responses:
 *       200:
 *         description: Database is reachable
 *       503:
 *         description: Database is not reachable
 */
router.get('/health/db', async (req, res) => {
  try {
    const result = await db.query('SELECT NOW() AS now');
    res.json({ status: 'ok', database: 'connected', timestamp: result.rows[0].now });
  } catch (err) {
    console.error('Database health check failed:', err.message);
    res.status(503).json({ status: 'error', database: 'disconnected' });
  }
});

module.exports = router;
