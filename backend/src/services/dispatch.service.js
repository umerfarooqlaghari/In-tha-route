const db = require('../config/db');
const AppError = require('../utils/AppError');
const geo = require('./geo.service');
const pricing = require('./pricing.service');
const { freshLocation } = require('./driver.service');

/**
 * Batches: a driver's run of one or more orders.
 *
 * Stops are always "every pickup in batch order, then every drop-off in batch
 * order" — the same sequence the driver app builds — so `active_stop_index`
 * means the same thing on both sides.
 *
 * Open pool (platform orders): a new order is shown at once to every online platform
 * driver within the admin's driver radius of the restaurant who has room in their run
 * (fewer orders on the way than the admin's max). The first to accept gets it.
 * Delivering an order frees a place, so the driver sees new orders again.
 *
 *   accepted -> completed                    (a driver takes a pool order, or an
 *                                             in-house driver is given one)
 *   offered  -> accepted / declined          (older offers made before the open pool)
 */
const REOFFER_AFTER_MINUTES = 10; // an order taken off a driver is not shown back to them this soon
// An old-style offer nobody answers is withdrawn after this long.
const OFFER_TIMEOUT_SECONDS =
  Number(process.env.OFFER_TIMEOUT_SECONDS) > 0 ? Number(process.env.OFFER_TIMEOUT_SECONDS) : 120;

// Orders a driver still has to collect or deliver: these count towards the max per run.
const ACTIVE_STATUSES = "('batched_offered', 'driver_assigned', 'picked_up')";

const isApproved = (status) => status === 'approved_online' || status === 'offline';

/** The batch a driver is working on or being offered, oldest first. */
async function openBatch(client, driverId, { lock = false } = {}) {
  const { rows } = await client.query(
    `SELECT * FROM batches WHERE driver_id = $1 AND status IN ('offered', 'accepted')
      ORDER BY created_at ASC LIMIT 1 ${lock ? 'FOR UPDATE' : ''}`,
    [driverId]
  );
  return rows[0] || null;
}

/**
 * What the driver app should show: a finished batch the driver has not
 * dismissed yet comes first ("Batch complete"), then any open batch.
 */
async function currentBatch(client, driverId) {
  const { rows } = await client.query(
    `SELECT * FROM batches
      WHERE driver_id = $1
        AND (status IN ('offered', 'accepted') OR (status = 'completed' AND NOT acknowledged))
      ORDER BY (status = 'completed') DESC, created_at ASC LIMIT 1`,
    [driverId]
  );
  return rows[0] || null;
}

const countOrders = async (client, batchId) =>
  (await client.query('SELECT count(*)::int AS n FROM orders WHERE batch_id = $1', [batchId])).rows[0].n;

async function lockDriver(client, driverId) {
  const { rows } = await client.query('SELECT * FROM driver_profiles WHERE id = $1 FOR UPDATE', [driverId]);
  if (!rows[0]) throw new AppError(404, 'DRIVER_NOT_FOUND', 'Driver profile not found.');
  return rows[0];
}

/** How many orders a driver is carrying or still has to collect. */
async function activeOrderCount(client, driverId) {
  const { rows } = await client.query(
    `SELECT count(*)::int AS n FROM orders WHERE assigned_driver_id = $1 AND status IN ${ACTIVE_STATUSES}`,
    [driverId]
  );
  return rows[0].n;
}

/**
 * Whether a driver can take new pool orders now, and why not. In-house drivers only take
 * their own restaurant's hybrid orders, and need no location for that (the restaurant can
 * give them an order wherever they are, too).
 * @returns {{activeOrders: number, maxOrders: number, here: object|null,
 *            reason: null | 'offline' | 'no_location' | 'full'}}
 */
