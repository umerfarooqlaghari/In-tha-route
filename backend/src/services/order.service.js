const db = require('../config/db');
const AppError = require('../utils/AppError');
const { timeAgo } = require('../utils/labels');
const dispatch = require('./dispatch.service');
const files = require('./file.service');
const geo = require('./geo.service');
const push = require('./push.service');
const pricing = require('./pricing.service');
const restaurants = require('./restaurant.service');
const { shortArea } = require('./driver.service');

const ORDER_SELECT = `
  SELECT o.*, r.name AS restaurant_name, r.address AS restaurant_address,
         r.postcode AS restaurant_postcode, r.phone AS restaurant_phone, r.latitude AS pickup_latitude,
         r.longitude AS pickup_longitude, u.full_name AS driver_name
    FROM orders o
    JOIN restaurants r ON r.id = o.restaurant_id
    LEFT JOIN driver_profiles d ON d.id = o.assigned_driver_id
    LEFT JOIN users u ON u.id = d.user_id
`;

// Nobody has taken an open order this long after it was ready: tell the restaurant and admins.
const NO_DRIVER_ALERT_MINUTES =
  Number(process.env.NO_DRIVER_ALERT_MINUTES) > 0 ? Number(process.env.NO_DRIVER_ALERT_MINUTES) : 5;
// A collected order still not delivered this long after pickup.
const LATE_DELIVERY_MINUTES =
  Number(process.env.LATE_DELIVERY_MINUTES) > 0 ? Number(process.env.LATE_DELIVERY_MINUTES) : 45;
// The same order number from the same app within this window is treated as a repeat.
const DUPLICATE_WINDOW_HOURS = 24;

/** Why an order needs someone to look at it, if it does. */
function attentionOf(row, now = new Date()) {
  if (
    row.dispatch_type === 'open_platform' && !row.batch_id &&
    (row.status === 'preparing' || row.status === 'ready_for_pickup') &&
    now - new Date(row.ready_at) > NO_DRIVER_ALERT_MINUTES * 60000
  ) {
    return 'no_driver';
  }
  if (row.status === 'picked_up' && row.picked_up_at && now - new Date(row.picked_up_at) > LATE_DELIVERY_MINUTES * 60000) {
    return 'late_delivery';
  }
  return undefined;
}

const coordsOf = (lat, lng) => (lat != null && lng != null ? { latitude: lat, longitude: lng } : null);

/**
 * Shape the mobile app calls a "live order".
 * `view` controls what money and customer details the caller may see:
 *  - restaurant: its own fee, not what the driver is paid
 *  - driver:     their payout, not what the restaurant is charged
 *  - pool:       a driver browsing orders they have not taken — no customer details
 *  - admin:      everything
 */
