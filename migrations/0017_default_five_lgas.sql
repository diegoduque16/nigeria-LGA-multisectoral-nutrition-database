-- LGAs in use start small: in each state in use, only its first 5 LGAs (alphabetically); every other LGA is off
-- until a system administrator ticks it under Set-up → States & LGAs in use. Units below an LGA follow it.
UPDATE org_units SET inactive = 1 WHERE level = 3;
UPDATE org_units SET inactive = 0
 WHERE level = 3 AND closed_at IS NULL
   AND parent_id IN (SELECT id FROM org_units WHERE level = 2 AND inactive = 0)
   AND (SELECT COUNT(*) FROM org_units x WHERE x.parent_id = org_units.parent_id AND x.level = 3 AND x.closed_at IS NULL AND x.name < org_units.name) < 5;
UPDATE org_units SET inactive = COALESCE((SELECT l.inactive FROM org_units l WHERE l.id = org_units.lga_id), 0)
 WHERE level >= 4 AND lga_id IS NOT NULL;