async function driverRoom(client, driver, config) {
  const activeOrders = await activeOrderCount(client, driver.id);
  const here = freshLocation(driver);
  const maxOrders = config.maxBatchSize;
  const inHouse = driver.driver_type === 'restaurant_own';
  let reason = null;
  if (driver.status !== 'approved_online') reason = 'offline';
  else if (activeOrders >= maxOrders) reason = 'full';
  else if (!here && !inHouse) reason = 'no_location';
  return { activeOrders, maxOrders, here, reason };
}

/** Whether a restaurant is within the driver radius (a restaurant without a map pin always is). */
const withinReach = (here, pickup, config) =>
  !pickup || pickup.latitude == null || geo.straightLineMiles(here, pickup) <= config.offerRadiusMiles;

/**
 * Pushes a new pool order to every driver who can take it right now: online, within the
 * driver radius of the restaurant, with room in their run. Called when an order is posted
 * or comes back to the pool.
 * @returns {Promise<string[]>} the drivers told
 */
async function notifyNearbyDrivers(orderId) {
  const push = require('./push.service');
  const config = await pricing.getConfig();
  const { rows: found } = await db.query(
    `SELECT o.id, o.distance_miles, o.external_order_id, o.postcode, o.hybrid, o.restaurant_id,
            r.name AS restaurant, r.latitude, r.longitude
       FROM orders o JOIN restaurants r ON r.id = o.restaurant_id
      WHERE o.id = $1 AND o.batch_id IS NULL AND o.dispatch_type = 'open_platform'
        AND o.status IN ('preparing', 'ready_for_pickup')`,
    [orderId]
  );
  const order = found[0];
  if (!order) return [];
  // Platform drivers, plus the restaurant's own drivers when it is a hybrid order.
  const { rows: drivers } = await db.query(
    `SELECT d.*, (SELECT count(*) FROM orders x
                   WHERE x.assigned_driver_id = d.id AND x.status IN ${ACTIVE_STATUSES})::int AS active_orders
       FROM driver_profiles d JOIN users u ON u.id = d.user_id
      WHERE (d.driver_type = 'platform_contracted'
             OR ($3 AND d.driver_type = 'restaurant_own' AND d.employer_restaurant_id = $4))
        AND d.status = 'approved_online' AND u.is_active
        AND NOT EXISTS (
              SELECT 1 FROM batch_declines x
               WHERE x.driver_id = d.id AND x.order_id = $1
                 AND x.created_at > now() - make_interval(mins => $2))`,
    [orderId, REOFFER_AFTER_MINUTES, order.hybrid, order.restaurant_id]
  );
  const told = [];
  for (const d of drivers) {
    const inHouse = d.driver_type === 'restaurant_own';
    const here = freshLocation(d);
    if (d.active_orders >= config.maxBatchSize) continue;
    if (!inHouse && (!here || !withinReach(here, order, config))) continue;
    const pay = pricing.calculateOrderFinancials(
      config, Number(order.distance_miles), d.active_orders + 1, inHouse ? 'own_driver' : 'open_platform'
    ).driverPayoutGbp;
    await push.newOrderNearby(d.user_id, { ...order, pay, inHouse });
    told.push(d.id);
  }
  return told;
}

/**
 * Withdraws offers that were not answered in time (the driver is treated as having declined),
 * so the orders can go to someone else. Run every ~30 s by the server.
 * @returns {Promise<number>} how many offers were withdrawn
 */
async function expireStaleOffers() {
  const { rows } = await db.query(
    `SELECT b.driver_id FROM batches b
       JOIN driver_profiles d ON d.id = b.driver_id
      WHERE b.status = 'offered' AND d.driver_type = 'platform_contracted'
        AND b.created_at < now() - make_interval(secs => $1)`,
    [OFFER_TIMEOUT_SECONDS]
  );
  let expired = 0;
  for (const { driver_id: driverId } of rows) {
    await decline(driverId)
      .then(() => (expired += 1))
      .catch((err) => console.error('Expiring an offer failed:', err.message));
  }
  return expired;
}

