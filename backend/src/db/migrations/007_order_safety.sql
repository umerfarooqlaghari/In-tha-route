-- Cancelled orders, and alerts for orders that need someone's attention.
ALTER TABLE orders DROP CONSTRAINT orders_status_check;
ALTER TABLE orders
  ADD CONSTRAINT orders_status_check CHECK (status IN
    ('preparing', 'ready_for_pickup', 'batched_offered', 'driver_assigned', 'picked_up', 'delivered', 'cancelled'));

ALTER TABLE orders
  ADD COLUMN cancelled_at        timestamptz,
  ADD COLUMN cancelled_by        uuid REFERENCES users (id) ON DELETE SET NULL,
  ADD COLUMN cancel_reason       text NOT NULL DEFAULT '',
  -- When the restaurant/admin were told nobody has taken the order yet.
  ADD COLUMN no_driver_alert_at  timestamptz,
  -- When they were told a collected order has still not been delivered.
  ADD COLUMN late_alert_at       timestamptz;

-- Finding the same receipt posted twice (same restaurant, source and order number).
CREATE INDEX orders_external_ref_idx ON orders (restaurant_id, source, external_order_id)
  WHERE external_order_id <> '';
