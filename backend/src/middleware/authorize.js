const AppError = require('../utils/AppError');

/** Use after `authenticate`: authorize(ROLES.ADMIN) or authorize(ROLES.RESTAURANT, ROLES.ADMIN). */
const authorize = (...allowedRoles) => (req, res, next) => {
  if (!req.user) return next(new AppError(401, 'UNAUTHENTICATED', 'Authentication required.'));
  if (!allowedRoles.includes(req.user.role)) {
    return next(new AppError(403, 'FORBIDDEN', 'You do not have permission to do this.'));
  }
  next();
};

module.exports = authorize;
