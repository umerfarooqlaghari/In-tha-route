const db = require('../config/db');
const AppError = require('../utils/AppError');
const { timeAgo } = require('../utils/labels');
const dispatch = require('./dispatch.service');
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
    createdAtLabel: timeAgo(row.created_at, now),
    pickupCoords: coordsOf(row.pickup_latitude, row.pickup_longitude),
    dropoffCoords: coordsOf(row.dropoff_latitude, row.dropoff_longitude),
    mapCoords: { pickupX: 0, pickupY: 0, dropoffX: 0, dropoffY: 0 },
  };
}

async function listLiveForRestaurant(restaurantId) {
  const { rows } = await db.query(
    `${ORDER_SELECT} WHERE o.restaurant_id = $1 AND o.status <> 'delivered' ORDER BY o.ready_at ASC`,
    [restaurantId]
  );
  return rows.map((r) => toLiveOrder(r, { view: 'restaurant' }));
}

/** Everything still in progress plus what was delivered today (UK time). */
async function listForAdmin() {
  const { rows } = await db.query(
    `${ORDER_SELECT}
      WHERE o.status <> 'delivered'
         OR (o.delivered_at AT TIME ZONE 'Europe/London')::date = (now() AT TIME ZONE 'Europe/London')::date
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

/** Open orders a platform driver could add to their route, with what each would pay them next. */
async function listPool(config, currentBatchSize) {
  const { rows } = await db.query(
    `${ORDER_SELECT}
      WHERE o.batch_id IS NULL AND o.dispatch_type = 'open_platform'
        AND o.status IN ('preparing', 'ready_for_pickup')
      ORDER BY o.ready_at ASC LIMIT 50`
  );
  return rows.map((r) =>
    toLiveOrder(r, {
      view: 'pool',
      nextPayoutGbp: pricing.calculateOrderFinancials(
        config,
        Number(r.distance_miles),
        currentBatchSize + 1,
        'open_platform'
      ).driverPayoutGbp,
    })
  );
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

/** A restaurant posts an order (normally from a scanned receipt). */
async function createOrder(user, input) {
  const config = await pricing.getConfig();
  const restaurant = await restaurants.ensureCoords(await restaurants.getWithCounts(user.restaurant_id));

  if (input.dispatchType === 'own_driver') {
    const { rows } = await db.query(
      `SELECT 1 FROM driver_profiles
        WHERE id = $1 AND employer_restaurant_id = $2 AND driver_type = 'restaurant_own'`,
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
    const { rows } = await client.query(
      `INSERT INTO orders (
         restaurant_id, source, external_order_id, customer_name, customer_phone, phone_access_code,
         direct_customer_phone, delivery_address, postcode, delivery_instructions, restaurant_pickup_note,
         distance_miles, dropoff_latitude, dropoff_longitude, prep_minutes, ready_at, order_total_gbp,
         items, dispatch_type, status, restaurant_fee_gbp, driver_payout_gbp, created_by)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
               now() + make_interval(mins => $15), $16, $17, $18, 'preparing', $19, $20, $21)
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
      ]
    );
    if (input.dispatchType === 'own_driver') {
      await dispatch.assignToOwnDriver(client, rows[0].id, input.ownDriverId);
    }
    return rows[0].id;
  });

  // Tell drivers straight away (push), without delaying the restaurant's response.
  push.later(() =>
    input.dispatchType === 'own_driver' ? push.ownDriverAssigned(orderId) : dispatch.offerOpenOrders()
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
      WHERE id = $1 AND restaurant_id = $2 AND status <> 'delivered'`,
    [orderId, restaurantId]
  );
  if (rowCount === 0) throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.');
}

module.exports = {
  toLiveOrder,
  listLiveForRestaurant,
  listForAdmin,
  listBatch,
  listPool,
  locateDropoff,
  createOrder,
  markReady,
};
