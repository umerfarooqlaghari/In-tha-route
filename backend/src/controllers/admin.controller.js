const { parse } = require('../middleware/validate');
const drivers = require('../services/driver.service');
const kyc = require('../services/kyc.service');
const orders = require('../services/order.service');
const pricing = require('../services/pricing.service');
const restaurants = require('../services/restaurant.service');
const AppError = require('../utils/AppError');
const v = require('../validators/app.validator');

/** Everything the admin screens show, in one response. All money is calculated here. */
async function buildDashboard() {
  const [allOrders, allDrivers, restaurantRows, config] = await Promise.all([
    orders.listForAdmin(),
    drivers.listAll(),
    restaurants.listWithCounts(),
    pricing.getConfig(),
  ]);

  const billedGbp = pricing.round2(allOrders.reduce((s, o) => s + o.restaurantFeeGbp, 0));
  const driverPayGbp = pricing.round2(
    allOrders.filter((o) => o.dispatchType === 'open_platform').reduce((s, o) => s + o.driverPayoutGbp, 0)
  );

  return {
    role: 'admin',
    orders: allOrders,
    drivers: allDrivers,
    restaurants: restaurantRows.map(restaurants.toPartner),
    algorithm: config,
    pricingSummary: pricing.buildSummary(config),
    totals: { billedGbp, driverPayGbp, profitGbp: pricing.round2(billedGbp - driverPayGbp) },
  };
}

async function dashboard(req, res) {
  res.json(await buildDashboard());
}

/** Changes fees, payouts or batching rules and re-prices every undelivered order. */
async function updatePricing(req, res) {
  const partial = parse(v.pricingSchema, req.body);
  await pricing.updateConfig(partial, req.user.id);
  res.json({ dashboard: await buildDashboard() });
}

async function approveDriver(req, res) {
  await kyc.approve(parse(v.uuidSchema, req.params.id), req.user.id);
  res.json({ dashboard: await buildDashboard() });
}

async function rejectDriver(req, res) {
  const { reason } = parse(v.rejectSchema, req.body);
  await kyc.reject(parse(v.uuidSchema, req.params.id), req.user.id, reason);
  res.json({ dashboard: await buildDashboard() });
}

async function updateRestaurantPolicy(req, res) {
  const { driverPolicy } = parse(v.policySchema, req.body);
  await restaurants.updatePolicy(parse(v.uuidSchema, req.params.id), driverPolicy);
  res.json({ dashboard: await buildDashboard() });
}

/** The photo a driver uploaded for one document. */
async function documentFile(req, res) {
  const file = await kyc.getDocumentFile(parse(v.uuidSchema, req.params.id));
  if (!file) throw new AppError(404, 'FILE_NOT_FOUND', 'No photo has been uploaded for this document.');
  res.set('Content-Type', file.mime_type);
  res.set('Cache-Control', 'private, no-store');
  res.send(file.data);
}

module.exports = { dashboard, updatePricing, approveDriver, rejectDriver, updateRestaurantPolicy, documentFile };
