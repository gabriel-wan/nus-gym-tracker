import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

import {
  gymsOnly,
  parseFacilities,
  percentFull,
  USC_GYM_ID,
  UTOWN_GYM_ID,
} from "../src/reboks";

/**
 * A real capacity page saved on 2026-09-17 at 21:08 SGT. Using a real response
 * rather than handwritten HTML means the test fails if REBOKS changes its markup
 * in a way our regex does not cope with.
 */
const html = readFileSync(join(__dirname, "fixtures/capacity.html"), "utf8");

describe("parseFacilities", () => {
  it("finds all four published facilities", () => {
    expect(parseFacilities(html)).toHaveLength(4);
  });

  it("reads the two gyms we track", () => {
    const byId = new Map(parseFacilities(html).map((f) => [f.facilityId, f]));

    expect(byId.get(USC_GYM_ID)).toMatchObject({
      name: "University Sports Centre - Gym",
      kind: "gym",
      occupancy: 106,
      capacity: 110,
    });

    expect(byId.get(UTOWN_GYM_ID)).toMatchObject({
      name: "University Town - Fitness gym",
      kind: "gym",
      capacity: 120,
    });
  });

  it("distinguishes pools from gyms", () => {
    const kinds = parseFacilities(html).map((f) => f.kind);
    expect(kinds.filter((k) => k === "gym")).toHaveLength(2);
    expect(kinds.filter((k) => k === "pool")).toHaveLength(2);
  });

  it("normalises the double space in 'Kent Ridge -  Swimming Pool'", () => {
    const names = parseFacilities(html).map((f) => f.name);
    expect(names).toContain("Kent Ridge - Swimming Pool");
  });

  // The important one: a layout change must fail loudly, because an empty
  // result is indistinguishable from "every gym is empty".
  it("throws rather than returning an empty array", () => {
    expect(() => parseFacilities("<html><body>nothing here</body></html>")).toThrow(
      /layout has changed/,
    );
  });
});

describe("gymsOnly", () => {
  it("keeps both gyms and drops the pools", () => {
    const gyms = gymsOnly(parseFacilities(html));

    expect(gyms.map((g) => g.facilityId).sort()).toEqual([UTOWN_GYM_ID, USC_GYM_ID]);
    expect(gyms.every((g) => g.kind === "gym")).toBe(true);
  });
});

describe("percentFull", () => {
  it("computes a percentage", () => {
    expect(percentFull({ occupancy: 55, capacity: 110 })).toBe(50);
  });

  it("returns null when capacity is zero, rather than dividing by zero", () => {
    expect(percentFull({ occupancy: 0, capacity: 0 })).toBeNull();
  });
});
