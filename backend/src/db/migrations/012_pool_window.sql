-- An order in the open pool stays there for a limited time (2 minutes by default). When the
-- window runs out and nobody has taken it, the order leaves the pool and the merchant is asked
-- what to do. Each time an order (re)enters the pool the window starts again.
ALTER TABLE orders ADD COLUMN pool_expires_at timestamptz;

-- Orders waiting in the pool when this is applied get a fresh window.
UPDATE orders
   SET pool_expires_at = now() + interval '2 minutes'
 WHERE dispatch_type = 'open_platform' AND batch_id IS NULL
   AND status IN ('preparing', 'ready_for_pickup');
