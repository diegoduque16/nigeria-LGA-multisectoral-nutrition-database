-- Units below the LGA: each unit type can name the code a sector's own system uses (e.g. "EMIS school code"),
-- and each unit can have coordinates (for maps, finding duplicates, and the DHIS2 export).
ALTER TABLE unit_types ADD COLUMN code_label TEXT;
ALTER TABLE org_units ADD COLUMN latitude REAL;
ALTER TABLE org_units ADD COLUMN longitude REAL;
