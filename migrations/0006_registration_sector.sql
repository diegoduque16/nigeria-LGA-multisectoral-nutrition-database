-- People choose their sector when they register; a QR code can preset one.
ALTER TABLE account_requests ADD COLUMN sector_id TEXT REFERENCES sectors(id);
ALTER TABLE registration_links ADD COLUMN sector_id TEXT REFERENCES sectors(id);
