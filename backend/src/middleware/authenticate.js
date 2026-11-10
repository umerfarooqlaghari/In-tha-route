const { verifyAccessToken } = require('../services/token.service');
const { findById } = require('../services/user.service');
const AppError = require('../utils/AppError');
const asyncHandler = require('../utils/asyncHandler');

/**
 * Requires a valid `Authorization: Bearer <access token>` header.
 * The user is re-read from the database on every request, so `req.user.role`
 * is always the stored role and disabled accounts lose access immediately.
 */
const authenticate = asyncHandler(async (req, res, next) => {
  const header = req.headers.authorization || '';
  const [scheme, token] = header.split(' ');
  if (scheme !== 'Bearer' || !token) {
    throw new AppError(401, 'UNAUTHENTICATED', 'Authentication required.');
  }

  let payload;
  try {
    payload = verifyAccessToken(token);
  } catch (err) {
    const expired = err.name === 'TokenExpiredError';
    throw new AppError(
      401,
      expired ? 'TOKEN_EXPIRED' : 'INVALID_TOKEN',
      expired ? 'Access token has expired.' : 'Access token is invalid.'
    );
  }

  const user = await findById(payload.sub);
  if (!user) throw new AppError(401, 'INVALID_TOKEN', 'Access token is invalid.');
  if (!user.is_active) throw new AppError(403, 'ACCOUNT_DISABLED', 'This account has been disabled.');

  req.user = user;
  next();
});

module.exports = authenticate;
