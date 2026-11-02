-- Self-registration: an administrator shares a link / QR code; people fill in their details; an admin approves.
CREATE TABLE IF NOT EXISTS registration_links (
  id TEXT PRIMARY KEY,               -- the token in the link (only lets people submit a request)
  name TEXT NOT NULL,
  ou_id TEXT NOT NULL REFERENCES org_units(id),   -- people can only pick places inside this area
  role TEXT,                          -- suggested role (they can still choose another allowed one)
  datasets TEXT NOT NULL DEFAULT '[]',
  max_uses INTEGER,
  uses INTEGER NOT NULL DEFAULT 0,
  expires_at INTEGER NOT NULL,
  revoked_at INTEGER,
  created_by TEXT NOT NULL,
  created_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS account_requests (
  id TEXT PRIMARY KEY,
  link_id TEXT NOT NULL REFERENCES registration_links(id),
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  phone TEXT,
  job_title TEXT,
  organisation TEXT,
  role TEXT NOT NULL,
  ou_id TEXT NOT NULL REFERENCES org_units(id),
  datasets TEXT NOT NULL DEFAULT '[]',
  note TEXT,
  pw_hash TEXT NOT NULL, pw_salt TEXT NOT NULL, pw_iter INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',   -- pending | approved | rejected
  ip TEXT,
  created_at INTEGER NOT NULL,
  decided_by TEXT, decided_at INTEGER, decision_note TEXT, user_id TEXT
);
CREATE INDEX IF NOT EXISTS idx_requests_status ON account_requests(status, created_at);
CREATE INDEX IF NOT EXISTS idx_requests_email ON account_requests(email);
