-- The admin can switch the driver radius off: then every platform driver sees every open
-- order, however far away they are and with or without location. In-house drivers still see
-- only their own restaurant's orders.
ALTER TABLE pricing_config
  ADD COLUMN no_distance_limit boolean NOT NULL DEFAULT false;