// An order going back to the pool keeps "ready" if the kitchen already said so.
const BACK_TO_POOL_STATUS = `CASE WHEN ready_at <= now() THEN 'ready_for_pickup' ELSE 'preparing' END`;

const rememberDecline = (client, driverId, orderId) =>
  client.query(
    `INSERT INTO batch_declines (driver_id, order_id) VALUES ($1, $2)
     ON CONFLICT (driver_id, order_id) DO UPDATE SET created_at = now()`,
    [driverId, orderId]
  );

/**
 * The driver went offline: an offer they have not accepted goes back to the pool straight away.
 * @returns {Promise<string[]>} the released orders
 */
async function releaseOffer(driverId) {
  try {
    return await decline(driverId, { remember: false });
  } catch (err) {
    if (err.code === 'NO_OFFER') return [];
    throw err;
  }
}

/** @returns {Promise<string[]>} the accepted orders' ids */
async function accept(driverId) {
  return db.withTransaction(async (client) => {
    const batch = await openBatch(client, driverId, { lock: true });
    if (!batch || batch.status !== 'offered') {
      throw new AppError(409, 'NO_OFFER', 'This offer is no longer available.');
    }
    if (Date.now() - new Date(batch.created_at).getTime() > (OFFER_TIMEOUT_SECONDS + 15) * 1000) {
      throw new AppError(409, 'OFFER_EXPIRED', 'This offer has expired. Look out for the next one.');
    }
    await client.query(
      `UPDATE batches SET status = 'accepted', accepted_at = now(), active_stop_index = 0 WHERE id = $1`,
      [batch.id]
    );
    const { rows } = await client.query(
      `UPDATE orders SET status = 'driver_assigned' WHERE batch_id = $1 RETURNING id`,
      [batch.id]
    );
    return rows.map((r) => r.id);
  });
}

/**
 * Declining releases every order back to the pool at single-order prices.
 * `remember: false` (the driver went offline) releases them without blocking the driver
 * from being offered them again later.
 */
async function decline(driverId, { remember = true } = {}) {
  return db.withTransaction(async (client) => {
    const batch = await openBatch(client, driverId, { lock: true });
    if (!batch || batch.status !== 'offered') {
      throw new AppError(409, 'NO_OFFER', 'This offer is no longer available.');
    }
    const config = await pricing.getConfig(client);
    const { rows } = await client.query(
      'SELECT id, distance_miles, dispatch_type FROM orders WHERE batch_id = $1 FOR UPDATE',
      [batch.id]
    );
    for (const o of rows) {
      const fin = pricing.calculateOrderFinancials(config, Number(o.distance_miles), 1, o.dispatch_type);
      await client.query(
        `UPDATE orders SET batch_id = NULL, batch_position = 1, assigned_driver_id = NULL,
                status = ${BACK_TO_POOL_STATUS}, restaurant_fee_gbp = $1, driver_payout_gbp = $2
          WHERE id = $3`,
        [fin.restaurantFeeGbp, fin.driverPayoutGbp, o.id]
      );
      if (remember) await rememberDecline(client, driverId, o.id);
    }
    await client.query(`UPDATE batches SET status = 'declined' WHERE id = $1`, [batch.id]);
    return rows.map((o) => o.id);
  });
}

/**
 * Completes the current stop ("Picked up" / "Delivered") and moves to the next.
 * Completing the last drop-off completes the batch.
 * @returns {Promise<{orderId: string, kind: 'picked_up' | 'delivered'}>}
 */