function toLiveOrder(row, { view, now = new Date(), maskDelivered = false, nextPayoutGbp } = {}) {
  const fee = Number(row.restaurant_fee_gbp);
  const payout = Number(row.driver_payout_gbp);
  const delivered = row.status === 'delivered';
  const pool = view === 'pool';

  return {
    id: row.id,
    source: row.source,
    externalOrderId: row.external_order_id,
    restaurantId: row.restaurant_id,
    restaurantName: row.restaurant_name,
    restaurantAddress: row.restaurant_address,
    restaurantPostcode: row.restaurant_postcode,
    restaurantPhone: view === 'driver' || view === 'admin' ? row.restaurant_phone : undefined,
    customerName: pool ? '' : row.customer_name,
    customerPhone: pool ? '' : row.customer_phone,
    phoneAccessCode: pool ? undefined : row.phone_access_code || undefined,
    directCustomerPhone: pool ? undefined : row.direct_customer_phone || undefined,
    deliveryAddress: pool ? shortArea(row.delivery_address) : row.delivery_address,
    postcode: row.postcode,
    deliveryInstructions: pool ? '' : row.delivery_instructions,
    restaurantPickupNote: row.restaurant_pickup_note,
    distanceMiles: Number(row.distance_miles),
    prepMinutes: row.prep_minutes,
    readyAt: row.ready_at,
    remainingSeconds: delivered ? 0 : Math.max(0, Math.ceil((row.ready_at - now) / 1000)),
    orderTotalGbp: pool ? 0 : Number(row.order_total_gbp),
    items: pool ? [] : row.items,
    dispatchType: row.dispatch_type,
    // While a run is in progress the driver app keeps delivered orders in its stop list.
    status: delivered && maskDelivered ? 'picked_up' : row.status,
    assignedDriverId: row.assigned_driver_id || undefined,
    assignedDriverName: row.driver_name || undefined,
    batchId: row.batch_id || undefined,
    batchPosition: row.batch_position,
    restaurantFeeGbp: view === 'driver' || pool ? 0 : fee,
    driverPayoutGbp: view === 'restaurant' ? 0 : payout,
    platformMarginGbp: view === 'admin' ? pricing.round2(fee - payout) : 0,
    nextPayoutGbp,
    attention: view === 'restaurant' || view === 'admin' ? attentionOf(row, now) : undefined,
    // The scanned receipt photo. A driver gets it for the orders in their run, never in the pool.
    hasReceipt: pool ? undefined : Boolean(row.receipt_file_id),
    createdAtLabel: timeAgo(row.created_at, now),
    pickupCoords: coordsOf(row.pickup_latitude, row.pickup_longitude),
    dropoffCoords: coordsOf(row.dropoff_latitude, row.dropoff_longitude),
    mapCoords: { pickupX: 0, pickupY: 0, dropoffX: 0, dropoffY: 0 },
  };
}

async function listLiveForRestaurant(restaurantId) {
  const { rows } = await db.query(
    `${ORDER_SELECT} WHERE o.restaurant_id = $1 AND o.status NOT IN ('delivered', 'cancelled') ORDER BY o.ready_at ASC`,
    [restaurantId]
  );
  return rows.map((r) => toLiveOrder(r, { view: 'restaurant' }));
}

/** Everything still in progress plus what was delivered today (UK time). */
async function listForAdmin() {
  const { rows } = await db.query(
    `${ORDER_SELECT}
      WHERE o.status NOT IN ('delivered', 'cancelled')
         OR (coalesce(o.delivered_at, o.cancelled_at) AT TIME ZONE 'Europe/London')::date
            = (now() AT TIME ZONE 'Europe/London')::date
      ORDER BY o.created_at DESC`
  );
  return rows.map((r) => toLiveOrder(r, { view: 'admin' }));
}

async function listBatch(batchId, { maskDelivered }) {
  const { rows } = await db.query(
    `${ORDER_SELECT} WHERE o.batch_id = $1 ORDER BY o.batch_position ASC, o.created_at ASC`,
    [batchId]
  );
  return rows.map((r) => toLiveOrder(r, { view: 'driver', maskDelivered }));
}

/**
 * The open pool as one platform driver sees it: open orders within the driver radius of
 * where they are, while they have room in their run. Each shows what it would pay them.
 * @returns {Promise<{orders: object[], room: object}>}
 */
async function listPool(driverRow, config) {
  const room = await dispatch.driverRoom(db, driverRow, config);
  if (room.reason) return { orders: [], room };
  const { rows } = await db.query(
    `${ORDER_SELECT}
      WHERE o.batch_id IS NULL AND o.dispatch_type = 'open_platform'
        AND o.status IN ('preparing', 'ready_for_pickup')
        AND NOT EXISTS (
              SELECT 1 FROM batch_declines x
               WHERE x.driver_id = $1 AND x.order_id = o.id
                 AND x.created_at > now() - make_interval(mins => $2))
      ORDER BY o.ready_at ASC LIMIT 100`,
    [driverRow.id, dispatch.REOFFER_AFTER_MINUTES]
  );
  const orders = rows
    .filter((r) =>
      dispatch.withinReach(room.here, coordsOf(r.pickup_latitude, r.pickup_longitude), config)
    )
    .slice(0, 50)
    .map((r) =>
      toLiveOrder(r, {
        view: 'pool',
        nextPayoutGbp: pricing.calculateOrderFinancials(
          config,
          Number(r.distance_miles),
          room.activeOrders + 1,
          'open_platform'
        ).driverPayoutGbp,
      })
    );
  return { orders, room };
}

