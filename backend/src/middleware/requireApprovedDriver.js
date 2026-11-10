const AppError = require('../utils/AppError');

/** Use after `authenticate` + `authorize(ROLES.DRIVER)`. Blocks drivers still awaiting approval. */
module.exports = (req, res, next) => {
  const status = req.user && req.user.driver_status;
  if (status === 'approved_online' || status === 'offline') return next();
  next(new AppError(403, 'DRIVER_NOT_APPROVED', 'Your documents are still being reviewed.'));
};
