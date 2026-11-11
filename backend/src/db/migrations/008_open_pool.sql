-- Open pool: every platform driver within this distance of the restaurant, with room in
-- their run, sees a new order at once; the first to accept gets it. Edited by the admin.
ALTER TABLE pricing_config
  ADD COLUMN offer_radius_miles numeric(6,2) NOT NULL DEFAULT 3.0;

-- Counting a driver's orders still on the way (the max-orders limit).
CREATE INDEX orders_active_driver_idx ON orders (assigned_driver_id)
  WHERE status IN ('batched_offered', 'driver_assigned', 'picked_up');