async function advance(driverId) {
  return db.withTransaction(async (client) => {
    const batch = await openBatch(client, driverId, { lock: true });
    if (!batch || batch.status !== 'accepted') {
      throw new AppError(409, 'NO_ACTIVE_BATCH', 'You have no delivery in progress.');
    }
    const { rows: orders } = await client.query(
      'SELECT id, status FROM orders WHERE batch_id = $1 ORDER BY batch_position ASC, created_at ASC FOR UPDATE',
      [batch.id]
    );
    const n = orders.length;
    const index = batch.active_stop_index;
    if (n === 0 || index >= n * 2) {
      throw new AppError(409, 'NO_ACTIVE_BATCH', 'You have no delivery in progress.');
    }

    if (index < n) {
      await client.query(`UPDATE orders SET status = 'picked_up', picked_up_at = now() WHERE id = $1`, [orders[index].id]);
    } else {
      await client.query(
        `UPDATE orders SET status = 'delivered', delivered_at = now(),
                picked_up_at = coalesce(picked_up_at, now())
          WHERE id = $1`,
        [orders[index - n].id]
      );
      await client.query(
        'UPDATE driver_profiles SET completed_deliveries = completed_deliveries + 1 WHERE id = $1',
        [driverId]
      );
    }

    if (index + 1 >= n * 2) {
      await client.query(
        `UPDATE batches SET status = 'completed', completed_at = now(), active_stop_index = 0 WHERE id = $1`,
        [batch.id]
      );
    } else {
      await client.query('UPDATE batches SET active_stop_index = $1 WHERE id = $2', [index + 1, batch.id]);
    }
    return index < n ? { orderId: orders[index].id, kind: 'picked_up' } : { orderId: orders[index - n].id, kind: 'delivered' };
  });
}

/** "Find new orders": dismiss the finished batch so the next one can be shown or offered. */
async function acknowledgeCompleted(driverId, client = db) {
  await client.query(
    `UPDATE batches SET acknowledged = true WHERE driver_id = $1 AND status = 'completed' AND NOT acknowledged`,
    [driverId]
  );
}

/**
 * Once the driver has delivered some orders of a run, the delivered ones are filed away as
 * a finished run of their own, so a new order can be added: the orders still on board stay
 * in their order with every pickup done, and the new pickup becomes the next stop.
 */
async function fileDeliveredOrders(client, batch, count) {
  if (batch.status !== 'accepted' || batch.active_stop_index <= count) return count;
  const { rows: delivered } = await client.query(
    `SELECT id FROM orders WHERE batch_id = $1 AND status = 'delivered'`,
    [batch.id]
  );
  if (delivered.length > 0) {
    const done = (
      await client.query(
        `INSERT INTO batches (driver_id, status, acknowledged, created_at, accepted_at, completed_at)
         VALUES ($1, 'completed', true, $2, $3, now()) RETURNING id`,
        [batch.driver_id, batch.created_at, batch.accepted_at]
      )
    ).rows[0];
    await client.query('UPDATE orders SET batch_id = $1 WHERE id = ANY($2::uuid[])', [
      done.id,
      delivered.map((d) => d.id),
    ]);
  }
  const { rows: onBoard } = await client.query(
    'SELECT id FROM orders WHERE batch_id = $1 ORDER BY batch_position ASC, created_at ASC',
    [batch.id]
  );
  for (let i = 0; i < onBoard.length; i++) {
    await client.query('UPDATE orders SET batch_position = $1 WHERE id = $2', [i + 1, onBoard[i].id]);
  }
  // Every order left has been collected: the next stop is the new order's pickup.
  await client.query('UPDATE batches SET active_stop_index = $1 WHERE id = $2', [onBoard.length, batch.id]);
  return onBoard.length;
}

/**
 * A driver accepts an order from the open pool. The first driver to accept gets it;
 * anyone else is told it has been taken. In-house drivers can take their own restaurant's
 * hybrid orders: the order then becomes an in-house delivery, with no fee and no platform pay.
 * @returns {{ok: boolean, message: string, orderId?: string}}
 */
