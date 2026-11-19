-- Merchant credits: a merchant buys credits (1 credit = £1) and each platform delivery uses
-- the fee the admin charges that merchant. A merchant out of credits cannot post a platform order.

-- The admin can charge one merchant a different per-delivery fee (NULL = the standard fee).
ALTER TABLE restaurants ADD COLUMN custom_fee_gbp numeric(8,2) CHECK (custom_fee_gbp IS NULL OR custom_fee_gbp >= 0);

-- Every change to a merchant's credits. The balance is the sum of `credits`.
--   purchase   +   paid through Stripe
--   grant      +   given by the platform (e.g. the free credits existing merchants start with)
--   adjustment +/- set by an admin by hand
--   delivery   -   a platform delivery's fee, taken once per order
CREATE TABLE credit_transactions (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id      uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  kind               text NOT NULL CHECK (kind IN ('purchase', 'grant', 'adjustment', 'delivery')),
  credits            numeric(10,2) NOT NULL,
  amount_paid_gbp    numeric(10,2),
  order_id           uuid REFERENCES orders(id) ON DELETE SET NULL,
  stripe_session_id  text UNIQUE,
  note               text NOT NULL DEFAULT '',
  created_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX credit_transactions_restaurant ON credit_transactions (restaurant_id, created_at DESC);
CREATE INDEX credit_transactions_recent ON credit_transactions (created_at DESC);
-- A delivery is charged once, however many times it is looked at.
CREATE UNIQUE INDEX credit_transactions_one_charge_per_order ON credit_transactions (order_id) WHERE kind = 'delivery';

-- A Stripe Checkout started by a merchant; credits are added once Stripe says it is paid.
CREATE TABLE credit_checkouts (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id      uuid NOT NULL REFERENCES restaurants(id) ON DELETE CASCADE,
  stripe_session_id  text NOT NULL UNIQUE,
  amount_gbp         numeric(10,2) NOT NULL,
  credits            numeric(10,2) NOT NULL,
  status             text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'paid', 'expired')),
  created_by         uuid REFERENCES users(id) ON DELETE SET NULL,
  created_at         timestamptz NOT NULL DEFAULT now(),
  paid_at            timestamptz
);

-- Merchants already on the platform start with 100 free credits. New sign-ups start at 0.
INSERT INTO credit_transactions (restaurant_id, kind, credits, note)
SELECT id, 'grant', 100, 'Free starting credits' FROM restaurants;
