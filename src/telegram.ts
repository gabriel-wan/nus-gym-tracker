/**
 * Telegram bot: understanding incoming updates and writing the replies.
 *
 * Everything here except sendMessage() is a pure function, so the bot's
 * behaviour can be tested without a bot token or a network.
 */

import type { Reading } from "./db";
import { percentFull } from "./reboks";

/** Display names. The REBOKS names are too long for a chat message. */
const GYM_NAMES: Record<number, string> = {
  26: "UTown Gym",
  39: "USC Gym",
};

/** Gym opening hours, Singapore time. */
const OPEN_HOUR = 7;
const CLOSE_HOUR = 22;

/** A reading older than this, while the gyms are open, is worth flagging. */
const STALE_AFTER_MINUTES = 30;

/**
 * Crowd bands. These are our labels for the sake of a readable message - NUS
 * publishes no definition of "busy", so nothing here should be presented as
 * official.
 */
const BUSY_PERCENT = 70;
const MODERATE_PERCENT = 40;

/**
 * The slice of Telegram's Update object we actually use. Telegram sends far
 * more; declaring only what we read keeps the contract small.
 */
export interface TelegramUpdate {
  message?: {
    chat: { id: number };
    text?: string;
  };
}

/**
 * Pull the command out of a message.
 *
 * In group chats Telegram appends the bot's username, so `/gym@NusGymBot` has
 * to be treated as `/gym`.
 */
export function parseCommand(text: string | undefined): string | null {
  const first = (text ?? "").trim().split(/\s+/)[0];
  if (!first?.startsWith("/")) return null;
  return first.split("@")[0].toLowerCase();
}

/** Hour of day in Singapore. The Worker's clock is always UTC. */
function sgtHour(now: Date): number {
  return (now.getUTCHours() + 8) % 24;
}

function isOpen(now: Date): boolean {
  const hour = sgtHour(now);
  return hour >= OPEN_HOUR && hour < CLOSE_HOUR;
}

function gymName(reading: Reading): string {
  return GYM_NAMES[reading.facilityId] ?? reading.facilityName;
}

function minutesAgo(collectedAt: string, now: Date): number {
  const elapsed = now.getTime() - new Date(collectedAt).getTime();
  return Math.max(0, Math.round(elapsed / 60000));
}

function describeAge(minutes: number): string {
  if (minutes < 1) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return `Updated about ${hours} hour${hours === 1 ? "" : "s"} ago`;
}

/**
 * One gym, two lines.
 *
 * A zero gets a white circle rather than a green one. Green would read as
 * "wonderfully empty, go now", when 0 almost always means the gym is shut.
 */
function gymBlock(reading: Reading): string {
  const pct = percentFull(reading);

  if (reading.occupancy === 0) {
    return `${gymName(reading)}\n⚪ ${reading.occupancy} / ${reading.capacity} · closed or empty`;
  }

  const icon =
    pct === null ? "⚪" : pct >= BUSY_PERCENT ? "\u{1F534}" : pct >= MODERATE_PERCENT ? "\u{1F7E1}" : "\u{1F7E2}";

  return `${gymName(reading)}\n${icon} ${reading.occupancy} / ${reading.capacity} · ${pct?.toFixed(0)}% full`;
}

/**
 * The line that actually answers "should I go now".
 *
 * A gym reading 0 is not evidence that it is quiet - it is more often closed.
 * Calling it "quieter" would be the most misleading thing this bot could say,
 * so that case is handled before any comparison.
 */
function verdict(readings: Reading[], now: Date): string | null {
  if (!isOpen(now)) return `Both gyms are closed. They open at ${OPEN_HOUR}am.`;

  const open = readings.filter((r) => r.occupancy > 0);
  if (open.length === 0) return "Both read 0, which usually means closed.";
  if (open.length === 1) return `Only ${gymName(open[0])} looks open right now.`;

  const [quietest, busiest] = [...open].sort(
    (a, b) => (percentFull(a) ?? 0) - (percentFull(b) ?? 0),
  );
  const gap = (percentFull(busiest) ?? 0) - (percentFull(quietest) ?? 0);

  if (gap < 5) return "Both about the same right now.";
  return `${gymName(quietest)} is quieter right now.`;
}

