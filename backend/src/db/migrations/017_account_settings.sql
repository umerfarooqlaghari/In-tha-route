-- People can edit and delete their own accounts, and merchants can add a logo.

-- A deleted account is closed and anonymised, not removed, so past orders, credit
-- purchases and earnings stay in the records.
ALTER TABLE users ADD COLUMN deleted_at timestamptz;

-- Logos are stored like the other uploads, in their own folder.
ALTER TABLE files DROP CONSTRAINT files_folder_check;
ALTER TABLE files ADD CONSTRAINT files_folder_check CHECK (folder IN ('kyc', 'receipts', 'logos'));

ALTER TABLE restaurants ADD COLUMN logo_file_id uuid REFERENCES files (id) ON DELETE SET NULL;
