import { describe, expect, it } from "vitest";

import type { Reading } from "../src/db";
import {
  bucketByHour,
  escapeHtml,
  formatGymMessage,
  formatHistoryMessage,
  parseCommand,
  shouldAlertOnFailure,
} from "../src/telegram";

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

    expect(message).toContain("22 / 110 · 20%");
    expect(message).toContain("84 / 120 · 70%");
    expect(message).toContain("USC Gym is quieter right now");
  });

  it("lists the quietest gym first", () => {
    const message = formatGymMessage([utown(84), usc(22)], EVENING);
    expect(message.indexOf("USC")).toBeLessThan(message.indexOf("UTown"));
  });

  it("does not call a gym quiet when it reads zero", () => {
    const message = formatGymMessage([usc(60), utown(0)], EVENING);

    expect(message).toContain("⚪ 0 / 120");
    expect(message).toContain("Only USC Gym looks open");
    expect(message).not.toContain("UTown Gym is quieter");
  });

  it("shows no numbers at all outside opening hours", () => {
    // After 22:00 the REBOKS counter freezes on its last value, so any figure
    // shown would be a leftover describing an empty building.
    const message = formatGymMessage([usc(54), utown(92)], NIGHT);

    expect(message).toContain("closed");
    expect(message).not.toContain("54");
    expect(message).not.toContain("92");
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

  it("escapes HTML so a renamed facility cannot break the message", () => {
    expect(escapeHtml('a <b> & "c"')).toBe('a &lt;b&gt; &amp; "c"');
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
    expect(formatGymMessage([usc(40)], EVENING)).toContain("based on QR scans");
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

describe("shouldAlertOnFailure", () => {
  const now = new Date("2026-09-18T12:00:00Z");

  it("alerts when collection succeeded moments ago - something just broke", () => {
    expect(shouldAlertOnFailure("2026-09-18T11:55:00Z", now)).toBe(true);
  });

  it("stays quiet once the outage is established, so it cannot spam", () => {
    expect(shouldAlertOnFailure("2026-09-18T11:40:00Z", now)).toBe(false);
    expect(shouldAlertOnFailure("2026-09-18T09:00:00Z", now)).toBe(false);
  });

  it("alerts when nothing has ever been collected", () => {
    expect(shouldAlertOnFailure(null, now)).toBe(true);
  });

  // A late cron run must not look like an ongoing outage, or the one alert that
  // matters never arrives.
  it("still alerts when a run was delayed past its slot", () => {
    expect(shouldAlertOnFailure("2026-09-18T11:49:00Z", now)).toBe(true);
  });

  it("sends at most two messages per outage at 5-minute sampling", () => {
    const lastSuccess = "2026-09-18T12:00:00Z";
    const alerts = [5, 10, 15, 20, 25, 30].filter((mins) =>
      shouldAlertOnFailure(lastSuccess, new Date(Date.parse(lastSuccess) + mins * 60000)),
    );

    expect(alerts).toEqual([5, 10]);
  });
});


describe("bucketByHour", () => {
  const at = (h: number, m = 0) =>
    `2026-09-18T${String((h - 8 + 24) % 24).padStart(2, "0")}:${String(m).padStart(2, "0")}:00Z`;

  it("averages within a two-hour bucket", () => {
    const buckets = bucketByHour([usc(11, at(7)), usc(33, at(8))]); // 10% and 30%

    expect(buckets).toHaveLength(1);
    expect(buckets[0].startHour).toBe(7);
    expect(buckets[0].percent).toBeCloseTo(20, 5);
  });

  // The important one: after 22:00 the counter freezes, so those readings
  // describe an empty building and must never reach a chart.
  it("drops readings from after closing time", () => {
    expect(bucketByHour([usc(61, at(22, 30)), usc(61, at(23, 30))])).toEqual([]);
  });

  it("drops readings from before opening time", () => {
    expect(bucketByHour([usc(0, at(6, 30))])).toEqual([]);
  });

  it("keeps a reading from the last open hour", () => {
    expect(bucketByHour([usc(55, at(21, 30))])).toHaveLength(1);
  });

  // Buckets anchor to opening time: the 07:00 readings must not be labelled
  // 06:00, an hour when the gym is shut and every reading is a reset zero.
  it("labels the first bucket 07:00, not 06:00", () => {
    expect(bucketByHour([usc(20, at(7, 30))])[0].startHour).toBe(7);
  });
});

describe("formatHistoryMessage", () => {
  const at = (h: number) => `2026-09-18T${String((h - 8 + 24) % 24).padStart(2, "0")}:00:00Z`;
  const EVENING_TODAY = new Date("2026-09-18T13:00:00Z");

  it("wraps each chart in a monospace block so the columns line up", () => {
    const message = formatHistoryMessage(
      [usc(22, at(9)), usc(77, at(19)), utown(60, at(9))],
      EVENING_TODAY,
    );

    expect(message).toContain("<pre>");
    expect(message).toContain("USC Gym");
    expect(message).toContain("UTown Gym");
    expect(message).toMatch(/\u2588+/);
    // The empty-track glyph is gone: it is not the same width as the full block
    // in Telegram's proportional font, which made every row a different length.
    expect(message).not.toContain("\u2591");
  });

  it("names the busiest bucket across both gyms", () => {
    const message = formatHistoryMessage([usc(22, at(9)), utown(108, at(19))], EVENING_TODAY);
    expect(message).toContain("Busiest so far: UTown Gym at 19:00 (90%)");
  });

  // /history answers "how has today looked". The closing notice belongs to
  // /gym, where a missing current reading needs explaining.
  it("does not repeat the closed notice", () => {
    const NIGHT_TODAY = new Date("2026-09-18T17:00:00Z");
    const message = formatHistoryMessage([usc(22, at(9))], NIGHT_TODAY);

    expect(message).toContain("USC Gym");
    expect(message).not.toContain("closed");
  });

  it("explains an empty day rather than drawing nothing", () => {
    expect(formatHistoryMessage([], EVENING_TODAY)).toContain("No readings for today yet");
  });

  it("builds a chart from only post-closing readings into nothing", () => {
    const frozen = [usc(31, "2026-09-18T14:30:00Z"), usc(31, "2026-09-18T15:30:00Z")];
    expect(formatHistoryMessage(frozen, EVENING_TODAY)).toContain("No readings for today yet");
  });
});
