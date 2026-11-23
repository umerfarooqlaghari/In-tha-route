-- How long an order stays in the open pool before it leaves it, if nobody takes it.
-- The admin sets the standard time; a merchant can set its own (NULL: the standard time).
ALTER TABLE pricing_config
  ADD COLUMN pool_window_seconds integer NOT NULL DEFAULT 120
    CHECK (pool_window_seconds BETWEEN 30 AND 1800);

ALTER TABLE restaurants
  ADD COLUMN pool_window_seconds integer
    CHECK (pool_window_seconds IS NULL OR pool_window_seconds BETWEEN 30 AND 1800);
