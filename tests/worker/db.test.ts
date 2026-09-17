import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

import { insertObservations, latestReadings, newestCollectedAt } from "../../src/db";
import type { Observation } from "../../src/reboks";

function observation(
  facilityId: number,
  occupancy: number,
  collectedAt: string,
): Observation {
  return {
    collectedAt: new Date(collectedAt),
    facilityId,
    name: facilityId === 39 ? "USC" : "UTown",
    kind: "gym",
    occupancy,
    capacity: facilityId === 39 ? 110 : 120,
  };
}

describe("insertObservations", () => {
  it("writes one row per gym", async () => {
    await insertObservations(env.DB, [
      observation(39, 71, "2026-09-18T11:00:00Z"),
      observation(26, 42, "2026-09-18T11:00:00Z"),
    ]);

    const { results } = await env.DB.prepare("SELECT * FROM occupancy").all();
    expect(results).toHaveLength(2);
  });

  it("does nothing when there is nothing to write", async () => {
    await insertObservations(env.DB, []);
    expect(await newestCollectedAt(env.DB)).toBeNull();
  });

  it("stores capacity per row, so a changed capacity does not rewrite history", async () => {
    await insertObservations(env.DB, [observation(39, 71, "2026-09-18T11:00:00Z")]);
    const row = await env.DB.prepare("SELECT capacity FROM occupancy").first<{ capacity: number }>();
    expect(row?.capacity).toBe(110);
  });
});

describe("latestReadings", () => {
  it("returns only the newest row per gym, not the whole history", async () => {
    for (const at of ["11:00", "11:05", "11:10"]) {
      await insertObservations(env.DB, [
        observation(39, 70, `2026-09-18T${at}:00Z`),
        observation(26, 40, `2026-09-18T${at}:00Z`),
      ]);
    }

    const readings = await latestReadings(env.DB);

    expect(readings).toHaveLength(2);
    expect(new Set(readings.map((r) => r.collectedAt))).toEqual(
      new Set(["2026-09-18T11:10:00.000Z"]),
    );
  });

  // The case that produced a real bug: one gym's insert lands, the other's does
  // not, so the two rows carry different timestamps.
  it("returns each gym's own newest row when the two disagree", async () => {
    await insertObservations(env.DB, [observation(39, 70, "2026-09-18T09:00:00Z")]);
    await insertObservations(env.DB, [observation(26, 40, "2026-09-18T11:00:00Z")]);

    const byId = new Map((await latestReadings(env.DB)).map((r) => [r.facilityId, r]));

    expect(byId.get(39)?.collectedAt).toBe("2026-09-18T09:00:00.000Z");
    expect(byId.get(26)?.collectedAt).toBe("2026-09-18T11:00:00.000Z");
  });

  it("returns nothing on an empty table rather than throwing", async () => {
    expect(await latestReadings(env.DB)).toEqual([]);
  });
});

describe("newestCollectedAt", () => {
  it("reports the most recent collection across all gyms", async () => {
    await insertObservations(env.DB, [observation(39, 70, "2026-09-18T09:00:00Z")]);
    await insertObservations(env.DB, [observation(26, 40, "2026-09-18T11:00:00Z")]);

    expect(await newestCollectedAt(env.DB)).toBe("2026-09-18T11:00:00.000Z");
  });

  it("is null before anything has been collected", async () => {
    expect(await newestCollectedAt(env.DB)).toBeNull();
  });
});
