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
const AppError = require('../utils/AppError');

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
  offerRadiusMiles: config.offerRadiusMiles,
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
async function buildDashboard(user) {
  let { row, profile } = await drivers.getSelf(user.driver_id);
  const approved = drivers.isApproved(row.status);

  const config = await pricing.getConfig();
  const batch = approved ? await dispatch.currentBatch(db, row.id) : null;
  const batchOrders = batch ? await orders.listBatch(batch.id, { maskDelivered: batch.status === 'accepted' }) : [];
  // Platform drivers see the open pool near them while they have room in their run;
  // in-house drivers see their own restaurant's hybrid orders in it.
  const pool = approved ? await orders.listPool(row, config) : null;

  return {
    role: 'driver',
    me: profile,
    drivers: [profile],
    restaurants: [],
    orders: [...batchOrders, ...(pool ? pool.orders : [])],
    // How full the driver's run is (the admin's max applies to every driver), and why the
    // pool is empty for them if it is: 'offline' | 'no_location' | 'full'.
    capacity: {
      activeOrders: pool ? pool.room.activeOrders : profile.activeOrders,
      maxOrders: config.maxBatchSize,
      poolBlockedBy: pool ? pool.room.reason : null,
    },
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
  // Going offline hands an unanswered offer to the next driver straight away.
  if (!online) {
    const released = await dispatch.releaseOffer(req.user.driver_id);
    push.later(async () => {
      for (const id of released) await dispatch.notifyNearbyDrivers(id);
    });
  }
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
  const released = await dispatch.decline(req.user.driver_id);
  // The released orders go back to the pool for drivers nearby.
  push.later(async () => {
    for (const id of released) await dispatch.notifyNearbyDrivers(id);
  });
  res.json({ dashboard: await buildDashboard(req.user) });
}

async function advanceStop(req, res) {
  const { orderId, kind } = await dispatch.advance(req.user.driver_id);
  push.later(() => push.orderUpdate([orderId], kind));
  res.json({ dashboard: await buildDashboard(req.user) });
}

/** "Find new orders" / "Refresh". */
async function nextBatch(req, res) {
  await dispatch.acknowledgeCompleted(req.user.driver_id);
  res.json({ dashboard: await buildDashboard(req.user) });
}

async function addPoolOrder(req, res) {
  const orderId = parse(v.uuidSchema, req.params.id);
  const { orderId: added, accepted, ...result } = await dispatch.appendPoolOrder(req.user.driver_id, orderId);
  if (added && accepted) push.later(() => push.orderUpdate([added], 'accepted'));
  res.json({ ...result, dashboard: await buildDashboard(req.user) });
}

/** The receipt photo of an order in the driver's current run. */
async function orderReceipt(req, res) {
  const file = await orders.getReceiptFileForDriver(parse(v.uuidSchema, req.params.id), req.user.driver_id);
  if (!file) throw new AppError(404, 'FILE_NOT_FOUND', 'No receipt photo was saved for this order.');
  res.set('Content-Type', file.mime_type);
  res.set('Cache-Control', 'private, no-store');
  res.send(file.data);
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
  res.json({ dashboard: await buildDashboard(req.user) });
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
  orderReceipt,
  uploadDocument,
};