async function appendPoolOrder(driverId, orderId) {
  return db.withTransaction(async (client) => {
    const driver = await lockDriver(client, driverId);
    const inHouse = driver.driver_type === 'restaurant_own';
    if (!isApproved(driver.status)) {
      throw new AppError(403, 'DRIVER_NOT_APPROVED', 'Only approved drivers can take pool orders.');
    }
    const config = await pricing.getConfig(client);
    const room = await driverRoom(client, driver, config);
    if (room.reason === 'offline') return { ok: false, message: 'Go online to take orders.' };
    if (room.reason === 'full') {
      return {
        ok: false,
        message: `You already have ${room.activeOrders} of ${room.maxOrders} orders. Deliver one to take another.`,
      };
    }
    if (room.reason === 'no_location') {
      return { ok: false, message: 'Turn on location so we can match you with orders near you.' };
    }

    // If another driver is taking the same order this waits for them to finish, then checks
    // again: the first to commit gets it, the other is told it has been taken.
    const { rows } = await client.query(
      `SELECT o.id, o.distance_miles, o.hybrid, o.restaurant_id, r.latitude, r.longitude
         FROM orders o JOIN restaurants r ON r.id = o.restaurant_id
        WHERE o.id = $1 AND o.batch_id IS NULL AND o.dispatch_type = 'open_platform'
          AND o.status IN ('preparing', 'ready_for_pickup')
        FOR UPDATE OF o`,
      [orderId]
    );
    const order = rows[0];
    if (!order) return { ok: false, message: 'That order has just been taken.' };
    if (inHouse && !(order.hybrid && order.restaurant_id === driver.employer_restaurant_id)) {
      return { ok: false, message: 'This order is only for platform drivers.' };
    }
    const declined = await client.query(
      `SELECT 1 FROM batch_declines WHERE driver_id = $1 AND order_id = $2
          AND created_at > now() - make_interval(mins => $3)`,
      [driverId, orderId, REOFFER_AFTER_MINUTES]
    );
    if (declined.rows[0]) return { ok: false, message: 'This order has been given to another driver.' };
    if (!inHouse && !withinReach(room.here, order, config)) {
      return { ok: false, message: 'This order is too far from where you are now.' };
    }

    let batch = await openBatch(client, driverId, { lock: true });
    if (!batch) {
      await acknowledgeCompleted(driverId, client);
      batch = (
        await client.query(
          `INSERT INTO batches (driver_id, status, accepted_at) VALUES ($1, 'accepted', now()) RETURNING *`,
          [driverId]
        )
      ).rows[0];
    }
    const count = await fileDeliveredOrders(client, batch, await countOrders(client, batch.id));

    const position = count + 1;
    const dispatchType = inHouse ? 'own_driver' : 'open_platform';
    const fin = pricing.calculateOrderFinancials(config, Number(order.distance_miles), position, dispatchType);
    await client.query(
      `UPDATE orders SET batch_id = $1, batch_position = $2, assigned_driver_id = $3, status = $4,
              restaurant_fee_gbp = $5, driver_payout_gbp = $6, dispatch_type = $8
        WHERE id = $7`,
      [
        batch.id,
        position,
        driverId,
        batch.status === 'accepted' ? 'driver_assigned' : 'batched_offered',
        fin.restaurantFeeGbp,
        fin.driverPayoutGbp,
        order.id,
        dispatchType,
      ]
    );
    return {
      ok: true,
      message: position === 1 ? 'Order accepted. Head to the restaurant.' : `Added as Order #${position} in your run.`,
      orderId: order.id,
      accepted: batch.status === 'accepted',
    };
  });
}

/**
 * A restaurant gives an order to one of its own drivers. There is no offer to
 * accept: the order joins the driver's current run, or starts a new one.
 * Must be called inside the transaction that created the order.
 */