/** The reply to /gym. */
export function formatGymMessage(readings: Reading[], now: Date): string {
  if (readings.length === 0) {
    return [
      "\u{1F3CB} NUS Gym Tracker",
      "",
      "No readings yet.",
      "",
      "The collector has not recorded any gym data, so there is nothing to show.",
      "Try again in a few minutes.",
    ].join("\n");
  }

  // Quietest first: the whole point of the message is where to go.
  const ordered = [...readings].sort(
    (a, b) => (percentFull(a) ?? 0) - (percentFull(b) ?? 0),
  );

  const lines = ["\u{1F3CB} NUS Gym Tracker", ""];
  for (const reading of ordered) {
    lines.push(gymBlock(reading), "");
  }

  const call = verdict(readings, now);
  if (call) lines.push(call);

  const age = minutesAgo(readings[0].collectedAt, now);
  lines.push(describeAge(age));

  // Only suspect a stuck collector while the gyms are open. Overnight the cron
  // is deliberately idle, and a warning every morning is one you learn to skip.
  if (age > STALE_AFTER_MINUTES && isOpen(now)) {
    lines.push("⚠ Data may be stale - the collector may be stuck.");
  }

  lines.push("", "⚠ Counts come from entry scans and may read high. /about");

  return lines.join("\n").trim();
}

/** The reply to /start. */
export function startMessage(): string {
  return [
    "\u{1F3CB} Welcome to NUS Gym Tracker",
    "",
    "Check how busy the NUS gyms are before you head down.",
    "",
    "/gym - current crowd levels",
    "/about - where the numbers come from",
    "/help - all commands",
  ].join("\n");
}

/** The reply to /help. */
export function helpMessage(): string {
  return [
    "\u{1F3CB} NUS Gym Tracker",
    "",
    "/gym - current crowd levels",
    "/about - how the data is collected",
    "/help - show commands",
    "",
    "Data comes from NUS REBOKS, sampled every 15 minutes while the gyms are open.",
  ].join("\n");
}

/** The reply to /about. Everything the numbers do not say for themselves. */
export function aboutMessage(): string {
  return [
    "\u{1F3CB} NUS Gym Tracker",
    "",
    `Readings come from the public NUS REBOKS capacity page, collected every 15 minutes while the gyms are open (${OPEN_HOUR}am-${CLOSE_HOUR - 12}pm daily).`,
    "",
    "What the number is not:",
    "Entry is by QR scan, and people often forget to scan out. The count is really 'scanned in and not yet scanned out', so it tends to read higher than the number of people actually in the gym.",
    "",
    "A reading of 0 usually means closed rather than empty. The page gives no way to tell those apart.",
    "",
    "Colour bands are our labels, not an NUS definition of busy:",
    `\u{1F7E2} under ${MODERATE_PERCENT}%   \u{1F7E1} ${MODERATE_PERCENT}-${BUSY_PERCENT}%   \u{1F534} over ${BUSY_PERCENT}%`,
  ].join("\n");
}

/**
 * Send a message via the Telegram Bot API.
 *
 * Plain text, no parse_mode: Markdown would mean escaping every `-`, `.` and
 * `(` in the output, and buys nothing here.
 */
export async function sendMessage(
  token: string,
  chatId: number,
  text: string,
): Promise<void> {
  // Never throws. Telegram retries any webhook we fail to answer, so letting an
  // error escape here would mean the same update being delivered again and
  // again - and the user getting the message twice once it eventually works.
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text }),
    });

    if (!response.ok) {
      console.error(`sendMessage failed: ${response.status} ${await response.text()}`);
    }
  } catch (error) {
    console.error(`sendMessage threw: ${error}`);
  }
}
