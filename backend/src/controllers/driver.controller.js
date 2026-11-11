const db = require('../config/db');
const { parse } = require('../middleware/validate');
const dispatch = require('../services/dispatch.service');
const drivers = require('../services/driver.service');
const geo = require('../services/geo.service');
const kyc = require('../services/kyc.service');
const orders = require('../services/order.service');
const pricing = require('../services/pricing.service');
const push = require('../services/push.service');
const v = require('../validators/app.validator');

/** A driver sees what they are paid, never what restaurants are charged. */
const driverPricing = (config) => ({
  baseDistanceMiles: config.baseDistanceMiles,
  baseRestaurantChargeGbp: 0,
  extraMileRestaurantChargeGbp: 0,
  extraMileDriverPayoutGbp: config.extraMileDriverPayoutGbp,
  maxBatchSize: config.maxBatchSize,
  steppedDriverPayoutsGbp: config.steppedDriverPayoutsGbp,
  maxPrepTimeWindowMinutes: config.maxPrepTimeWindowMinutes,
  maxPickupRadiusMiles: config.maxPickupRadiusMiles,
});

// Typical average speeds in town, used for the "~min" estimate on an offer.
const SPEED_MPH = { 'Motorcycle / Scooter': 16, Car: 14, 'E-Bike': 11 };
const MINUTES_PER_STOP = 3;

// Re-ask Google for the live route at most this often per driver (it is polled every ~12 s).
const ROUTE_REFRESH_SECONDS = Number(process.env.ROUTE_REFRESH_SECONDS) > 0 ? Number(process.env.ROUTE_REFRESH_SECONDS) : 180;

/**
 * Miles, minutes and the route line for the stops still to do, starting from where the
 * driver is (if the app has sent a recent GPS fix). Stops: all pickups, then all drop-offs.
 * Uses Google road routing with live traffic when set up; otherwise straight lines at a
 * typical town speed. `polyline` is a Google encoded polyline, or '' when not available.
 */
async function routeEstimate(row, batchOrders, fromStop) {
  const stops = [
    ...batchOrders.map((o) => o.pickupCoords),
    ...batchOrders.map((o) => o.dropoffCoords),
  ].slice(fromStop);
  if (stops.length === 0) return null;

  let miles = 0;
  const start = drivers.freshLocation(row);
  let previous = start;
  let stopCount = 0;
  let lastPickup = null;
  const path = start ? [start] : [];
  stops.forEach((point, i) => {
    const isPickup = i + fromStop < batchOrders.length;
    // Several orders from one restaurant are a single stop.
    const samePickup = isPickup && lastPickup && point && point.latitude === lastPickup.latitude && point.longitude === lastPickup.longitude;
    if (!samePickup) {
      stopCount += 1;
      if (point) path.push(point);
    }
    if (isPickup) lastPickup = point;
    if (point && previous) miles += geo.deliveryMiles(previous, point);
    if (point) previous = point;
  });

  const speed = SPEED_MPH[row.vehicle] || 14;
  const road = await geo.drivingRoute(path, { traffic: true, cacheSeconds: ROUTE_REFRESH_SECONDS, keyPlaces: 3 });
  if (road) {
    // Google drives a car; an e-bike is slower than that, so its time comes from its own speed.
    const driveMinutes = row.vehicle === 'E-Bike' ? (road.miles / speed) * 60 : road.minutes;
    return {
      miles: road.miles,
      minutes: Math.max(1, Math.round(driveMinutes + stopCount * MINUTES_PER_STOP)),
      polyline: road.polyline,
      source: 'road',
    };
  }
  return {
    miles: Number(miles.toFixed(1)),
    minutes: Math.max(1, Math.round((miles / speed) * 60 + stopCount * MINUTES_PER_STOP)),
    polyline: '',
    source: 'straight',
  };
}

const BATCH_STATUS = { offered: 'offered', accepted: 'accepted_navigating', completed: 'accepted_navigating' };

