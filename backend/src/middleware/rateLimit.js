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

// Each scan is a paid OCR call.
const scanLimiter = rateLimit({
  windowMs: 10 * 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: { error: { code: 'RATE_LIMITED', message: 'Too many scans. Try again in a few minutes.' } },
});

// Generous for real conversations, stops a stuck client flooding a thread.
const chatLimiter = rateLimit({
  windowMs: 60 * 1000,
  limit: 60,
  standardHeaders: true,
  legacyHeaders: false,
  skip: () => process.env.NODE_ENV === 'test',
  message: { error: { code: 'RATE_LIMITED', message: 'You are sending messages too fast. Please wait a moment.' } },
});

module.exports = { authLimiter, scanLimiter, chatLimiter };
