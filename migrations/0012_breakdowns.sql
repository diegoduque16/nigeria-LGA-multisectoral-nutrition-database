-- Breakdowns (disaggregation): a number people report can be split, e.g. by sex and/or age group.
-- People type the parts; the total in data_values is their sum, so totals, indicators and exports are unchanged.
CREATE TABLE IF NOT EXISTS breakdowns (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  options TEXT NOT NULL,          -- JSON [{ "id": "f", "name": "Female" }, …]
  created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_breakdowns_name ON breakdowns(lower(name));
INSERT OR IGNORE INTO breakdowns (id, name, options, created_at) VALUES
  ('bd_sex', 'Sex', '[{"id":"f","name":"Female"},{"id":"m","name":"Male"}]', CAST(strftime('%s','now') AS INTEGER) * 1000),
  ('bd_age_u5', 'Age (under 5)', '[{"id":"a0_5","name":"0–5 months"},{"id":"a6_23","name":"6–23 months"},{"id":"a24_59","name":"24–59 months"}]', CAST(strftime('%s','now') AS INTEGER) * 1000);
ALTER TABLE data_elements ADD COLUMN breakdown_id TEXT;
ALTER TABLE data_elements ADD COLUMN breakdown2_id TEXT;
CREATE TABLE IF NOT EXISTS data_value_parts (
  de_id TEXT NOT NULL,
  ou_id TEXT NOT NULL,
  period TEXT NOT NULL,
  part TEXT NOT NULL,             -- e.g. "f", or "f.a6_23" for two breakdowns
  value REAL NOT NULL,
  updated_by TEXT,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (de_id, ou_id, period, part)
);
CREATE INDEX IF NOT EXISTS idx_parts_ou ON data_value_parts(ou_id, period);
