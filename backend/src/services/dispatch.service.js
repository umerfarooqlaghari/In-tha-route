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
 *   offered  -> accepted -> completed        (platform driver accepts an offer)
 *   offered  -> declined                     (orders go back to the pool)
 *   accepted -> completed                    (in-house driver: assigned directly)
 */
const REOFFER_AFTER_MINUTES = 10; // a declined order is not offered to the same driver again this soon
// An offer nobody answers is withdrawn after this long and goes to another driver.
const OFFER_TIMEOUT_SECONDS =
  Number(process.env.OFFER_TIMEOUT_SECONDS) > 0 ? Number(process.env.OFFER_TIMEOUT_SECONDS) : 120;

// How far (straight line) a driver may be from the first pickup of an offer.
const OFFER_RADIUS_MILES =
  Number(process.env.DRIVER_OFFER_RADIUS_MILES) > 0 ? Number(process.env.DRIVER_OFFER_RADIUS_MILES) : 3;

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

/**
 * Builds the next offer for an online platform driver from the open pool:
 * start with the order that is ready soonest, then add orders that
 *  - are collected from the same restaurant or one within the pickup radius, and
 *  - are ready within the prep-time window of the first order,
 * up to the maximum batch size. Does nothing if the driver already has a batch.
 */
async function offerNextBatch(driverId) {
  return db.withTransaction(async (client) => {
    const driver = await lockDriver(client, driverId);
    if (driver.driver_type !== 'platform_contracted' || driver.status !== 'approved_online') return null;
    if (await currentBatch(client, driverId)) return null;

    const config = await pricing.getConfig(client);
    const { rows: candidates } = await client.query(
      `SELECT o.id, o.restaurant_id, o.ready_at, o.distance_miles
         FROM orders o
        WHERE o.batch_id IS NULL
          AND o.dispatch_type = 'open_platform'
          AND o.status IN ('preparing', 'ready_for_pickup')
          AND NOT EXISTS (
                SELECT 1 FROM batch_declines x
                 WHERE x.driver_id = $1 AND x.order_id = o.id
                   AND x.created_at > now() - make_interval(mins => $2))
        ORDER BY o.ready_at ASC, o.created_at ASC
        LIMIT 50
        FOR UPDATE OF o SKIP LOCKED`,
      [driverId, REOFFER_AFTER_MINUTES]
    );
    if (candidates.length === 0) return null;

    const restaurantIds = [...new Set(candidates.map((c) => c.restaurant_id))];
    const coords = new Map(
      (
        await client.query('SELECT id, latitude, longitude FROM restaurants WHERE id = ANY($1::uuid[])', [restaurantIds])
      ).rows.map((r) => [r.id, r.latitude != null ? { latitude: r.latitude, longitude: r.longitude } : null])
    );

    // With a recent GPS fix, only offer pickups within reach of the driver.
    // Without one (location off or not sent yet) every open order is considered.
    const here = freshLocation(driver);
    const reachable = here
      ? candidates.filter((c) => {
          const pickup = coords.get(c.restaurant_id);
          return !pickup || geo.straightLineMiles(here, pickup) <= OFFER_RADIUS_MILES;
        })
      : candidates;
    if (reachable.length === 0) return null;

    const first = reachable[0];
    const group = [first];
    const windowMs = config.maxPrepTimeWindowMinutes * 60000;
    for (const c of reachable.slice(1)) {
      if (group.length >= config.maxBatchSize) break;
      if (Math.abs(c.ready_at - first.ready_at) > windowMs) continue;
      if (c.restaurant_id !== first.restaurant_id) {
        const a = coords.get(first.restaurant_id);
        const b = coords.get(c.restaurant_id);
        if (!a || !b || geo.straightLineMiles(a, b) > config.maxPickupRadiusMiles) continue;
      }
      group.push(c);
    }

    const batch = (
      await client.query(`INSERT INTO batches (driver_id, status) VALUES ($1, 'offered') RETURNING *`, [driverId])
    ).rows[0];
    for (let i = 0; i < group.length; i++) {
      const fin = pricing.calculateOrderFinancials(config, Number(group[i].distance_miles), i + 1, 'open_platform');
      await client.query(
        `UPDATE orders SET batch_id = $1, batch_position = $2, assigned_driver_id = $3,
                status = 'batched_offered', restaurant_fee_gbp = $4, driver_payout_gbp = $5
          WHERE id = $6`,
        [batch.id, i + 1, driverId, fin.restaurantFeeGbp, fin.driverPayoutGbp, group[i].id]
      );
    }
    return batch;
  });
}

