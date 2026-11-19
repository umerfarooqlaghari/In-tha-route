const { parse } = require('../middleware/validate');
const credits = require('../services/credits.service');
const drivers = require('../services/driver.service');
const kyc = require('../services/kyc.service');
const push = require('../services/push.service');
const orders = require('../services/order.service');
const pricing = require('../services/pricing.service');
const restaurants = require('../services/restaurant.service');
const AppError = require('../utils/AppError');
const v = require('../validators/app.validator');

/** A merchant as the admin sees it: also its account state, its fee and its credits. */
function adminPartner(row, config, creditTotals) {
  const feePerDeliveryGbp = pricing.feePerDelivery(config, row.custom_fee_gbp);
  const c = creditTotals || { balance: 0, held: 0, available: 0, addedCredits: 0, purchasedCredits: 0, usedCredits: 0, paidGbp: 0 };
  return {
    ...restaurants.toPartner(row),
    isActive: row.owner_active !== false,
    ownerName: row.owner_name || undefined,
    ownerEmail: row.owner_email || undefined,
    customFeeGbp: row.custom_fee_gbp == null ? null : Number(row.custom_fee_gbp),
    feePerDeliveryGbp,
    credits: {
      ...c,
      deliveriesLeft: feePerDeliveryGbp > 0 ? Math.max(0, Math.floor((c.available + 1e-9) / feePerDeliveryGbp)) : null,
    },
  };
}

/** Everything the admin screens show, in one response. All money is calculated here. */
async function buildDashboard() {
  const [allOrders, allDrivers, restaurantRows, config, creditTotals] = await Promise.all([
    orders.listForAdmin(),
    drivers.listAll(),
    restaurants.listWithCounts(),
    pricing.getConfig(),
    credits.totalsByRestaurant(),
  ]);

  const billedGbp = pricing.round2(allOrders.reduce((s, o) => s + o.restaurantFeeGbp, 0));
  const driverPayGbp = pricing.round2(
    allOrders.filter((o) => o.dispatchType === 'open_platform').reduce((s, o) => s + o.driverPayoutGbp, 0)
  );

  return {
    role: 'admin',
    orders: allOrders,
    drivers: allDrivers,
    restaurants: restaurantRows.map((r) => adminPartner(r, config, creditTotals.get(r.id))),
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
  const driverId = parse(v.uuidSchema, req.params.id);
  await kyc.approve(driverId, req.user.id);
  push.later(() => push.driverReviewed(driverId, true));
  res.json({ dashboard: await buildDashboard() });
}

async function rejectDriver(req, res) {
  const { reason } = parse(v.rejectSchema, req.body);
  const driverId = parse(v.uuidSchema, req.params.id);
  await kyc.reject(driverId, req.user.id, reason);
  push.later(() => push.driverReviewed(driverId, false));
  res.json({ dashboard: await buildDashboard() });
}

/** Charges one merchant its own per-delivery fee (null: back to the standard fee). */
async function updateRestaurantFee(req, res) {
  const { customFeeGbp } = parse(v.customFeeSchema, req.body);
  await pricing.setCustomFee(parse(v.uuidSchema, req.params.id), customFeeGbp == null ? null : pricing.round2(customFeeGbp));
  res.json({ dashboard: await buildDashboard() });
}

/** Turns a merchant's account off (signed out everywhere, cannot sign in) or back on. */
async function updateRestaurantStatus(req, res) {
  const { active } = parse(v.merchantStatusSchema, req.body);
  await restaurants.setActive(parse(v.uuidSchema, req.params.id), active);
  res.json({ dashboard: await buildDashboard() });
}

/** Adds or removes credits for one merchant by hand. */
async function adjustRestaurantCredits(req, res) {
  const { credits: amount, note } = parse(v.adjustCreditsSchema, req.body);
  await credits.adjust(parse(v.uuidSchema, req.params.id), amount, note, req.user.id);
  res.json({ dashboard: await buildDashboard() });
}

/** Credit activity across every merchant: purchases, free credits, adjustments and deliveries. */
async function creditActivity(req, res) {
  const { kind, limit } = parse(v.creditsListSchema, req.query);
  res.json({ transactions: await credits.recentTransactions({ kind, limit }) });
}

/** Cancels an order that is not delivered yet (even one the driver has collected). */
async function cancelOrder(req, res) {
  const orderId = parse(v.uuidSchema, req.params.id);
  const { reason } = parse(v.cancelSchema, req.body || {});
  await orders.cancelForAdmin(req.user, orderId, reason);
  res.json({ dashboard: await buildDashboard() });
}

/** Takes an order off its driver (not yet collected) and offers it to other drivers. */
async function releaseOrder(req, res) {
  await orders.releaseForAdmin(parse(v.uuidSchema, req.params.id));
  res.json({ dashboard: await buildDashboard() });
}

/** The receipt photo an order was scanned from. */
async function orderReceipt(req, res) {
  const file = await orders.getReceiptFile(parse(v.uuidSchema, req.params.id), { anyRestaurant: true });
  if (!file) throw new AppError(404, 'FILE_NOT_FOUND', 'No receipt photo was saved for this order.');
  res.set('Content-Type', file.mime_type);
  res.set('Cache-Control', 'private, no-store');
  res.send(file.data);
}

/** The photo a driver uploaded for one document. */
async function documentFile(req, res) {
  const file = await kyc.getDocumentFile(parse(v.uuidSchema, req.params.id));
  if (!file) throw new AppError(404, 'FILE_NOT_FOUND', 'No file has been uploaded for this document.');
  res.set('Content-Type', file.mime_type);
  res.set('Cache-Control', 'private, no-store');
  res.send(file.data);
}

module.exports = {
  dashboard,
  updatePricing,
  approveDriver,
  rejectDriver,
  updateRestaurantFee,
  updateRestaurantStatus,
  adjustRestaurantCredits,
  creditActivity,
  cancelOrder,
  releaseOrder,
  orderReceipt,
  documentFile,
};
