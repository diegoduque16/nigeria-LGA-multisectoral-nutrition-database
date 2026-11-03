-- "Health facility" is a standard unit type: it is always offered when a schedule is reported by unit, even
-- before any facilities are loaded. "Load wards & health facilities" (official DHIS2 IDs via the scorecard
-- platform) files facilities under this same type, matched by name. Skipped if a type of that name exists.
INSERT OR IGNORE INTO unit_types (id, name, is_ward, sort, created_at)
  VALUES ('ut_health_facility', 'Health facility', 0, 5, CAST(strftime('%s','now') AS INTEGER) * 1000);
