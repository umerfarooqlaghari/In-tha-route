-- Last known GPS position, sent by the driver app while it is open.
ALTER TABLE driver_profiles
  ADD COLUMN last_latitude    double precision,
  ADD COLUMN last_longitude   double precision,
  ADD COLUMN last_location_at timestamptz;
