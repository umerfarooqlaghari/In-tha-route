-- Drivers also prove their right to work in the UK, as a document of its own.
ALTER TABLE kyc_documents DROP CONSTRAINT kyc_documents_doc_type_check;
ALTER TABLE kyc_documents ADD CONSTRAINT kyc_documents_doc_type_check CHECK (doc_type IN
  ('driving_licence', 'ni_number', 'bank_account', 'vehicle_insurance', 'identity', 'right_to_work'));

-- Platform drivers who registered earlier get the new slot, still to upload.
INSERT INTO kyc_documents (driver_id, doc_type)
SELECT d.id, 'right_to_work'
  FROM driver_profiles d
 WHERE d.driver_type = 'platform_contracted'
ON CONFLICT (driver_id, doc_type) DO NOTHING;
