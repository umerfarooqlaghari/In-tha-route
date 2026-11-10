-- Phases 2-4: restaurant, driver and admin operations

-- Pricing and batching rules (single row, edited by the admin) ----------------
CREATE TABLE pricing_config (
  id                                smallint PRIMARY KEY DEFAULT 1 CHECK (id = 1),
  base_distance_miles               numeric(6,2) NOT NULL DEFAULT 2.0,
  base_restaurant_charge_gbp        numeric(8,2) NOT NULL DEFAULT 5.0,
  extra_mile_restaurant_charge_gbp  numeric(8,2) NOT NULL DEFAULT 1.25,
  extra_mile_driver_payout_gbp      numeric(8,2) NOT NULL DEFAULT 0.9,
  max_batch_size                    integer NOT NULL DEFAULT 5,
  stepped_driver_payouts_gbp        numeric(8,2)[] NOT NULL
                                    DEFAULT '{4.0,3.2,2.8,2.5,2.2,2.0,1.9,1.8}',
  max_prep_time_window_minutes      integer NOT NULL DEFAULT 15,
  max_pickup_radius_miles           numeric(6,2) NOT NULL DEFAULT 0.8,
  updated_by                        uuid REFERENCES users (id) ON DELETE SET NULL,
  updated_at                        timestamptz NOT NULL DEFAULT now()
);
INSERT INTO pricing_config DEFAULT VALUES;

-- Restaurants: coordinates for distance and maps ------------------------------
ALTER TABLE restaurants
  ADD COLUMN latitude double precision,
  ADD COLUMN longitude double precision;

-- Drivers ---------------------------------------------------------------------
ALTER TABLE driver_profiles DROP CONSTRAINT driver_profiles_status_check;
ALTER TABLE driver_profiles
  ADD CONSTRAINT driver_profiles_status_check
  CHECK (status IN ('pending_kyc', 'approved_online', 'offline', 'rejected'));
ALTER TABLE driver_profiles
  ADD COLUMN rating numeric(3,2) NOT NULL DEFAULT 5.0,
  ADD COLUMN completed_deliveries integer NOT NULL DEFAULT 0;

CREATE TABLE driver_online_sessions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id   uuid NOT NULL REFERENCES driver_profiles (id) ON DELETE CASCADE,
  started_at  timestamptz NOT NULL DEFAULT now(),
  ended_at    timestamptz
);
CREATE INDEX driver_online_sessions_driver_idx ON driver_online_sessions (driver_id, started_at);

-- Uploaded files (KYC photos). Stored in the database until object storage is configured.
CREATE TABLE files (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id  uuid REFERENCES users (id) ON DELETE CASCADE,
  mime_type      text NOT NULL,
  size_bytes     integer NOT NULL,
  data           bytea NOT NULL,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE kyc_documents (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id    uuid NOT NULL REFERENCES driver_profiles (id) ON DELETE CASCADE,
  doc_type     text NOT NULL CHECK (doc_type IN
               ('driving_licence', 'ni_number', 'bank_account', 'vehicle_insurance', 'identity')),
  status       text NOT NULL DEFAULT 'missing' CHECK (status IN ('verified', 'pending', 'missing')),
  file_id      uuid REFERENCES files (id) ON DELETE SET NULL,
  note         text,
  reviewed_by  uuid REFERENCES users (id) ON DELETE SET NULL,
  updated_at   timestamptz NOT NULL DEFAULT now(),
  UNIQUE (driver_id, doc_type)
);

-- Platform drivers who registered in Phase 1 get their document slots.
INSERT INTO kyc_documents (driver_id, doc_type)
SELECT d.id, t.doc_type
  FROM driver_profiles d
 CROSS JOIN (VALUES ('driving_licence'), ('ni_number'), ('bank_account'),
                    ('vehicle_insurance'), ('identity')) AS t (doc_type)
 WHERE d.driver_type = 'platform_contracted';

-- Batches (a driver's run of one or more orders) ------------------------------
CREATE TABLE batches (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  driver_id          uuid NOT NULL REFERENCES driver_profiles (id) ON DELETE CASCADE,
  status             text NOT NULL DEFAULT 'offered'
                     CHECK (status IN ('offered', 'accepted', 'declined', 'completed')),
  active_stop_index  integer NOT NULL DEFAULT 0,
  acknowledged       boolean NOT NULL DEFAULT false,
  created_at         timestamptz NOT NULL DEFAULT now(),
  accepted_at        timestamptz,
  completed_at       timestamptz
);
CREATE INDEX batches_driver_idx ON batches (driver_id, status);

-- Orders ----------------------------------------------------------------------
CREATE TABLE orders (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id           uuid NOT NULL REFERENCES restaurants (id) ON DELETE CASCADE,
  source                  text NOT NULL,
  external_order_id       text NOT NULL DEFAULT '',
  customer_name           text NOT NULL DEFAULT '',
  customer_phone          text NOT NULL DEFAULT '',
  phone_access_code       text,
  direct_customer_phone   text,
  delivery_address        text NOT NULL,
  postcode                text NOT NULL,
  delivery_instructions   text NOT NULL DEFAULT '',
  restaurant_pickup_note  text NOT NULL DEFAULT '',
  distance_miles          numeric(6,2) NOT NULL DEFAULT 0,
  dropoff_latitude        double precision,
  dropoff_longitude       double precision,
  prep_minutes            integer NOT NULL,
  ready_at                timestamptz NOT NULL,
  order_total_gbp         numeric(10,2) NOT NULL DEFAULT 0,
  items                   jsonb NOT NULL DEFAULT '[]',
  dispatch_type           text NOT NULL CHECK (dispatch_type IN ('open_platform', 'own_driver')),
  status                  text NOT NULL DEFAULT 'preparing' CHECK (status IN
                          ('preparing', 'ready_for_pickup', 'batched_offered',
                           'driver_assigned', 'picked_up', 'delivered')),
  assigned_driver_id      uuid REFERENCES driver_profiles (id) ON DELETE SET NULL,
  batch_id                uuid REFERENCES batches (id) ON DELETE SET NULL,
  batch_position          integer NOT NULL DEFAULT 1,
  restaurant_fee_gbp      numeric(8,2) NOT NULL DEFAULT 0,
  driver_payout_gbp       numeric(8,2) NOT NULL DEFAULT 0,
  created_by              uuid REFERENCES users (id) ON DELETE SET NULL,
  created_at              timestamptz NOT NULL DEFAULT now(),
  picked_up_at            timestamptz,
  delivered_at            timestamptz
);
CREATE INDEX orders_restaurant_idx ON orders (restaurant_id, status);
CREATE INDEX orders_batch_idx ON orders (batch_id);
CREATE INDEX orders_driver_idx ON orders (assigned_driver_id, delivered_at);
CREATE INDEX orders_open_pool_idx ON orders (ready_at)
  WHERE batch_id IS NULL AND dispatch_type = 'open_platform';

-- Orders a driver turned down, so they are not offered straight back to them.
CREATE TABLE batch_declines (
  driver_id   uuid NOT NULL REFERENCES driver_profiles (id) ON DELETE CASCADE,
  order_id    uuid NOT NULL REFERENCES orders (id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (driver_id, order_id)
);
