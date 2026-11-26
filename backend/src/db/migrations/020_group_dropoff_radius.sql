-- Pool orders are shown as one double or triple delivery when they are ready close together,
-- collected near each other, and delivered near each other. This is how near the drop-offs
-- must be (the prep-time window and pickup radius already exist).
ALTER TABLE pricing_config
  ADD COLUMN max_dropoff_radius_miles numeric(6,2) NOT NULL DEFAULT 1.5;
