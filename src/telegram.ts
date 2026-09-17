/**
 * Telegram bot: understanding incoming updates and writing the replies.
 *
 * Everything here except sendMessage() is a pure function, so the bot's
 * behaviour can be tested without a bot token or a network.
 */

import type { Reading } from "./db";
import { percentFull } from "./reboks";

/** Short labels. The REBOKS names are too long for a chat message. */
const SHORT_NAMES: Record<number, string> = {
  26: "UTown",
  39: "USC",
};

/** Gym opening hours, Singapore time. */
const OPEN_HOUR = 7;
const CLOSE_HOUR = 22;

/** Readings older than this are worth apologising for. */
const STALE_AFTER_MINUTES = 30;

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

function label(reading: Reading): string {
  return SHORT_NAMES[reading.facilityId] ?? reading.facilityName;
}

function minutesAgo(observedAt: string, now: Date): number {
  const elapsed = now.getTime() - new Date(observedAt).getTime();
  return Math.max(0, Math.round(elapsed / 60000));
}

function describeAge(minutes: number): string {
  if (minutes < 1) return "Updated just now.";
  if (minutes < 60) return `Updated ${minutes} min ago.`;
  const hours = Math.round(minutes / 60);
  return `Updated about ${hours} hour${hours === 1 ? "" : "s"} ago.`;
}

/**
 * The line that actually answers "which gym should I go to".
 *
 * A gym reading 0 is not evidence that it is quiet - it is more often closed or
 * a counter nobody has scanned into. Calling it "quieter" would be the single
 * most misleading thing this bot could say, so that case is handled first.
 */
function verdict(readings: Reading[], now: Date): string {
  if (!isOpen(now)) {
    return `Both gyms are closed. They open at ${OPEN_HOUR}am.`;
  }

  const empty = readings.filter((r) => r.occupancy === 0);
  if (empty.length === readings.length) {
    return "Every gym reads 0, which usually means closed rather than empty.";
  }
  if (empty.length > 0) {
    const names = empty.map(label).join(" and ");
    return `${names} reads 0 - probably closed rather than empty.`;
  }

  const [quietest, busiest] = [...readings].sort(
    (a, b) => (percentFull(a) ?? 0) - (percentFull(b) ?? 0),
  );
  if (!busiest) return "";

  const gap = (percentFull(busiest) ?? 0) - (percentFull(quietest) ?? 0);
  if (gap < 5) return "Both about the same right now.";
  return `${label(quietest)} is quieter right now.`;
}

/** The reply to /gym. */
export function formatGymMessage(readings: Reading[], now: Date): string {
  if (readings.length === 0) {
    return "No readings yet. The collector may not have run - try again shortly.";
  }

  const lines = ["\u{1F3CB} NUS Gym Tracker", ""];

  for (const reading of [...readings].sort(
    (a, b) => (percentFull(a) ?? 0) - (percentFull(b) ?? 0),
  )) {
    const pct = percentFull(reading);
    lines.push(label(reading));
    lines.push(
      `${reading.occupancy}/${reading.capacity}` +
        (pct === null ? "" : ` (${pct.toFixed(0)}%)`),
    );
    lines.push("");
  }

  lines.push(verdict(readings, now));

  const age = minutesAgo(readings[0].observedAt, now);
  lines.push(describeAge(age));

  // Only suspect a stuck collector while the gyms are open. Overnight the cron
  // is deliberately not running, so stale readings are expected, and warning
  // about them every morning would train the reader to ignore the warning.
  if (age > STALE_AFTER_MINUTES && isOpen(now)) {
    lines.push("That is older than usual - the collector may be stuck.");
  }

  return lines.join("\n").trim();
}

/** The reply to /start and /help. */
export function helpMessage(): string {
  return [
    "\u{1F3CB} NUS Gym Tracker",
    "",
    "/gym - how busy UTown and USC are right now",
    "",
    "Numbers come from NUS REBOKS, sampled every 15 minutes while the gyms are",
    `open (${OPEN_HOUR}am-${CLOSE_HOUR - 12}pm daily). Entry is by QR scan and people`,
    "often forget to scan out, so the count tends to read high.",
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
