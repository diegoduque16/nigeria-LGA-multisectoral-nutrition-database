-- A data set is reported either by each LGA (3) or by each sector unit below the LGA (4: schools, facilities ...),
-- in which case unit reports are added up to the LGA automatically.
ALTER TABLE datasets ADD COLUMN report_level INTEGER NOT NULL DEFAULT 3;
