-- Data sets belong to a sector; a "shared" data set (yearly population/denominators) can be used by every sector's indicators.
ALTER TABLE datasets ADD COLUMN sector_id TEXT REFERENCES sectors(id);
ALTER TABLE datasets ADD COLUMN shared INTEGER NOT NULL DEFAULT 0;
-- For shared (yearly) numbers used over a shorter period: 1 = split by months (e.g. expected pregnancies), 0 = use as is (e.g. number of schools).
ALTER TABLE data_elements ADD COLUMN prorate INTEGER NOT NULL DEFAULT 1;
