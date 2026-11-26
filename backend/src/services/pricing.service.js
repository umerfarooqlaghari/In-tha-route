const db = require('../config/db');
const AppError = require('../utils/AppError');

const round2 = (n) => Number(n.toFixed(2));

function toConfig(row) {
  return {
    baseDistanceMiles: Number(row.base_distance_miles),
    baseRestaurantChargeGbp: Number(row.base_restaurant_charge_gbp),
    extraMileRestaurantChargeGbp: Number(row.extra_mile_restaurant_charge_gbp),
    extraMileDriverPayoutGbp: Number(row.extra_mile_driver_payout_gbp),
    maxBatchSize: row.max_batch_size,
    steppedDriverPayoutsGbp: row.stepped_driver_payouts_gbp.map(Number),
    maxPrepTimeWindowMinutes: row.max_prep_time_window_minutes,
    maxPickupRadiusMiles: Number(row.max_pickup_radius_miles),
    maxDropoffRadiusMiles: Number(row.max_dropoff_radius_miles),
    offerRadiusMiles: Number(row.offer_radius_miles),
    noDistanceLimit: row.no_distance_limit === true,
    poolWindowSeconds: row.pool_window_seconds,
  };
}

async function getConfig(client = db) {
  const { rows } = await client.query('SELECT * FROM pricing_config WHERE id = 1');
  return toConfig(rows[0]);
}

/** How long a merchant's orders stay in the open pool: its own time, or the admin's standard time. */
async function poolWindowFor(client, restaurantId) {
  const { rows } = await client.query(
    `SELECT coalesce(r.pool_window_seconds, c.pool_window_seconds) AS seconds
       FROM pricing_config c LEFT JOIN restaurants r ON r.id = $1 WHERE c.id = 1`,
    [restaurantId]
  );
  return rows[0].seconds;
}

/**
 * A pool time changed: orders waiting in the pool right now keep the moment they entered it,
 * so their end moves by the difference (a shorter time can end their window at once).
 * Only one merchant's orders, or (`standardOnly`) every merchant using the standard time.
 */
async function shiftPoolWindows(client, { bySeconds, restaurantId = null, standardOnly = false }) {
  if (!bySeconds) return;
  await client.query(
    `UPDATE orders o SET pool_expires_at = o.pool_expires_at + make_interval(secs => $1)
       FROM restaurants r
      WHERE r.id = o.restaurant_id
        AND o.batch_id IS NULL AND o.dispatch_type = 'open_platform'
        AND o.status IN ('preparing', 'ready_for_pickup') AND o.pool_expires_at > now()
        AND ($2::uuid IS NULL OR o.restaurant_id = $2)
        AND (NOT $3 OR r.pool_window_seconds IS NULL)`,
    [bySeconds, restaurantId, standardOnly]
  );
}

/** The admin can charge one merchant a different per-delivery fee; otherwise the standard fee applies. */
function feePerDelivery(config, customFeeGbp) {
  return customFeeGbp != null && customFeeGbp !== '' ? Number(customFeeGbp) : config.baseRestaurantChargeGbp;
}

/** That merchant's own per-delivery fee, or null when they pay the standard fee. */
async function customFeeOf(client, restaurantId) {
  const { rows } = await client.query('SELECT custom_fee_gbp FROM restaurants WHERE id = $1', [restaurantId]);
  return rows[0] && rows[0].custom_fee_gbp != null ? Number(rows[0].custom_fee_gbp) : null;
}

/**
 * What one order costs the restaurant and pays the driver.
 * This is the same formula the mobile app used locally, moved to the server:
 *  - own-driver orders carry no platform fee or payout;
 *  - the restaurant pays the base charge (or its own fee, if the admin set one) plus a per-mile
 *    surcharge beyond the base distance;
 *  - the driver is paid by the order's position in the batch, plus a per-mile surcharge.
 */
function calculateOrderFinancials(config, distanceMiles, batchPosition, dispatchType, customFeeGbp = null) {
  if (dispatchType === 'own_driver') {
    return { restaurantFeeGbp: 0, driverPayoutGbp: 0, platformMarginGbp: 0 };
  }
  const extraMiles = Math.max(0, distanceMiles - config.baseDistanceMiles);
  const restaurantFeeGbp = round2(
    feePerDelivery(config, customFeeGbp) + extraMiles * config.extraMileRestaurantChargeGbp
  );
  const stepIndex = Math.max(
    0,
    Math.min(batchPosition - 1, config.steppedDriverPayoutsGbp.length - 1)
  );
  const baseDriverPay = config.steppedDriverPayoutsGbp[stepIndex] ?? 2.2;
  const driverPayoutGbp = round2(baseDriverPay + extraMiles * config.extraMileDriverPayoutGbp);
  const platformMarginGbp = round2(restaurantFeeGbp - driverPayoutGbp);
  return { restaurantFeeGbp, driverPayoutGbp, platformMarginGbp };
}

