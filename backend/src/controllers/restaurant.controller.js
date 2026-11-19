const { parse } = require('../middleware/validate');
const analytics = require('../services/analytics.service');
const credits = require('../services/credits.service');
const drivers = require('../services/driver.service');
const files = require('../services/file.service');
const geo = require('../services/geo.service');
const ocr = require('../services/ocr.service');
const orders = require('../services/order.service');
const pricing = require('../services/pricing.service');
const restaurants = require('../services/restaurant.service');
const AppError = require('../utils/AppError');
const v = require('../validators/app.validator');

/** A restaurant sees what it is charged (its own fee, if the admin set one), never what drivers are paid. */
const restaurantPricing = (config, customFeeGbp) => ({
  baseDistanceMiles: config.baseDistanceMiles,
  baseRestaurantChargeGbp: pricing.feePerDelivery(config, customFeeGbp),
  extraMileRestaurantChargeGbp: config.extraMileRestaurantChargeGbp,
  extraMileDriverPayoutGbp: 0,
  maxBatchSize: config.maxBatchSize,
  steppedDriverPayoutsGbp: [],
  maxPrepTimeWindowMinutes: config.maxPrepTimeWindowMinutes,
  maxPickupRadiusMiles: config.maxPickupRadiusMiles,
  offerRadiusMiles: config.offerRadiusMiles,
});

async function loadRestaurant(user) {
  const row = await restaurants.getWithCounts(user.restaurant_id);
  if (!row) throw new AppError(404, 'RESTAURANT_NOT_FOUND', 'Restaurant profile not found.');
  return restaurants.ensureCoords(row);
}

/** Everything the restaurant screens show, in one response. */
async function buildDashboard(user) {
  const restaurant = await loadRestaurant(user);
  const [liveOrders, ownDrivers, config, creditSummary] = await Promise.all([
    orders.listLiveForRestaurant(restaurant.id),
    drivers.listByRestaurant(restaurant.id),
    pricing.getConfig(),
    credits.summaryFor(restaurant.id),
  ]);
  return {
    role: 'restaurant',
    activeRestaurantId: restaurant.id,
    restaurants: [restaurants.toPartner(restaurant)],
    orders: liveOrders,
    drivers: ownDrivers,
    algorithm: restaurantPricing(config, restaurant.custom_fee_gbp),
    credits: creditSummary,
  };
}

async function dashboard(req, res) {
  res.json(await buildDashboard(req.user));
}

/**
 * Keeps the scanned photo so it can be attached to the order when the staff post it.
 * A storage problem must not stop the scan: the order can still be posted without a photo.
 */
async function keepReceiptPhoto(user, imageBase64, mimeType) {
  try {
    return await files.saveImage({ imageBase64, mimeType, ownerUserId: user.id, folder: 'receipts' });
  } catch (err) {
    console.error(`Could not save the receipt photo: ${err.message}`);
    return undefined;
  }
}

/**
 * Reads a receipt photo and returns a draft order for the staff to check.
 * No order is saved yet; the photo is kept and joins the order when it is posted.
 */
async function scanReceipt(req, res) {
  const { imageBase64, mimeType } = parse(v.imageSchema, req.body);
  const image = files.decodeImage(imageBase64, mimeType);
  const [restaurant, config, receipt] = await Promise.all([
    loadRestaurant(req.user),
    pricing.getConfig(),
    ocr.scanReceipt(image.base64, mimeType),
  ]);

  // Only photos that really were receipts get here (the scan throws otherwise).
  const savingPhoto = keepReceiptPhoto(req.user, image.base64, mimeType);

  let distanceMiles = 0;
  let dropoffCoords = null;
  if (receipt.postcode) {
    const hit = await geo.locateAddress(receipt.deliveryAddress, receipt.postcode);
    if (hit.status === 'ok') {
      dropoffCoords = { latitude: hit.latitude, longitude: hit.longitude };
      if (restaurant.latitude != null) {
        const pickup = { latitude: restaurant.latitude, longitude: restaurant.longitude };
        distanceMiles = (await geo.deliveryDistance(pickup, dropoffCoords)).miles;
      }
    }
  }

  res.json({
    draft: {
      id: `scan-${Date.now()}`,
      ...receipt,
      receiptFileId: await savingPhoto,
      postcode: geo.formatPostcode(receipt.postcode),
      phoneAccessCode: receipt.phoneAccessCode || undefined,
      directCustomerPhone: receipt.directCustomerPhone || undefined,
      suggestedPrepMinutes: receipt.suggestedPrepMinutes || 20,
      restaurantId: restaurant.id,
      restaurantName: restaurant.name,
      restaurantAddress: restaurant.address,
      restaurantPostcode: restaurant.postcode,
      restaurantPickupNote: restaurant.pickup_safety_note || '',
      distanceMiles,
      estimatedFeeGbp: pricing.calculateOrderFinancials(config, distanceMiles, 1, 'open_platform', restaurant.custom_fee_gbp)
        .restaurantFeeGbp,
      pickupCoords:
        restaurant.latitude != null ? { latitude: restaurant.latitude, longitude: restaurant.longitude } : null,
      dropoffCoords,
      mapCoords: { pickupX: 0, pickupY: 0, dropoffX: 0, dropoffY: 0 },
    },
  });
}

