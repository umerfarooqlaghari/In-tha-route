-- Expo push tokens: one row per phone that allowed notifications.
CREATE TABLE push_tokens (
  token       text PRIMARY KEY,
  user_id     uuid NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  platform    text NOT NULL DEFAULT 'unknown' CHECK (platform IN ('ios', 'android', 'unknown')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX push_tokens_user_idx ON push_tokens (user_id);