/**
 * Where the drop-off is and how far it is from the restaurant (road miles when Google is
 * set up). An unknown postcode is the user's to fix; if the lookup service itself is
 * down the order still goes through, priced at the base distance.
 */
async function locateDropoff(restaurantRow, address, postcode, config) {
  const hit = await geo.locateAddress(address, postcode);
  if (hit.status === 'not_found') {
    throw new AppError(400, 'VALIDATION_ERROR', 'Validation failed.', [
      { field: 'postcode', message: 'We could not find that postcode. Please check it.' },
    ]);
  }
  const pickup = coordsOf(restaurantRow.latitude, restaurantRow.longitude);
  if (hit.status !== 'ok' || !pickup) {
    return { coords: hit.status === 'ok' ? hit : null, distanceMiles: config.baseDistanceMiles, estimated: true };
  }
  const { miles } = await geo.deliveryDistance(pickup, hit);
  return { coords: hit, distanceMiles: miles, estimated: false };
}

/** Stops the same receipt being posted twice (a double tap, or two staff scanning it). */
async function rejectDuplicate(client, restaurantId, input) {
  const ref = String(input.externalOrderId || '').trim();
  if (!ref) return;
  const { rows } = await client.query(
    `SELECT created_at FROM orders
      WHERE restaurant_id = $1 AND source = $2 AND external_order_id = $3 AND status <> 'cancelled'
        AND created_at > now() - make_interval(hours => $4)
      ORDER BY created_at DESC LIMIT 1`,
    [restaurantId, input.source, ref, DUPLICATE_WINDOW_HOURS]
  );
  if (rows[0]) {
    throw new AppError(
      409,
      'DUPLICATE_ORDER',
      `${input.source} order ${ref} was already posted ${timeAgo(rows[0].created_at).toLowerCase()}. Cancel that one first if you need to post it again.`
    );
  }
}

/**
 * The receipt photo to keep with a new order: it must be this user's own scan and not
 * already on another order. Anything else is ignored, the order is still posted.
 */
async function claimReceiptPhoto(client, userId, fileId) {
  if (!fileId) return null;
  // Lock the photo first, then look: two posts at once take turns, and the second sees the first.
  const file = await client.query(
    `SELECT id FROM files WHERE id = $1 AND owner_user_id = $2 AND folder = 'receipts' FOR UPDATE`,
    [fileId, userId]
  );
  if (!file.rows[0]) return null;
  const used = await client.query('SELECT 1 FROM orders WHERE receipt_file_id = $1', [fileId]);
  return used.rows[0] ? null : fileId;
}

/** The receipt photo of one order, or null. A restaurant only gets its own orders'. */
async function getReceiptFile(orderId, { restaurantId, anyRestaurant = false } = {}) {
  if (!anyRestaurant && !restaurantId) return null;
  const { rows } = await db.query(
    `SELECT receipt_file_id FROM orders WHERE id = $1 AND ($2::uuid IS NULL OR restaurant_id = $2)`,
    [orderId, anyRestaurant ? null : restaurantId]
  );
  if (!rows[0] || !rows[0].receipt_file_id) return null;
  return files.getFile(rows[0].receipt_file_id);
}

/**
 * The receipt photo for a driver: only while the order is in their current run (offered,
 * accepted, or just finished and still on their screen). Past deliveries and pool orders are not.
 */
