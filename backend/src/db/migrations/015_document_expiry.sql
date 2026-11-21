-- When a driver's document (licence, insurance, ID, right to work) runs out. Set by an admin
-- while checking the document; cleared when the driver uploads a new one.
ALTER TABLE kyc_documents ADD COLUMN expires_on date;