/** Everything the driver screens show, in one response. */
async function buildDashboard(user, { offer = true } = {}) {
  let { row, profile } = await drivers.getSelf(user.driver_id);
  const approved = drivers.isApproved(row.status);
  const platform = row.driver_type === 'platform_contracted';

  // An online platform driver with nothing to do is offered the next batch.
  if (offer && platform && row.status === 'approved_online') {
    await dispatch.offerNextBatch(row.id).catch((err) => console.error('Offer failed:', err.message));
  }

  const config = await pricing.getConfig();
  const batch = approved ? await dispatch.currentBatch(db, row.id) : null;
  const batchOrders = batch ? await orders.listBatch(batch.id, { maskDelivered: batch.status === 'accepted' }) : [];
  const openCount = batch && batch.status !== 'completed' ? batchOrders.length : 0;
  const pool = approved && platform ? await orders.listPool(config, openCount) : [];

  return {
    role: 'driver',
    me: profile,
    drivers: [profile],
    restaurants: [],
    orders: [...batchOrders, ...pool],
    algorithm: driverPricing(config),
    currentBatchId: batch ? batch.id : null,
    driverBatchStatus: batch ? BATCH_STATUS[batch.status] : 'declined',
    activeStopIndex: batch && batch.status === 'accepted' ? batch.active_stop_index : 0,
    isOnline: row.status === 'approved_online',
    routeEstimate: batch && batch.status !== 'completed'
      ? await routeEstimate(row, batchOrders, batch.status === 'accepted' ? batch.active_stop_index : 0)
      : null,
    earnings: await drivers.earnings(row),
  };
}

async function dashboard(req, res) {
  res.json(await buildDashboard(req.user));
}

async function setAvailability(req, res) {
  const { online } = parse(v.availabilitySchema, req.body);
  await drivers.setOnline(req.user.driver_id, online);
  res.json({ dashboard: await buildDashboard(req.user) });
}

/** Past deliveries with pay, newest first. */
async function orderHistory(req, res) {
  const { before, limit } = parse(v.historySchema, req.query);
  res.json(await drivers.history(req.user.driver_id, { before, limit }));
}

/** The app sends its GPS position while open; no dashboard in the reply to keep it light. */
async function updateLocation(req, res) {
  const location = parse(v.locationSchema, req.body);
  await drivers.updateLocation(req.user.driver_id, location);
  res.status(204).end();
}

async function acceptBatch(req, res) {
  const orderIds = await dispatch.accept(req.user.driver_id);
  push.later(() => push.orderUpdate(orderIds, 'accepted'));
  res.json({ dashboard: await buildDashboard(req.user) });
}

async function declineBatch(req, res) {
  await dispatch.decline(req.user.driver_id);
  // The released orders go to another online driver.
  push.later(() => dispatch.offerOpenOrders());
  // Do not immediately build another offer in the same response.
  res.json({ dashboard: await buildDashboard(req.user, { offer: false }) });
}

async function advanceStop(req, res) {
  const { orderId, kind } = await dispatch.advance(req.user.driver_id);
  push.later(() => push.orderUpdate([orderId], kind));
  res.json({ dashboard: await buildDashboard(req.user, { offer: false }) });
}

/** "Find new orders" / "Refresh". */
async function nextBatch(req, res) {
  await dispatch.acknowledgeCompleted(req.user.driver_id);
  res.json({ dashboard: await buildDashboard(req.user) });
}

async function addPoolOrder(req, res) {
  const orderId = parse(v.uuidSchema, req.params.id);
  const result = await dispatch.appendPoolOrder(req.user.driver_id, orderId);
  res.json({ ...result, dashboard: await buildDashboard(req.user, { offer: false }) });
}

async function uploadDocument(req, res) {
  const documentId = parse(v.uuidSchema, req.params.id);
  const { imageBase64, mimeType } = parse(v.imageSchema, req.body);
  await kyc.upload({
    driverId: req.user.driver_id,
    userId: req.user.id,
    documentId,
    imageBase64,
    mimeType,
  });
  res.json({ dashboard: await buildDashboard(req.user, { offer: false }) });
}

module.exports = {
  dashboard,
  setAvailability,
  updateLocation,
  orderHistory,
  acceptBatch,
  declineBatch,
  advanceStop,
  nextBatch,
  addPoolOrder,
  uploadDocument,
};