async function getReceiptFileForDriver(orderId, driverId) {
  if (!driverId) return null;
  const { rows } = await db.query(
    `SELECT o.receipt_file_id
       FROM orders o
       JOIN batches b ON b.id = o.batch_id
      WHERE o.id = $1 AND b.driver_id = $2 AND o.status <> 'cancelled'
        AND (b.status IN ('offered', 'accepted') OR (b.status = 'completed' AND NOT b.acknowledged))`,
    [orderId, driverId]
  );
  if (!rows[0] || !rows[0].receipt_file_id) return null;
  return files.getFile(rows[0].receipt_file_id);
}

/** A restaurant posts an order (normally from a scanned receipt). */
async function createOrder(user, input) {
  const config = await pricing.getConfig();
  const restaurant = await restaurants.ensureCoords(await restaurants.getWithCounts(user.restaurant_id));
  await rejectDuplicate(db, restaurant.id, input); // fail fast, before the address lookups

  if (input.dispatchType === 'open_platform' && restaurant.driver_policy === 'own_drivers') {
    throw new AppError(400, 'VALIDATION_ERROR', 'Validation failed.', [
      {
        field: 'dispatchType',
        message: 'Your delivery settings are "My drivers only". Choose one of your drivers, or change the setting.',
      },
    ]);
  }

  if (input.dispatchType === 'own_driver') {
    const { rows } = await db.query(
      `SELECT 1 FROM driver_profiles d JOIN users u ON u.id = d.user_id
        WHERE d.id = $1 AND d.employer_restaurant_id = $2 AND d.driver_type = 'restaurant_own' AND u.is_active`,
      [input.ownDriverId, restaurant.id]
    );
    if (!rows[0]) {
      throw new AppError(400, 'VALIDATION_ERROR', 'Validation failed.', [
        { field: 'ownDriverId', message: 'Choose one of your drivers.' },
      ]);
    }
  }

  const dropoff = await locateDropoff(restaurant, input.deliveryAddress, input.postcode, config);
  const fin = pricing.calculateOrderFinancials(config, dropoff.distanceMiles, 1, input.dispatchType);

  const orderId = await db.withTransaction(async (client) => {
    // One post at a time per order number, so two taps at once cannot both get through.
    if (input.externalOrderId) {
      await client.query('SELECT pg_advisory_xact_lock(hashtext($1))', [
        `order-ref|${restaurant.id}|${input.source}|${input.externalOrderId}`,
      ]);
      await rejectDuplicate(client, restaurant.id, input);
    }
    const receiptFileId = await claimReceiptPhoto(client, user.id, input.receiptFileId);
    const { rows } = await client.query(
      `INSERT INTO orders (
         restaurant_id, source, external_order_id, customer_name, customer_phone, phone_access_code,
         direct_customer_phone, delivery_address, postcode, delivery_instructions, restaurant_pickup_note,
         distance_miles, dropoff_latitude, dropoff_longitude, prep_minutes, ready_at, order_total_gbp,
         items, dispatch_type, status, restaurant_fee_gbp, driver_payout_gbp, created_by, receipt_file_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
               now() + make_interval(mins => $15), $16, $17, $18, 'preparing', $19, $20, $21, $22)
       RETURNING id`,
      [
        restaurant.id,
        input.source,
        input.externalOrderId,
        input.customerName,
        input.customerPhone,
        input.phoneAccessCode || null,
        input.directCustomerPhone || null,
        input.deliveryAddress,
        input.postcode,
        input.deliveryInstructions,
        restaurant.pickup_safety_note || '',
        dropoff.distanceMiles,
        dropoff.coords ? dropoff.coords.latitude : null,
        dropoff.coords ? dropoff.coords.longitude : null,
        input.prepMinutes,
        input.orderTotalGbp,
        JSON.stringify(input.items),
        input.dispatchType,
        fin.restaurantFeeGbp,
        fin.driverPayoutGbp,
        user.id,
        receiptFileId,
      ]
    );
    if (input.dispatchType === 'own_driver') {
      await dispatch.assignToOwnDriver(client, rows[0].id, input.ownDriverId);
    }
    return rows[0].id;
  });

  // Tell drivers straight away (push), without delaying the restaurant's response.
  push.later(() =>
    input.dispatchType === 'own_driver' ? push.ownDriverAssigned(orderId) : dispatch.notifyNearbyDrivers(orderId)
  );

  const { rows } = await db.query(`${ORDER_SELECT} WHERE o.id = $1`, [orderId]);
  return toLiveOrder(rows[0], { view: 'restaurant' });
}

