-- The photo of the receipt an order was scanned from is kept with the order,
-- so the restaurant and the admin can check the original later.
ALTER TABLE files
  ADD COLUMN folder text NOT NULL DEFAULT 'kyc' CHECK (folder IN ('kyc', 'receipts'));

ALTER TABLE orders
  ADD COLUMN receipt_file_id uuid REFERENCES files (id) ON DELETE SET NULL;

-- One photo belongs to one order.
CREATE UNIQUE INDEX orders_receipt_file_idx ON orders (receipt_file_id) WHERE receipt_file_id IS NOT NULL;

-- Scans that never became an order are cleared out by age.
CREATE INDEX files_receipts_created_idx ON files (created_at) WHERE folder = 'receipts';