async function assignToOwnDriver(client, orderId, driverId) {
  await lockDriver(client, driverId);
  // The admin's max orders per run applies to in-house drivers too.
  const config = await pricing.getConfig(client);
  const active = await activeOrderCount(client, driverId);
  if (active >= config.maxBatchSize) {
    const message = `This driver already has ${active} of ${config.maxBatchSize} orders on the way. Choose another driver, or wait until they deliver one.`;
    throw new AppError(409, 'DRIVER_FULL', message, [{ field: 'ownDriverId', message }]);
  }
  const { rows } = await client.query(
    `SELECT b.*, (SELECT count(*) FROM orders o WHERE o.batch_id = b.id)::int AS order_count
       FROM batches b
      WHERE b.driver_id = $1 AND b.status IN ('offered', 'accepted')
      ORDER BY b.created_at ASC
      FOR UPDATE OF b`,
    [driverId]
  );
  // Join the first run that has not started its drop-offs yet.
  let batch = rows.find((b) => b.status === 'offered' || b.active_stop_index <= b.order_count);
  let position;
  if (batch) {
    position = batch.order_count + 1;
  } else {
    batch = (
      await client.query(
        `INSERT INTO batches (driver_id, status, accepted_at) VALUES ($1, 'accepted', now()) RETURNING *`,
        [driverId]
      )
    ).rows[0];
    position = 1;
  }
  await client.query(
    `UPDATE orders SET batch_id = $1, batch_position = $2, assigned_driver_id = $3, status = 'driver_assigned'
      WHERE id = $4`,
    [batch.id, position, driverId, orderId]
  );
}

/**
 * Takes an order out of its driver's run: the orders left behind move up a place and are
 * re-priced for their new position. A run left empty is closed.
 * `allowCollected` (admin only) also takes out an order the driver has already picked up.
 * Locks the run first, then its orders (the same order as accept / decline / advance).
 * @returns {Promise<{order: object, driverUserId: string|null}>} the order row as it was, locked
 */
async function detachFromBatch(client, orderId, { restaurantId, allowCollected = false } = {}) {
  for (let attempt = 0; attempt < 3; attempt++) {
    const peek = await client.query('SELECT batch_id FROM orders WHERE id = $1', [orderId]);
    if (!peek.rows[0]) break;
    const batchId = peek.rows[0].batch_id;
    const batch = batchId
      ? (await client.query('SELECT * FROM batches WHERE id = $1 FOR UPDATE', [batchId])).rows[0]
      : null;
    const { rows } = await client.query(
      `SELECT o.*, d.user_id AS driver_user_id FROM orders o
         LEFT JOIN driver_profiles d ON d.id = o.assigned_driver_id
        WHERE o.id = $1 FOR UPDATE OF o`,
      [orderId]
    );
    const order = rows[0];
    if (!order) break;
    if (order.batch_id !== batchId) continue; // it moved while we were locking: look again
    if (restaurantId && order.restaurant_id !== restaurantId) break;
    if (order.status === 'delivered') {
      throw new AppError(409, 'ORDER_DELIVERED', 'This order has already been delivered.');
    }
    if (order.status === 'cancelled') {
      throw new AppError(409, 'ORDER_CANCELLED', 'This order has already been cancelled.');
    }
    if (order.status === 'picked_up' && !allowCollected) {
      throw new AppError(
        409,
        'ORDER_COLLECTED',
        'The driver has already collected this order. Message the driver, or contact In Tha Route support.'
      );
    }

    if (batch && ['offered', 'accepted'].includes(batch.status)) {
      await client.query('UPDATE orders SET batch_id = NULL WHERE id = $1', [orderId]);
      const config = await pricing.getConfig(client);
      const { rows: rest } = await client.query(
        `SELECT id, distance_miles, dispatch_type FROM orders WHERE batch_id = $1
          ORDER BY batch_position ASC, created_at ASC FOR UPDATE`,
        [batch.id]
      );
      for (let i = 0; i < rest.length; i++) {
        const fin = pricing.calculateOrderFinancials(config, Number(rest[i].distance_miles), i + 1, rest[i].dispatch_type);
        await client.query(
          'UPDATE orders SET batch_position = $1, restaurant_fee_gbp = $2, driver_payout_gbp = $3 WHERE id = $4',
          [i + 1, fin.restaurantFeeGbp, fin.driverPayoutGbp, rest[i].id]
        );
      }
      // Stops run: every pickup in order, then every drop-off in order. Taking out an order
      // that is not collected yet removes two stops still ahead, so the current stop stays.
      // A collected order's pickup is already behind the driver (its drop-off is still ahead),
      // so the current stop moves back by one to stay on the same place.
      const index =
        order.status === 'picked_up' && batch.status === 'accepted'
          ? Math.max(0, batch.active_stop_index - 1)
          : batch.active_stop_index;
      if (rest.length === 0) {
        await client.query(`UPDATE batches SET status = 'declined', active_stop_index = 0 WHERE id = $1`, [batch.id]);
      } else if (batch.status === 'accepted' && index >= rest.length * 2) {
        // Every order left was already delivered: the run is finished.
        await client.query(
          `UPDATE batches SET status = 'completed', completed_at = now(), active_stop_index = 0 WHERE id = $1`,
          [batch.id]
        );
      } else if (index !== batch.active_stop_index) {
        await client.query('UPDATE batches SET active_stop_index = $1 WHERE id = $2', [index, batch.id]);
      }
    }
    return { order, driverUserId: order.driver_user_id || null };
  }
  throw new AppError(404, 'ORDER_NOT_FOUND', 'Order not found.');
}

