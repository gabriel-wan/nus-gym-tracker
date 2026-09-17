/**
 * Reading and writing occupancy history in D1.
 *
 * See docs/DATABASE.md for the schema and why it looks like this.
 */

import type { Observation } from "./reboks";

/** A row as it comes back out of the database. */
export interface Reading {
  collectedAt: string;
  facilityId: number;
  facilityName: string;
  occupancy: number;
  capacity: number;
}

const INSERT = `
  INSERT INTO occupancy (collected_at, facility_id, facility_name, occupancy, capacity)
  VALUES (?, ?, ?, ?, ?)
`;

/**
 * Store one scrape.
 *
 * `batch()` runs the inserts in a single transaction, so a scrape lands either
 * completely or not at all — we never end up with one gym recorded and the other
 * missing for the same timestamp.
 */
export async function insertObservations(
  db: D1Database,
  observations: Observation[],
): Promise<void> {
  if (observations.length === 0) return;

  const insert = db.prepare(INSERT);
  await db.batch(
    observations.map((o) =>
      insert.bind(
        o.collectedAt.toISOString(),
        o.facilityId,
        o.name,
        o.occupancy,
        o.capacity,
      ),
    ),
  );
}

/**
 * The most recent reading for each gym.
 *
 * The subquery finds each gym's newest timestamp, then the join pulls back the
 * whole row it belongs to. SQLite would let us lean on a documented quirk of
 * bare columns alongside MAX(), but the explicit join says what it means.
 */
const LATEST = `
  SELECT o.collected_at  AS collectedAt,
         o.facility_id   AS facilityId,
         o.facility_name AS facilityName,
         o.occupancy     AS occupancy,
         o.capacity      AS capacity
  FROM occupancy o
  JOIN (
    SELECT facility_id, MAX(collected_at) AS newest
    FROM occupancy
    GROUP BY facility_id
  ) latest
    ON o.facility_id = latest.facility_id
   AND o.collected_at = latest.newest
  ORDER BY o.facility_id
`;

export async function latestReadings(db: D1Database): Promise<Reading[]> {
  const { results } = await db.prepare(LATEST).all<Reading>();
  return results;
}
