-- LGA Sector Reporting System: schema (Cloudflare D1 / SQLite)

CREATE TABLE IF NOT EXISTS org_units (
  id TEXT PRIMARY KEY,               -- DHIS2 UID, never generated here
  name TEXT NOT NULL,
  level INTEGER NOT NULL,            -- 1 country, 2 state, 3 LGA
  parent_id TEXT REFERENCES org_units(id),
  path TEXT NOT NULL,                -- /country/state/lga (DHIS2 style)
  closed_at INTEGER,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ou_parent ON org_units(parent_id);
CREATE INDEX IF NOT EXISTS idx_ou_level ON org_units(level);

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  pw_hash TEXT, pw_salt TEXT, pw_iter INTEGER,
  role TEXT NOT NULL,                -- sysadmin | setupadmin | state | lga | viewer
  ou_id TEXT NOT NULL REFERENCES org_units(id),
  active INTEGER NOT NULL DEFAULT 1,
  failed_logins INTEGER NOT NULL DEFAULT 0,
  locked_until INTEGER,
  created_by TEXT,
  created_at INTEGER NOT NULL,
  last_login_at INTEGER
);

-- Data sets an account reports or reviews (none = all data sets).
CREATE TABLE IF NOT EXISTS user_datasets (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  dataset_id TEXT NOT NULL,
  PRIMARY KEY (user_id, dataset_id)
);
-- Optional narrowing: the numerators/denominators an account may enter (none = all in its data sets).
CREATE TABLE IF NOT EXISTS user_data_elements (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  de_id TEXT NOT NULL,
  PRIMARY KEY (user_id, de_id)
);

CREATE TABLE IF NOT EXISTS sessions (
  id TEXT PRIMARY KEY,               -- sha256 of the cookie token
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL,
  last_seen_at INTEGER NOT NULL,
  user_agent TEXT
);
CREATE INDEX IF NOT EXISTS idx_sessions_user ON sessions(user_id);

CREATE TABLE IF NOT EXISTS password_tokens (
  id TEXT PRIMARY KEY,               -- sha256 of the token sent to the user
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose TEXT NOT NULL,             -- invite | reset
  expires_at INTEGER NOT NULL,
  used_at INTEGER
);

CREATE TABLE IF NOT EXISTS api_tokens (
  id TEXT PRIMARY KEY,               -- sha256 of the token
  name TEXT NOT NULL,
  created_by TEXT NOT NULL,
  ou_id TEXT NOT NULL,               -- scope: exports limited to this org unit and below
  created_at INTEGER NOT NULL,
  last_used_at INTEGER,
  revoked_at INTEGER
);

