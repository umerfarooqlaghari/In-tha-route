const db = require('../config/db');
const { TZ } = require('../utils/labels');

const round2 = (n) => Math.round(Number(n || 0) * 100) / 100;
const round1 = (n) => (n == null ? null : Math.round(Number(n) * 10) / 10);

/**
 * A merchant's numbers for the last `days` days (UK days, today included), with the
 * period before it for comparison. Sales and fees count delivered orders only.
 */
async function forRestaurant(restaurantId, days) {
  // First instant of the period and of the period before it, in UK time.
  const bounds = await db.query(
    `SELECT (date_trunc('day', now() AT TIME ZONE $1) - make_interval(days => $2 - 1)) AT TIME ZONE $1 AS start,
            (date_trunc('day', now() AT TIME ZONE $1) - make_interval(days => 2 * $2 - 1)) AT TIME ZONE $1 AS prev_start`,
    [TZ, days]
  );
  const { start, prev_start: prevStart } = bounds.rows[0];
  const args = [restaurantId, start];

  const [summary, previous, daily, hours, drivers, items] = await Promise.all([
    db.query(
      `SELECT count(*) FILTER (WHERE status = 'delivered')::int AS delivered,
              count(*) FILTER (WHERE status = 'cancelled')::int AS cancelled,
              count(*) FILTER (WHERE status NOT IN ('delivered', 'cancelled'))::int AS active,
              coalesce(sum(order_total_gbp) FILTER (WHERE status = 'delivered'), 0) AS sales,
              coalesce(sum(restaurant_fee_gbp) FILTER (WHERE status = 'delivered'), 0) AS fees,
              avg(extract(epoch FROM delivered_at - picked_up_at) / 60)
                FILTER (WHERE status = 'delivered' AND picked_up_at IS NOT NULL) AS delivery_minutes,
              avg(extract(epoch FROM delivered_at - created_at) / 60) FILTER (WHERE status = 'delivered') AS total_minutes,
              avg(prep_minutes) FILTER (WHERE status = 'delivered') AS prep_minutes
         FROM orders WHERE restaurant_id = $1 AND created_at >= $2`,
      args
    ),
    db.query(
      `SELECT count(*) FILTER (WHERE status = 'delivered')::int AS delivered,
              coalesce(sum(order_total_gbp) FILTER (WHERE status = 'delivered'), 0) AS sales
         FROM orders WHERE restaurant_id = $1 AND created_at >= $2 AND created_at < $3`,
      [restaurantId, prevStart, start]
    ),
    db.query(
      `SELECT to_char(d.day, 'YYYY-MM-DD') AS date, to_char(d.day, 'Dy') AS weekday,
              count(o.id)::int AS orders, coalesce(sum(o.order_total_gbp), 0) AS sales
         FROM generate_series(($2::timestamptz AT TIME ZONE $3)::date, (now() AT TIME ZONE $3)::date, '1 day') AS d(day)
         LEFT JOIN orders o
           ON o.restaurant_id = $1 AND o.status = 'delivered' AND o.created_at >= $2
          AND (o.created_at AT TIME ZONE $3)::date = d.day
        GROUP BY d.day ORDER BY d.day`,
      [...args, TZ]
    ),
    db.query(
      `SELECT extract(hour FROM created_at AT TIME ZONE $3)::int AS hour, count(*)::int AS orders
         FROM orders WHERE restaurant_id = $1 AND created_at >= $2 AND status = 'delivered'
        GROUP BY 1`,
      [...args, TZ]
    ),
    db.query(
      `SELECT count(*) FILTER (WHERE d.driver_type = 'restaurant_own')::int AS own,
              count(*) FILTER (WHERE d.driver_type IS DISTINCT FROM 'restaurant_own')::int AS platform
         FROM orders o LEFT JOIN driver_profiles d ON d.id = o.assigned_driver_id
        WHERE o.restaurant_id = $1 AND o.created_at >= $2 AND o.status = 'delivered'`,
      args
    ),
    db.query(
      `SELECT trim(i->>'name') AS name,
              sum(CASE WHEN (i->>'quantity') ~ '^[0-9]+$' THEN (i->>'quantity')::int ELSE 1 END)::int AS quantity
         FROM orders o, jsonb_array_elements(CASE WHEN jsonb_typeof(o.items) = 'array' THEN o.items ELSE '[]'::jsonb END) AS i
        WHERE o.restaurant_id = $1 AND o.created_at >= $2 AND o.status = 'delivered'
          AND coalesce(trim(i->>'name'), '') <> ''
        GROUP BY 1 ORDER BY 2 DESC, 1 LIMIT 5`,
      args
    ),
  ]);

  const s = summary.rows[0];
  const p = previous.rows[0];
  const finished = s.delivered + s.cancelled;
  const byHour = Array.from({ length: 24 }, (_, hour) => ({ hour, orders: 0 }));
  hours.rows.forEach((h) => (byHour[h.hour].orders = h.orders));

  return {
    days,
    summary: {
      orders: s.delivered,
      salesGbp: round2(s.sales),
      feesGbp: round2(s.fees),
      averageOrderGbp: s.delivered ? round2(s.sales / s.delivered) : 0,
      cancelled: s.cancelled,
      active: s.active,
      // Share of finished orders that were delivered (not cancelled).
      completionRate: finished ? Math.round((s.delivered / finished) * 100) : null,
      deliveryMinutes: round1(s.delivery_minutes),
      totalMinutes: round1(s.total_minutes),
      prepMinutes: round1(s.prep_minutes),
    },
    previous: { orders: p.delivered, salesGbp: round2(p.sales) },
    daily: daily.rows.map((d) => ({ date: d.date, weekday: d.weekday, orders: d.orders, salesGbp: round2(d.sales) })),
    hours: byHour,
    drivers: drivers.rows[0],
    topItems: items.rows,
  };
}

module.exports = { forRestaurant };
