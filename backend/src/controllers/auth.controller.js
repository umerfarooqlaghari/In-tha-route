const { ROLES, PUBLIC_SIGNUP_ROLES } = require('../constants/roles');
const authService = require('../services/auth.service');
const { toPublicUser } = require('../services/user.service');
const AppError = require('../utils/AppError');
const { SIGNUP_SCHEMAS, loginSchema, refreshSchema } = require('../validators/auth.validator');
const { parse } = require('../middleware/validate');

async function signup(req, res) {
  const role = req.body && req.body.role;
  if (role === ROLES.ADMIN) {
    throw new AppError(403, 'ADMIN_SIGNUP_FORBIDDEN', 'Admin accounts cannot be registered.');
  }
  if (!PUBLIC_SIGNUP_ROLES.includes(role)) {
    throw new AppError(400, 'VALIDATION_ERROR', 'Validation failed.', [
      { field: 'role', message: `Role must be one of: ${PUBLIC_SIGNUP_ROLES.join(', ')}.` },
    ]);
  }
  const data = parse(SIGNUP_SCHEMAS[role], req.body);
  res.status(201).json(await authService.signup(data));
}

async function login(req, res) {
  // Only email and password are read. A role sent by the client is discarded;
  // the role in the response comes from the database.
  const data = parse(loginSchema, req.body);
  res.json(await authService.login(data));
}

async function refresh(req, res) {
  const { refreshToken } = parse(refreshSchema, req.body);
  res.json(await authService.refresh(refreshToken));
}

async function logout(req, res) {
  const { refreshToken } = parse(refreshSchema, req.body);
  await authService.logout(refreshToken);
  res.status(204).end();
}

async function me(req, res) {
  res.json({ user: toPublicUser(req.user) });
}

module.exports = { signup, login, refresh, logout, me };
