const accounts = require('../services/account.service');
const v = require('../validators/account.validator');
const { parse } = require('../middleware/validate');
const AppError = require('../utils/AppError');

/** PATCH /api/auth/account — your name and email. */
async function updateAccount(req, res) {
  const data = parse(v.updateAccountSchema, req.body);
  res.json({ user: await accounts.updateAccount(req.user, data) });
}

/** PUT /api/auth/account/password — signs out your other devices; returns fresh tokens. */
async function changePassword(req, res) {
  res.json(await accounts.changePassword(req.user, parse(v.changePasswordSchema, req.body)));
}

/** DELETE /api/auth/account — closes the account for good. */
async function deleteAccount(req, res) {
  const { password } = parse(v.deleteAccountSchema, req.body);
  await accounts.deleteAccount(req.user, password);
  res.status(204).end();
}

/** PATCH /api/restaurant/profile — the business name. */
async function updateRestaurantProfile(req, res) {
  const { name } = parse(v.restaurantProfileSchema, req.body);
  res.json({ user: await accounts.renameRestaurant(req.user, name) });
}

/** PUT /api/restaurant/logo */
async function uploadLogo(req, res) {
  res.json({ user: await accounts.setLogo(req.user, parse(v.logoSchema, req.body)) });
}

/** DELETE /api/restaurant/logo */
async function removeLogo(req, res) {
  res.json({ user: await accounts.removeLogo(req.user) });
}

/** GET /api/files/logos/:id — public, so it can be used as a plain image. */
async function logo(req, res) {
  const id = String(req.params.id);
  const file = /^[0-9a-f-]{36}$/i.test(id) ? await accounts.logoFile(id) : null;
  if (!file) throw new AppError(404, 'LOGO_NOT_FOUND', 'Logo not found.');
  res.set({
    'Content-Type': file.mime_type,
    // A new logo gets a new address, so this one never changes.
    'Cache-Control': 'public, max-age=31536000, immutable',
    'Cross-Origin-Resource-Policy': 'cross-origin',
  });
  res.send(file.data);
}

module.exports = { updateAccount, changePassword, deleteAccount, updateRestaurantProfile, uploadLogo, removeLogo, logo };
