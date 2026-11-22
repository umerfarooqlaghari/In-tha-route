-- Emails are stored in lowercase (the app lowercases them at signup and login, and 001_auth
-- already enforces it with a CHECK). This is a safety net for any row that slipped through:
-- each one is lowercased unless that would clash with another account, in which case it is left
-- alone and reported, so two people are never merged into one login.
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN SELECT id, email FROM users WHERE email <> lower(trim(email)) LOOP
    IF EXISTS (SELECT 1 FROM users WHERE email = lower(trim(r.email)) AND id <> r.id) THEN
      RAISE WARNING 'Email % (user %) was not lowercased: % already belongs to another account.',
        r.email, r.id, lower(trim(r.email));
    ELSE
      UPDATE users SET email = lower(trim(r.email)) WHERE id = r.id;
    END IF;
  END LOOP;
END $$;
