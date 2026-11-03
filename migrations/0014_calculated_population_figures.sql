-- A population figure can be calculated from another one (normally Total population) as a share, e.g.
-- Expected pregnancies = 4.5% of Total population. Its values are recalculated whenever the base changes.
ALTER TABLE data_elements ADD COLUMN calc_base TEXT;
ALTER TABLE data_elements ADD COLUMN calc_share REAL;