/**
 * Cancels an order. A restaurant can only cancel before the driver collects it, and is
 * then not charged. An admin can also cancel a collected order: the driver already made
 * the trip to the restaurant, so that delivery's fee and pay stay as they were.
 */
async function cancelOrder(orderId, { userId, restaurantId, reason = '', allowCollected = false }) {
  return db.withTransaction(async (client) => {
    const { order, driverUserId } = await detachFromBatch(client, orderId, { restaurantId, allowCollected });
    const collected = order.status === 'picked_up';
    await client.query(
      `UPDATE orders SET status = 'cancelled', cancelled_at = now(), cancelled_by = $2, cancel_reason = $3,
              batch_id = NULL,
              restaurant_fee_gbp = CASE WHEN $4 THEN restaurant_fee_gbp ELSE 0 END,
              driver_payout_gbp = CASE WHEN $4 THEN driver_payout_gbp ELSE 0 END
        WHERE id = $1`,
      [orderId, userId, reason, collected]
    );
    return { order, driverUserId };
  });
}

/**
 * Admin: takes an order (not yet collected) away from its driver and puts it back in the
 * open pool for the next driver. An in-house order becomes an open-platform order.
 */
async function releaseToPool(orderId) {
  return db.withTransaction(async (client) => {
    const { order, driverUserId } = await detachFromBatch(client, orderId);
    if (!order.batch_id && order.dispatch_type === 'open_platform') {
      throw new AppError(409, 'ORDER_UNASSIGNED', 'This order is already waiting for a driver.');
    }
    const config = await pricing.getConfig(client);
    const fin = pricing.calculateOrderFinancials(config, Number(order.distance_miles), 1, 'open_platform');
    await client.query(
      `UPDATE orders SET batch_id = NULL, batch_position = 1, assigned_driver_id = NULL,
              dispatch_type = 'open_platform', status = ${BACK_TO_POOL_STATUS},
              restaurant_fee_gbp = $2, driver_payout_gbp = $3, no_driver_alert_at = NULL
        WHERE id = $1`,
      [orderId, fin.restaurantFeeGbp, fin.driverPayoutGbp]
    );
    if (order.assigned_driver_id) await rememberDecline(client, order.assigned_driver_id, orderId);
    return { order, driverUserId };
  });
}

module.exports = {
  releaseOffer,
  cancelOrder,
  releaseToPool,
  ACTIVE_STATUSES,
  REOFFER_AFTER_MINUTES,
  currentBatch,
  countOrders,
  activeOrderCount,
  driverRoom,
  withinReach,
  notifyNearbyDrivers,
  expireStaleOffers,
  accept,
  decline,
  advance,
  acknowledgeCompleted,
  appendPoolOrder,
  assignToOwnDriver,
};
