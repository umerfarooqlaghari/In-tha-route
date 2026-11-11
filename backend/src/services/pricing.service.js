const db = require('../config/db');

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
  };
}

async function getConfig(client = db) {
  const { rows } = await client.query('SELECT * FROM pricing_config WHERE id = 1');
  return toConfig(rows[0]);
}

/**
 * What one order costs the restaurant and pays the driver.
 * This is the same formula the mobile app used locally, moved to the server:
 *  - own-driver orders carry no platform fee or payout;
 *  - the restaurant pays the base charge plus a per-mile surcharge beyond the base distance;
 *  - the driver is paid by the order's position in the batch, plus a per-mile surcharge.
 */
function calculateOrderFinancials(config, distanceMiles, batchPosition, dispatchType) {
  if (dispatchType === 'own_driver') {
    return { restaurantFeeGbp: 0, driverPayoutGbp: 0, platformMarginGbp: 0 };
  }
  const extraMiles = Math.max(0, distanceMiles - config.baseDistanceMiles);
  const restaurantFeeGbp = round2(
    config.baseRestaurantChargeGbp + extraMiles * config.extraMileRestaurantChargeGbp
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
      ]
    );

    const live = await client.query(
      `SELECT id, distance_miles, batch_position FROM orders
        WHERE status NOT IN ('delivered', 'cancelled') AND dispatch_type = 'open_platform' FOR UPDATE`
    );
    for (const o of live.rows) {
      const fin = calculateOrderFinancials(next, Number(o.distance_miles), o.batch_position, 'open_platform');
      await client.query(
        'UPDATE orders SET restaurant_fee_gbp = $1, driver_payout_gbp = $2 WHERE id = $3',
        [fin.restaurantFeeGbp, fin.driverPayoutGbp, o.id]
      );
    }
    return next;
  });
}

module.exports = { getConfig, calculateOrderFinancials, buildSummary, updateConfig, round2 };
