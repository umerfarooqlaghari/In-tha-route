const db = require('../config/db');
const { parse } = require('../middleware/validate');
const dispatch = require('../services/dispatch.service');
const drivers = require('../services/driver.service');
const kyc = require('../services/kyc.service');
const orders = require('../services/order.service');
const pricing = require('../services/pricing.service');
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

async function acceptBatch(req, res) {
  await dispatch.accept(req.user.driver_id);
  res.json({ dashboard: await buildDashboard(req.user) });
}

async function declineBatch(req, res) {
  await dispatch.decline(req.user.driver_id);
  // Do not immediately build another offer in the same response.
  res.json({ dashboard: await buildDashboard(req.user, { offer: false }) });
}

async function advanceStop(req, res) {
  await dispatch.advance(req.user.driver_id);
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
  acceptBatch,
  declineBatch,
  advanceStop,
  nextBatch,
  addPoolOrder,
  uploadDocument,
};
