-- Sector units below LGAs (level 4): schools, health facilities, water points ... each owned by one sector.
ALTER TABLE org_units ADD COLUMN sector_id TEXT REFERENCES sectors(id);
ALTER TABLE org_units ADD COLUMN unit_type TEXT;
ALTER TABLE org_units ADD COLUMN code TEXT;
ALTER TABLE org_units ADD COLUMN ward TEXT;  -- optional grouping inside the LGA (e.g. the DHIS2 ward of a health facility)
ALTER TABLE org_units ADD COLUMN created_by TEXT;
CREATE INDEX IF NOT EXISTS idx_ou_sector ON org_units(sector_id, parent_id);
