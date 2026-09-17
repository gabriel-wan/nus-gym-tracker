-- One row per gym per scrape. See docs/DATABASE.md for why each column exists.

CREATE TABLE occupancy (
  id            INTEGER PRIMARY KEY,
  observed_at   TEXT    NOT NULL,
  facility_id   INTEGER NOT NULL,
  facility_name TEXT    NOT NULL,
  occupancy     INTEGER NOT NULL,
  capacity      INTEGER NOT NULL
);

-- Both query patterns we have are "this gym, ordered by time": the latest
-- reading for /gym, and a time range for historical analysis. This index serves
-- both. It is justified by the access pattern, not by the row count.
CREATE INDEX idx_occupancy_facility_time
  ON occupancy (facility_id, observed_at);
