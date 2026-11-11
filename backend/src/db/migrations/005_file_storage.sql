-- Uploaded files can live in S3: the row then keeps the object key instead of the bytes.
ALTER TABLE files
  ADD COLUMN storage    text NOT NULL DEFAULT 'db' CHECK (storage IN ('db', 's3')),
  ADD COLUMN object_key text,
  ALTER COLUMN data DROP NOT NULL;

ALTER TABLE files
  ADD CONSTRAINT files_location_chk CHECK (
    (storage = 'db' AND data IS NOT NULL AND object_key IS NULL) OR
    (storage = 's3' AND object_key IS NOT NULL AND data IS NULL)
  );