/** The kitchen says the food is ready now: the countdown drops to zero. */
async function markReady(restaurantId, orderId) {
  const { rowCount } = await db.query(
    `UPDATE orders
        SET ready_at = least(ready_at, now()),
            status = CASE WHEN status = 'preparing' THEN 'ready_for_pickup' ELSE status END
      WHERE id = $1 AND restaurant_id = $2 AND status NOT IN ('delivered', 'cancelled')`,
    [orderId, restaurantId]
  );
  if (rowCount === 0) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.');
}

/** The restaurant cancels one of its orders (before the driver has collected it). */
async function cancelForRestaurant(user, orderId, reason) {
  const { order } = await dispatch.cancelOrder(orderId, { userId: user.id, restaurantId: user.restaurant_id, reason });
  push.later(() => push.orderRemovedFromRun(order, 'cancelled'));
}

/** Admin cancels any order that is not delivered yet, collected or not. */
async function cancelForAdmin(user, orderId, reason) {
  const { order } = await dispatch.cancelOrder(orderId, { userId: user.id, reason, allowCollected: true });
  push.later(async () => {
    await push.orderRemovedFromRun(order, order.status === 'picked_up' ? 'cancelled_collected' : 'cancelled');
    await push.orderCancelledByAdmin(order);
  });
}

/** Admin takes an order off its driver and puts it back in the pool for someone else. */
async function releaseForAdmin(orderId) {
  const { order } = await dispatch.releaseToPool(orderId);
  push.later(async () => {
    await push.orderRemovedFromRun(order, 'released');
    await dispatch.notifyNearbyDrivers(order.id);
  });
}

/**
 * Tells restaurants and admins (once per order) about orders nobody has taken and
 * deliveries running very late. Run every ~30 s by the server.
 */
async function sendAttentionAlerts() {
  const noDriver = await db.query(
    `UPDATE orders SET no_driver_alert_at = now()
      WHERE dispatch_type = 'open_platform' AND batch_id IS NULL
        AND status IN ('preparing', 'ready_for_pickup') AND no_driver_alert_at IS NULL
        AND ready_at < now() - make_interval(mins => $1)
      RETURNING id`,
    [NO_DRIVER_ALERT_MINUTES]
  );
  const late = await db.query(
    `UPDATE orders SET late_alert_at = now()
      WHERE status = 'picked_up' AND late_alert_at IS NULL
        AND picked_up_at < now() - make_interval(mins => $1)
      RETURNING id`,
    [LATE_DELIVERY_MINUTES]
  );
  for (const { id } of noDriver.rows) await push.attentionAlert(id, 'no_driver');
  for (const { id } of late.rows) await push.attentionAlert(id, 'late_delivery');
  return { noDriver: noDriver.rowCount, late: late.rowCount };
}

module.exports = {
  NO_DRIVER_ALERT_MINUTES,
  LATE_DELIVERY_MINUTES,
  cancelForRestaurant,
  cancelForAdmin,
  releaseForAdmin,
  sendAttentionAlerts,
  toLiveOrder,
  listLiveForRestaurant,
  listForAdmin,
  listBatch,
  listPool,
  locateDropoff,
  createOrder,
  getReceiptFile,
  getReceiptFileForDriver,
  markReady,
};