/**
 * Offers open orders to online platform drivers who have nothing to do, most recently
 * located first, and sends each new offer as a push notification. Called when an order
 * is posted or released, so drivers do not have to keep the app open to get offers.
 * @returns {Promise<string[]>} ids of the batches offered
 */
async function offerOpenOrders(limit = 20) {
  const push = require('./push.service');
  const { rows } = await db.query(
    `SELECT d.id FROM driver_profiles d
      WHERE d.driver_type = 'platform_contracted' AND d.status = 'approved_online'
        AND NOT EXISTS (
              SELECT 1 FROM batches b
               WHERE b.driver_id = d.id
                 AND (b.status IN ('offered', 'accepted') OR (b.status = 'completed' AND NOT b.acknowledged)))
      ORDER BY d.last_location_at DESC NULLS LAST
      LIMIT $1`,
    [limit]
  );
  const offered = [];
  for (const { id } of rows) {
    const batch = await offerNextBatch(id).catch((err) => {
      console.error('Offer failed:', err.message);
      return null;
    });
    if (batch) {
      offered.push(batch.id);
      await push.batchOffered(batch.id);
    }
  }
  return offered;
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

/** The driver went offline: an offer they have not accepted goes to someone else straight away. */
async function releaseOffer(driverId) {
  try {
    await decline(driverId, { remember: false });
    return true;
  } catch (err) {
    if (err.code === 'NO_OFFER') return false;
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
 * A platform driver adds an order from the pool to their route.
 * @returns {{ok: boolean, message: string}}
 */
async function appendPoolOrder(driverId, orderId) {
  return db.withTransaction(async (client) => {
    const driver = await lockDriver(client, driverId);
    if (driver.driver_type !== 'platform_contracted' || !isApproved(driver.status)) {
      throw new AppError(403, 'DRIVER_NOT_APPROVED', 'Only approved platform drivers can take pool orders.');
    }
    const config = await pricing.getConfig(client);

    const { rows } = await client.query(
      `SELECT id, distance_miles FROM orders
        WHERE id = $1 AND batch_id IS NULL AND dispatch_type = 'open_platform'
          AND status IN ('preparing', 'ready_for_pickup')
        FOR UPDATE`,
      [orderId]
    );
    // If another driver (or an offer being built) holds the order, this waits for them to
    // finish and then checks again: the first to commit gets it, the other is told it's taken.
    const order = rows[0];
    if (!order) return { ok: false, message: 'That order has just been taken.' };

    let batch = await openBatch(client, driverId, { lock: true });
    if (!batch) {
      // The driver picked this order themselves, so there is no offer to accept.
      await acknowledgeCompleted(driverId, client);
      batch = (
        await client.query(
          `INSERT INTO batches (driver_id, status, accepted_at) VALUES ($1, 'accepted', now()) RETURNING *`,
          [driverId]
        )
      ).rows[0];
    }

    const count = await countOrders(client, batch.id);
    if (count >= config.maxBatchSize) {
      return { ok: false, message: `Maximum batch limit of ${config.maxBatchSize} orders reached.` };
    }
    // Once a drop-off has been completed, a new pickup can no longer be slotted in.
    if (batch.status === 'accepted' && batch.active_stop_index > count) {
      return { ok: false, message: 'Finish your current drop-offs before adding more orders.' };
    }

    const position = count + 1;
    const fin = pricing.calculateOrderFinancials(config, Number(order.distance_miles), position, 'open_platform');
    await client.query(
      `UPDATE orders SET batch_id = $1, batch_position = $2, assigned_driver_id = $3, status = $4,
              restaurant_fee_gbp = $5, driver_payout_gbp = $6
        WHERE id = $7`,
      [
        batch.id,
        position,
        driverId,
        batch.status === 'accepted' ? 'driver_assigned' : 'batched_offered',
        fin.restaurantFeeGbp,
        fin.driverPayoutGbp,
        order.id,
      ]
    );
    return {
      ok: true,
      message: `Added as Order #${position} in your active batch.`,
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
  currentBatch,
  countOrders,
  offerNextBatch,
  offerOpenOrders,
  expireStaleOffers,
  accept,
  decline,
  advance,
  acknowledgeCompleted,
  appendPoolOrder,
  assignToOwnDriver,
};
