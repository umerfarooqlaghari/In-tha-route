const db = require('../config/db');
const AppError = require('../utils/AppError');
const geo = require('./geo.service');
const pricing = require('./pricing.service');

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

    const first = candidates[0];
    const group = [first];
    const windowMs = config.maxPrepTimeWindowMinutes * 60000;
    for (const c of candidates.slice(1)) {
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

async function accept(driverId) {
  return db.withTransaction(async (client) => {
    const batch = await openBatch(client, driverId, { lock: true });
    if (!batch || batch.status !== 'offered') {
      throw new AppError(409, 'NO_OFFER', 'This offer is no longer available.');
    }
    await client.query(
      `UPDATE batches SET status = 'accepted', accepted_at = now(), active_stop_index = 0 WHERE id = $1`,
      [batch.id]
    );
    await client.query(`UPDATE orders SET status = 'driver_assigned' WHERE batch_id = $1`, [batch.id]);
  });
}

/** Declining releases every order back to the pool at single-order prices. */
async function decline(driverId) {
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
                status = 'preparing', restaurant_fee_gbp = $1, driver_payout_gbp = $2
          WHERE id = $3`,
        [fin.restaurantFeeGbp, fin.driverPayoutGbp, o.id]
      );
      await client.query(
        `INSERT INTO batch_declines (driver_id, order_id) VALUES ($1, $2)
         ON CONFLICT (driver_id, order_id) DO UPDATE SET created_at = now()`,
        [driverId, o.id]
      );
    }
    await client.query(`UPDATE batches SET status = 'declined' WHERE id = $1`, [batch.id]);
  });
}

/**
 * Completes the current stop ("Picked up" / "Delivered") and moves to the next.
 * Completing the last drop-off completes the batch.
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
        FOR UPDATE SKIP LOCKED`,
      [orderId]
    );
    const order = rows[0];
    if (!order) return { ok: false, message: 'That order has just been taken.' };

    let batch = await openBatch(client, driverId, { lock: true });
    if (!batch) {
      await acknowledgeCompleted(driverId, client);
      batch = (
        await client.query(`INSERT INTO batches (driver_id, status) VALUES ($1, 'offered') RETURNING *`, [driverId])
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
    return { ok: true, message: `Added as Order #${position} in your active batch.` };
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

module.exports = {
  currentBatch,
  countOrders,
  offerNextBatch,
  accept,
  decline,
  advance,
  acknowledgeCompleted,
  appendPoolOrder,
  assignToOwnDriver,
};