async function createOrder(req, res) {
  const input = parse(v.createOrderSchema, req.body);
  const order = await orders.createOrder(req.user, input);
  res.status(201).json({ order, dashboard: await buildDashboard(req.user) });
}

/** The receipt photo an order was scanned from. */
async function orderReceipt(req, res) {
  const file = await orders.getReceiptFile(parse(v.uuidSchema, req.params.id), { restaurantId: req.user.restaurant_id });
  if (!file) throw new AppError(404, 'FILE_NOT_FOUND', 'No receipt photo was saved for this order.');
  res.set('Content-Type', file.mime_type);
  res.set('Cache-Control', 'private, no-store');
  res.send(file.data);
}

async function markOrderReady(req, res) {
  const orderId = parse(v.uuidSchema, req.params.id);
  await orders.markReady(req.user.restaurant_id, orderId);
  res.json({ dashboard: await buildDashboard(req.user) });
}

/** "Cancel order": allowed until the driver has collected it. */
async function cancelOrder(req, res) {
  const orderId = parse(v.uuidSchema, req.params.id);
  const { reason } = parse(v.cancelSchema, req.body || {});
  await orders.cancelForRestaurant(req.user, orderId, reason);
  res.json({ dashboard: await buildDashboard(req.user) });
}

/** "Find drivers again": an order nobody took goes back into the pool. */
async function findDriversAgain(req, res) {
  await orders.findDriversAgain(req.user.restaurant_id, parse(v.uuidSchema, req.params.id));
  res.json({ dashboard: await buildDashboard(req.user) });
}

/** An order nobody took is given to one of the restaurant's own drivers. */
async function assignOwnDriver(req, res) {
  const { ownDriverId } = parse(v.assignDriverSchema, req.body || {});
  await orders.assignWaitingToOwnDriver(req.user.restaurant_id, parse(v.uuidSchema, req.params.id), ownDriverId);
  res.json({ dashboard: await buildDashboard(req.user) });
}

async function addDriver(req, res) {
  const data = parse(v.addOwnDriverSchema, req.body);
  await drivers.createOwnDriver(req.user.restaurant_id, data);
  res.status(201).json({ dashboard: await buildDashboard(req.user) });
}

async function updatePolicy(req, res) {
  const { driverPolicy } = parse(v.policySchema, req.body);
  await restaurants.updatePolicy(req.user.restaurant_id, driverPolicy);
  res.json({ dashboard: await buildDashboard(req.user) });
}

/** Delivered orders, newest first. */
async function orderHistory(req, res) {
  const { before, limit } = parse(v.historySchema, req.query);
  res.json(await orders.historyForRestaurant(req.user.restaurant_id, { before, limit }));
}

/** Sales, orders and timings for the last 7, 30 or 90 days. */
async function orderAnalytics(req, res) {
  const { days } = parse(v.analyticsSchema, req.query);
  res.json(await analytics.forRestaurant(req.user.restaurant_id, days));
}

/** Credits: balance, deliveries left, and recent activity. */
async function creditsOverview(req, res) {
  const [summary, transactions] = await Promise.all([
    credits.summaryFor(req.user.restaurant_id),
    credits.transactionsFor(req.user.restaurant_id),
  ]);
  res.json({ credits: summary, transactions });
}

/** Starts a card payment for credits (Stripe Checkout) and returns where to send the merchant. */
async function buyCredits(req, res) {
  const { amountGbp, returnUrl } = parse(v.buyCreditsSchema, req.body);
  res.status(201).json(await credits.startCheckout(req.user, amountGbp, returnUrl || req.get('origin')));
}

/** Back from Stripe: adds the credits if the payment went through. */
async function confirmCredits(req, res) {
  const { sessionId } = parse(v.confirmCheckoutSchema, req.body);
  const status = await credits.confirmCheckout(req.user.restaurant_id, sessionId);
  res.json({ status, credits: await credits.summaryFor(req.user.restaurant_id) });
}

module.exports = {
  dashboard,
  creditsOverview,
  buyCredits,
  confirmCredits,
  orderHistory,
  orderAnalytics,
  scanReceipt,
  createOrder,
  orderReceipt,
  markOrderReady,
  cancelOrder,
  findDriversAgain,
  assignOwnDriver,
  addDriver,
  updatePolicy,
};
