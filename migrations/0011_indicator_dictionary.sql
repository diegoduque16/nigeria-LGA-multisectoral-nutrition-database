-- Indicator dictionary: one shared definition per indicator (code, name, definition, numerator, denominator,
-- how it is shown, source, framework reference). Every sector's indicator links to one entry, so the same name
-- always means the same calculation across sectors.
CREATE TABLE IF NOT EXISTS indicator_defs (
  id TEXT PRIMARY KEY,
  code TEXT,
  name TEXT NOT NULL,
  definition TEXT NOT NULL DEFAULT '',
  numerator TEXT NOT NULL,
  denominator TEXT NOT NULL DEFAULT '',
  show_as TEXT NOT NULL DEFAULT 'percent',
  source TEXT NOT NULL DEFAULT '',
  framework TEXT NOT NULL DEFAULT '',
  sector_id TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived_at INTEGER
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_defs_name ON indicator_defs(lower(name));
CREATE UNIQUE INDEX IF NOT EXISTS idx_defs_code ON indicator_defs(lower(code)) WHERE code IS NOT NULL AND code != '';
ALTER TABLE indicators ADD COLUMN def_id TEXT;

-- Existing indicators: one entry per name (the first one found gives the calculation).
INSERT INTO indicator_defs (id, name, definition, numerator, denominator, show_as, source, sector_id, created_at, updated_at)
  SELECT 'def_' || lower(hex(randomblob(6))), MIN(name), description, numerator_description,
         CASE WHEN denominator_description = '1' THEN '' ELSE denominator_description END,
         CASE type_id WHEN 'bWuNrMHEoZ0' THEN 'number' WHEN 'k7XnYhQ0P2w' THEN 'per1000' ELSE 'percent' END,
         source, sector_id, CAST(strftime('%s','now') AS INTEGER) * 1000, CAST(strftime('%s','now') AS INTEGER) * 1000
    FROM indicators WHERE archived_at IS NULL GROUP BY lower(name);
UPDATE indicators SET def_id = (SELECT d.id FROM indicator_defs d WHERE lower(d.name) = lower(indicators.name)) WHERE def_id IS NULL;
