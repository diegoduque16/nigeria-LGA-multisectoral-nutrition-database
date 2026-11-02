-- Rollout: administrators choose which states are active. Inactive states (and their LGAs and units) are hidden
-- from lists, registration, the picture, pivot, national totals and exports; their data is kept.
ALTER TABLE org_units ADD COLUMN inactive INTEGER NOT NULL DEFAULT 0;
