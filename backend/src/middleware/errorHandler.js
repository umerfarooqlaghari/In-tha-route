const AppError = require('../utils/AppError');

const notFound = (req, res, next) => next(new AppError(404, 'NOT_FOUND', 'Route not found.'));

// eslint-disable-next-line no-unused-vars
const errorHandler = (err, req, res, next) => {
  if (err.type === 'entity.parse.failed') {
    err = new AppError(400, 'INVALID_JSON', 'Request body is not valid JSON.');
  }
  const known = err instanceof AppError;
  const status = known ? err.status : err.status || 500;
  if (status >= 500) console.error(err);

  res.status(status).json({
    error: {
      code: known ? err.code : status >= 500 ? 'INTERNAL_ERROR' : 'ERROR',
      // Internal error text is never sent to clients.
      message: status >= 500 ? 'Internal Server Error' : err.message,
      ...(known && err.details && { details: err.details }),
      ...(process.env.NODE_ENV === 'development' && status >= 500 && { stack: err.stack }),
    },
  });
};

module.exports = errorHandler;
module.exports.notFound = notFound;
