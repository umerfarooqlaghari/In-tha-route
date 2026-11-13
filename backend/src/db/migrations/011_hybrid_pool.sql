-- Hybrid orders: posted to the open pool, where the restaurant's own drivers can take them
-- as well as platform drivers. The first to accept gets it. Stays set after it is taken,
-- so the restaurant can see it was a hybrid order.
ALTER TABLE orders
  ADD COLUMN hybrid boolean NOT NULL DEFAULT false;
