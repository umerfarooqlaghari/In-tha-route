-- Which pool window the merchant was last told about ("no drivers available"), so each
-- window that runs out is reported once.
ALTER TABLE orders
  ADD COLUMN pool_expiry_alerted_at timestamptz;
