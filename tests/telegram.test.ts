import { describe, expect, it } from "vitest";

import type { Reading } from "../src/db";
import { formatGymMessage, parseCommand } from "../src/telegram";

/** 13:00 UTC is 21:00 SGT, inside opening hours. */
const EVENING = new Date("2026-09-18T13:00:00Z");
/** 17:00 UTC is 01:00 SGT, outside opening hours. */
const NIGHT = new Date("2026-09-18T17:00:00Z");

function reading(
  facilityId: number,
  occupancy: number,
  capacity: number,
  collectedAt = "2026-09-18T12:56:00Z",
): Reading {
  return {
    collectedAt,
    facilityId,
    facilityName: facilityId === 39 ? "University Sports Centre - Gym" : "University Town - Fitness gym",
    occupancy,
    capacity,
  };
}

const usc = (n: number, at?: string) => reading(39, n, 110, at);
const utown = (n: number, at?: string) => reading(26, n, 120, at);

describe("parseCommand", () => {
  it("reads a plain command", () => {
    expect(parseCommand("/gym")).toBe("/gym");
  });

  it("strips the bot username that Telegram adds in group chats", () => {
    expect(parseCommand("/gym@NusGymTrackerBot")).toBe("/gym");
  });

  it("ignores anything after the command", () => {
    expect(parseCommand("/gym now please")).toBe("/gym");
  });

  it("returns null for ordinary chat messages", () => {
    expect(parseCommand("hello")).toBeNull();
    expect(parseCommand(undefined)).toBeNull();
  });
});

describe("formatGymMessage", () => {
  it("names the quieter gym", () => {
    const message = formatGymMessage([usc(22), utown(84)], EVENING);

    expect(message).toContain("22 / 110 · 20% full");
    expect(message).toContain("84 / 120 · 70% full");
    expect(message).toContain("USC Gym is quieter right now");
  });

  it("lists the quietest gym first", () => {
    const message = formatGymMessage([utown(84), usc(22)], EVENING);
    expect(message.indexOf("USC")).toBeLessThan(message.indexOf("UTown"));
  });

  it("does not call a gym quiet when it reads zero", () => {
    const message = formatGymMessage([usc(60), utown(0)], EVENING);

    expect(message).toContain("closed or empty");
    expect(message).toContain("Only USC Gym looks open");
    expect(message).not.toContain("UTown Gym is quieter");
  });

  it("says closed outside opening hours rather than reporting 0%", () => {
    const message = formatGymMessage([usc(0), utown(0)], NIGHT);

    expect(message).toContain("closed");
    expect(message).not.toContain("quieter");
  });

  it("calls it even when the two gyms are close", () => {
    const message = formatGymMessage([usc(55), utown(60)], EVENING);
    expect(message).toContain("about the same");
  });

  it("reports how old the reading is", () => {
    const message = formatGymMessage([usc(22, "2026-09-18T12:56:00Z")], EVENING);
    expect(message).toContain("Updated 4 min ago");
  });

  it("warns when the reading is stale enough to suggest a stuck collector", () => {
    const message = formatGymMessage([usc(22, "2026-09-18T11:00:00Z")], EVENING);

    expect(message).toContain("about 2 hours ago");
    expect(message).toContain("may be stuck");
  });

  it("does not cry wolf about stale data overnight, when the cron is meant to be idle", () => {
    const message = formatGymMessage([usc(0, "2026-09-18T15:00:00Z")], NIGHT);

    expect(message).toContain("closed");
    expect(message).not.toContain("may be stuck");
  });

  it("colours the bands: green under 40, amber to 70, red above", () => {
    expect(formatGymMessage([usc(22)], EVENING)).toContain("\u{1F7E2}");
    expect(formatGymMessage([usc(60)], EVENING)).toContain("\u{1F7E1}");
    expect(formatGymMessage([usc(99)], EVENING)).toContain("\u{1F534}");
  });

  it("uses a neutral marker for 0 rather than a reassuring green", () => {
    const message = formatGymMessage([usc(0)], EVENING);

    expect(message).toContain("⚪");
    expect(message).not.toContain("\u{1F7E2}");
  });

  it("always carries the scan caveat", () => {
    expect(formatGymMessage([usc(40)], EVENING)).toContain("may read high");
  });

  // Regression: the age line used to come from one row and be applied to both,
  // so a fresh gym beside a stale one was reported as if both were fresh.
  it("ages by the oldest reading when the two gyms disagree", () => {
    const message = formatGymMessage(
      [utown(42, "2026-09-18T13:00:00Z"), usc(71, "2026-09-18T09:00:00Z")],
      EVENING,
    );

    expect(message).toContain("about 4 hours ago");
    expect(message).not.toContain("just now");
    expect(message).toContain("older reading");
  });

  it("marks which gym is lagging, not just that something is old", () => {
    const message = formatGymMessage(
      [utown(42, "2026-09-18T13:00:00Z"), usc(71, "2026-09-18T09:00:00Z")],
      EVENING,
    );
    const uscBlock = message.slice(message.indexOf("USC Gym"));

    expect(uscBlock).toContain("older reading");
    expect(message.slice(message.indexOf("UTown Gym"), message.indexOf("USC Gym")))
      .not.toContain("older reading");
  });

  // Regression: capacity 0 rendered as "undefined% full".
  it("says capacity unknown rather than undefined when capacity is 0", () => {
    const message = formatGymMessage([reading(39, 5, 0)], EVENING);

    expect(message).toContain("capacity unknown");
    expect(message).not.toContain("undefined");
  });

  it("explains an empty database instead of showing nothing", () => {
    expect(formatGymMessage([], EVENING)).toContain("No readings yet");
  });
});
