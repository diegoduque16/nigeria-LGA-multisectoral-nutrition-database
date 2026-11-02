-- Units below the LGA get real types (Ward, Health facility, Primary school, Water point …), and each
-- reporting schedule chooses which types report. Wards sit at DHIS2 level 4 under the LGA (with their
-- real DHIS2 IDs); other units sit under their ward (level 5) or directly under the LGA (level 4).
CREATE TABLE IF NOT EXISTS unit_types (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  is_ward INTEGER NOT NULL DEFAULT 0,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_unit_types_name ON unit_types(lower(name));
CREATE TABLE IF NOT EXISTS dataset_unit_types (
  dataset_id TEXT NOT NULL,
  type_id TEXT NOT NULL,
  PRIMARY KEY (dataset_id, type_id)
);
ALTER TABLE org_units ADD COLUMN unit_type_id TEXT;
ALTER TABLE org_units ADD COLUMN lga_id TEXT;

INSERT OR IGNORE INTO unit_types (id, name, is_ward, sort, created_at)
  VALUES ('ut_ward', 'Ward', 1, 0, CAST(strftime('%s','now') AS INTEGER) * 1000);

-- Existing units: their free-text type becomes a unit type ("<Sector> unit" when empty).
INSERT INTO unit_types (id, name, is_ward, sort, created_at)
  SELECT 'ut_' || lower(hex(randomblob(6))), MIN(n), 0, 10, CAST(strftime('%s','now') AS INTEGER) * 1000
    FROM (SELECT COALESCE(NULLIF(trim(o.unit_type), ''), COALESCE(s.name, 'Other') || ' unit') AS n
            FROM org_units o LEFT JOIN sectors s ON s.id = o.sector_id WHERE o.level = 4)
   WHERE lower(n) NOT IN (SELECT lower(name) FROM unit_types)
   GROUP BY lower(n);
UPDATE org_units SET lga_id = parent_id,
  unit_type_id = (SELECT t.id FROM unit_types t WHERE lower(t.name) = lower(COALESCE(NULLIF(trim(org_units.unit_type), ''),
    COALESCE((SELECT name FROM sectors WHERE id = org_units.sector_id), 'Other') || ' unit')))
  WHERE level = 4;
-- Schedules already reported by unit keep exactly the units they had (those of their sector).
INSERT OR IGNORE INTO dataset_unit_types (dataset_id, type_id)
  SELECT DISTINCT d.id, o.unit_type_id FROM datasets d JOIN org_units o ON o.level = 4 AND o.sector_id = d.sector_id
   WHERE d.report_level = 4 AND o.unit_type_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_ou_lga_type ON org_units(lga_id, unit_type_id);
