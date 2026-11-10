-- Phase 1: authentication and user registration

CREATE TABLE users (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email          text NOT NULL UNIQUE CHECK (email = lower(email)),
  password_hash  text NOT NULL,
  role           text NOT NULL CHECK (role IN ('restaurant', 'driver', 'admin')),
  full_name      text NOT NULL,
  phone          text,
  is_active      boolean NOT NULL DEFAULT true,
  last_login_at  timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE restaurants (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  owner_user_id       uuid NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  name                text NOT NULL,
  address             text NOT NULL,
  postcode            text NOT NULL,
  phone               text NOT NULL,
  driver_policy       text NOT NULL DEFAULT 'open_platform'
                      CHECK (driver_policy IN ('open_platform', 'own_drivers', 'hybrid')),
  pickup_safety_note  text,
  created_at          timestamptz NOT NULL DEFAULT now(),
  updated_at          timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE driver_profiles (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id                 uuid NOT NULL UNIQUE REFERENCES users (id) ON DELETE CASCADE,
  driver_type             text NOT NULL DEFAULT 'platform_contracted'
                          CHECK (driver_type IN ('platform_contracted', 'restaurant_own')),
  employer_restaurant_id  uuid REFERENCES restaurants (id) ON DELETE SET NULL,
  vehicle                 text NOT NULL
                          CHECK (vehicle IN ('Motorcycle / Scooter', 'Car', 'E-Bike')),
  plate_number            text,
  status                  text NOT NULL DEFAULT 'pending_kyc'
                          CHECK (status IN ('pending_kyc', 'approved_online', 'offline')),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  -- A platform driver has no employer.
  CHECK (driver_type <> 'platform_contracted' OR employer_restaurant_id IS NULL)
);

CREATE INDEX driver_profiles_employer_idx ON driver_profiles (employer_restaurant_id);

CREATE TABLE refresh_tokens (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token_hash  text NOT NULL UNIQUE,
  expires_at  timestamptz NOT NULL,
  revoked_at  timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);
