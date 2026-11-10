const { rateLimit } = require('express-rate-limit');

// Slows down password guessing and signup spam. Disabled under test.
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: { error: { code: 'RATE_LIMITED', message: 'Too many attempts. Try again later.' } },
});

module.exports = { authLimiter };
