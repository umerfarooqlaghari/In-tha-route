const AppError = require('../utils/AppError');

/** Validates `input` with a zod schema; unknown keys are dropped. */
function parse(schema, input) {
  const result = schema.safeParse(input ?? {});
  if (result.success) return result.data;
  const details = result.error.issues.map((issue) => ({
    field: issue.path.join('.') || 'body',
    message: issue.message,
  }));
  throw new AppError(400, 'VALIDATION_ERROR', 'Validation failed.', details);
}

module.exports = { parse };