/** The figures shown on the admin Pricing screen, computed here rather than in the app. */
function buildSummary(config) {
  const tiers = config.steppedDriverPayoutsGbp.slice(0, config.maxBatchSize).map((pay, i) => ({
    position: i + 1,
    driverPayGbp: pay,
    platformKeepsGbp: round2(config.baseRestaurantChargeGbp - pay),
  }));
  const simulations = [];
  for (let n = 1; n <= config.maxBatchSize; n++) {
    const restaurantsPayGbp = round2(n * config.baseRestaurantChargeGbp);
    const driverEarnsGbp = round2(
      config.steppedDriverPayoutsGbp.slice(0, n).reduce((s, v) => s + v, 0)
    );
    simulations.push({
      orders: n,
      restaurantsPayGbp,
      driverEarnsGbp,
      profitGbp: round2(restaurantsPayGbp - driverEarnsGbp),
      driverShare: restaurantsPayGbp > 0 ? Math.min(1, driverEarnsGbp / restaurantsPayGbp) : 0,
    });
  }
  return { tiers, simulations };
}

/**
 * Applies a partial change (already validated) and re-prices every order that
 * has not been delivered yet. Delivered orders keep the amounts they were completed at.
 */
async function updateConfig(partial, userId) {
  return db.withTransaction(async (client) => {
    const { rows } = await client.query('SELECT * FROM pricing_config WHERE id = 1 FOR UPDATE');
    const current = toConfig(rows[0]);
    const next = { ...current, ...partial };
    if (partial.steppedDriverPayoutsGbp) {
      // A shorter list only replaces the leading tiers.
      next.steppedDriverPayoutsGbp = current.steppedDriverPayoutsGbp.map(
        (v, i) => partial.steppedDriverPayoutsGbp[i] ?? v
      );
    }
    await client.query(
      `UPDATE pricing_config SET
         base_distance_miles = $1, base_restaurant_charge_gbp = $2,
         extra_mile_restaurant_charge_gbp = $3, extra_mile_driver_payout_gbp = $4,
         max_batch_size = $5, stepped_driver_payouts_gbp = $6,
         max_prep_time_window_minutes = $7, max_pickup_radius_miles = $8,
         offer_radius_miles = $10, no_distance_limit = $11, pool_window_seconds = $12,
         max_dropoff_radius_miles = $13,
         updated_by = $9, updated_at = now()
       WHERE id = 1`,
      [
        next.baseDistanceMiles,
        next.baseRestaurantChargeGbp,
        next.extraMileRestaurantChargeGbp,
        next.extraMileDriverPayoutGbp,
        next.maxBatchSize,
        next.steppedDriverPayoutsGbp,
        next.maxPrepTimeWindowMinutes,
        next.maxPickupRadiusMiles,
        userId,
        next.offerRadiusMiles,
        next.noDistanceLimit,
        next.poolWindowSeconds,
        next.maxDropoffRadiusMiles,
      ]
    );
    // Orders in the pool now follow the new standard time straight away.
    await shiftPoolWindows(client, { bySeconds: next.poolWindowSeconds - current.poolWindowSeconds, standardOnly: true });

    const live = await client.query(
      `SELECT o.id, o.distance_miles, o.batch_position, r.custom_fee_gbp FROM orders o
         JOIN restaurants r ON r.id = o.restaurant_id
        WHERE o.status NOT IN ('delivered', 'cancelled') AND o.dispatch_type = 'open_platform' FOR UPDATE OF o`
    );
    for (const o of live.rows) {
      const fin = calculateOrderFinancials(next, Number(o.distance_miles), o.batch_position, 'open_platform', o.custom_fee_gbp);
      await client.query(
        'UPDATE orders SET restaurant_fee_gbp = $1, driver_payout_gbp = $2 WHERE id = $3',
        [fin.restaurantFeeGbp, fin.driverPayoutGbp, o.id]
      );
    }
    return next;
  });
}

/**
 * Admin: sets (or clears, with null) one merchant's own per-delivery fee and re-prices that
 * merchant's undelivered platform orders, so their credits are counted at the new fee.
 */
async function setCustomFee(restaurantId, customFeeGbp) {
  return db.withTransaction(async (client) => {
    const { rowCount } = await client.query(
      'UPDATE restaurants SET custom_fee_gbp = $1, updated_at = now() WHERE id = $2',
      [customFeeGbp, restaurantId]
    );
    if (rowCount === 0) {
      throw new AppError(404, 'RESTAURANT_NOT_FOUND', 'Restaurant not found.');
    }
    const config = await getConfig(client);
    const live = await client.query(
      `SELECT id, distance_miles, batch_position FROM orders
        WHERE restaurant_id = $1 AND status NOT IN ('delivered', 'cancelled') AND dispatch_type = 'open_platform'
        FOR UPDATE`,
      [restaurantId]
    );
    for (const o of live.rows) {
      const fin = calculateOrderFinancials(config, Number(o.distance_miles), o.batch_position, 'open_platform', customFeeGbp);
      await client.query('UPDATE orders SET restaurant_fee_gbp = $1, driver_payout_gbp = $2 WHERE id = $3', [
        fin.restaurantFeeGbp,
        fin.driverPayoutGbp,
        o.id,
      ]);
    }
  });
}

module.exports = {
  poolWindowFor,
  shiftPoolWindows,
  getConfig,
  calculateOrderFinancials,
  feePerDelivery,
  customFeeOf,
  setCustomFee,
  buildSummary,
  updateConfig,
  round2,
};