-- Sectors that indicators belong to (Health, Education, Agriculture, WASH ...).
CREATE TABLE IF NOT EXISTS sectors (
  id TEXT PRIMARY KEY,               -- DHIS2-style UID (used as an indicator group in exports)
  name TEXT NOT NULL UNIQUE,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS datasets (
  id TEXT PRIMARY KEY,               -- DHIS2-style UID
  name TEXT NOT NULL UNIQUE,
  frequency TEXT NOT NULL DEFAULT 'MONTHLY',  -- MONTHLY | QUARTERLY | YEARLY
  group_id TEXT NOT NULL UNIQUE,     -- indicator group UID for exports
  reporting_rate_id TEXT NOT NULL UNIQUE, -- UID of the reporting-rate indicator
  due_day INTEGER NOT NULL DEFAULT 15,  -- day of the month after the period ends
  created_at INTEGER NOT NULL,
  archived_at INTEGER
);

CREATE TABLE IF NOT EXISTS data_elements (
  id TEXT PRIMARY KEY,
  dataset_id TEXT NOT NULL REFERENCES datasets(id),
  name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  value_type TEXT NOT NULL DEFAULT 'INTEGER',  -- INTEGER | NUMBER
  min_value REAL, max_value REAL,
  sort INTEGER NOT NULL DEFAULT 0,
  created_at INTEGER NOT NULL,
  archived_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_de_dataset ON data_elements(dataset_id);

CREATE TABLE IF NOT EXISTS indicator_types (
  id TEXT PRIMARY KEY, name TEXT NOT NULL, factor INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS indicators (
  id TEXT PRIMARY KEY,               -- DHIS2-style UID or an existing DHIS2 indicator ID
  dataset_id TEXT NOT NULL REFERENCES datasets(id),
  sector_id TEXT NOT NULL REFERENCES sectors(id),
  name TEXT NOT NULL,
  short_name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  source TEXT NOT NULL DEFAULT '',   -- where the numbers come from, e.g. HMIS register
  numerator TEXT NOT NULL,           -- expression over #{dataElementId}
  denominator TEXT NOT NULL DEFAULT '1',
  numerator_description TEXT NOT NULL DEFAULT '',
  denominator_description TEXT NOT NULL DEFAULT '',
  type_id TEXT NOT NULL REFERENCES indicator_types(id),
  decimals INTEGER NOT NULL DEFAULT 1,
  sort INTEGER NOT NULL DEFAULT 0,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  archived_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_ind_dataset ON indicators(dataset_id);

CREATE TABLE IF NOT EXISTS indicator_history (
  indicator_id TEXT NOT NULL, version INTEGER NOT NULL, snapshot TEXT NOT NULL, changed_by TEXT, changed_at INTEGER NOT NULL,
  PRIMARY KEY (indicator_id, version)
);

CREATE TABLE IF NOT EXISTS reports (
  dataset_id TEXT NOT NULL REFERENCES datasets(id),
  ou_id TEXT NOT NULL REFERENCES org_units(id),
  period TEXT NOT NULL,              -- DHIS2 period: YYYYMM, YYYYQn or YYYY
  status TEXT NOT NULL,              -- draft | submitted | accepted | returned
  version INTEGER NOT NULL DEFAULT 1,
  updated_by TEXT, updated_at INTEGER NOT NULL,
  submitted_by TEXT, submitted_at INTEGER,
  reviewed_by TEXT, reviewed_at INTEGER,
  review_comment TEXT,
  PRIMARY KEY (dataset_id, ou_id, period)
);
CREATE INDEX IF NOT EXISTS idx_reports_period ON reports(dataset_id, period, status);

CREATE TABLE IF NOT EXISTS data_values (
  de_id TEXT NOT NULL REFERENCES data_elements(id),
  ou_id TEXT NOT NULL REFERENCES org_units(id),
  period TEXT NOT NULL,
  value REAL NOT NULL,
  updated_by TEXT, updated_at INTEGER NOT NULL,
  PRIMARY KEY (de_id, ou_id, period)
);
CREATE INDEX IF NOT EXISTS idx_dv_ou_period ON data_values(ou_id, period);

CREATE TABLE IF NOT EXISTS data_value_history (
  de_id TEXT NOT NULL, ou_id TEXT NOT NULL, period TEXT NOT NULL,
  old_value REAL, new_value REAL, changed_by TEXT, changed_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_dvh ON data_value_history(ou_id, period);

CREATE TABLE IF NOT EXISTS audit (
  id TEXT PRIMARY KEY,
  user_id TEXT, action TEXT NOT NULL, ref_type TEXT, ref_id TEXT, detail TEXT, ip TEXT, created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_time ON audit(created_at);

CREATE TABLE IF NOT EXISTS rate_limits (key TEXT PRIMARY KEY, window_start INTEGER NOT NULL, count INTEGER NOT NULL);
CREATE TABLE IF NOT EXISTS settings (key TEXT PRIMARY KEY, value TEXT NOT NULL, updated_at INTEGER NOT NULL);

INSERT OR IGNORE INTO indicator_types (id, name, factor) VALUES
  ('bWuNrMHEoZ0', 'Number', 1),
  ('hmSnCXmLYwt', 'Percentage', 100),
  ('k7XnYhQ0P2w', 'Per 1,000', 1000);
