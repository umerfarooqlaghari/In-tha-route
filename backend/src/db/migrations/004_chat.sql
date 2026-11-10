-- Restaurant <-> driver chat, plus "last seen" for online status.

ALTER TABLE users ADD COLUMN last_seen_at timestamptz;

-- One thread per restaurant and driver pair; it collects every order they share.
CREATE TABLE conversations (
  id                       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  restaurant_id            uuid NOT NULL REFERENCES restaurants (id) ON DELETE CASCADE,
  driver_id                uuid NOT NULL REFERENCES driver_profiles (id) ON DELETE CASCADE,
  restaurant_last_read_at  timestamptz NOT NULL DEFAULT now(),
  driver_last_read_at      timestamptz NOT NULL DEFAULT now(),
  last_message_at          timestamptz,
  created_at               timestamptz NOT NULL DEFAULT now(),
  UNIQUE (restaurant_id, driver_id)
);

CREATE INDEX conversations_driver_idx ON conversations (driver_id);

CREATE TABLE messages (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  conversation_id  uuid NOT NULL REFERENCES conversations (id) ON DELETE CASCADE,
  sender_role      text NOT NULL CHECK (sender_role IN ('restaurant', 'driver')),
  sender_user_id   uuid REFERENCES users (id) ON DELETE SET NULL,
  body             text NOT NULL CHECK (char_length(body) BETWEEN 1 AND 2000),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX messages_conversation_idx ON messages (conversation_id, created_at DESC);
