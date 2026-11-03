-- State and LGA administrators: a state or LGA account that also manages the accounts below it — creates them,
-- makes registration QR codes and approves the sign-ups that come in for its area.
-- Existing state accounts already managed LGA accounts, so they keep that as administrators.
ALTER TABLE users ADD COLUMN is_admin INTEGER NOT NULL DEFAULT 0;
UPDATE users SET is_admin = 1 WHERE role = 'state';
