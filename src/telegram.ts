/**
 * Telegram bot: understanding incoming updates and writing the replies.
 *
 * Messages are sent with parse_mode HTML, so every value interpolated into one
 * must go through escapeHtml(). HTML rather than MarkdownV2 because it needs
 * three characters escaped instead of eighteen, and the copy is full of `.`,
 * `-` and `(`.
 *
 * Everything except sendMessage() is a pure function, so the bot's behaviour is
 * testable without a bot token or a network.
 */

import type { Reading } from "./db";
import { percentFull } from "./reboks";

/** Display names. The REBOKS names are too long for a chat message. */
const GYM_NAMES: Record<number, string> = {
  26: "UTown Gym",
  39: "USC Gym",
};

/**
 * Gym opening hours, Singapore time.
 *
 * These bound what we *show*, not what we collect. The cron runs 06:00-23:59 to
 * catch the opening transition and any change to the hours - but after 22:00 the
 * REBOKS counter freezes on its last value until an overnight reset, so those
 * readings describe an empty building and must never reach a chart.
 */
const OPEN_HOUR = 7;
const CLOSE_HOUR = 22;

/** Three missed runs at 5-minute sampling. Worth flagging while open. */
const STALE_AFTER_MINUTES = 15;

/**
 * Crowd bands. Our labels for the sake of a scannable message - NUS publishes no
 * definition of "busy", so nothing here should be presented as official.
 */
const BUSY_PERCENT = 70;
const MODERATE_PERCENT = 40;

/** Width of a /history bar, in characters. */
const BAR_WIDTH = 10;

/** Hours per /history bucket. Two keeps both gyms inside one readable message. */
const BUCKET_HOURS = 2;

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

/** Telegram's HTML parse mode needs exactly these three escaped. */
export function escapeHtml(text: string): string {
  return text.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
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
function sgtHour(date: Date): number {
  return (date.getUTCHours() + 8) % 24;
}

function isOpen(now: Date): boolean {
  const hour = sgtHour(now);
  return hour >= OPEN_HOUR && hour < CLOSE_HOUR;
}

function gymName(reading: Reading): string {
  return GYM_NAMES[reading.facilityId] ?? reading.facilityName;
}

function minutesAgo(collectedAt: string, now: Date): number {
  return Math.max(0, Math.round((now.getTime() - Date.parse(collectedAt)) / 60000));
}

function describeAge(minutes: number): string {
  if (minutes < 1) return "Updated just now";
  if (minutes < 60) return `Updated ${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  return `Updated about ${hours} hour${hours === 1 ? "" : "s"} ago`;
}

function marker(pct: number | null, occupancy: number): string {
  // A zero gets a neutral circle, never green. Green reads as "wonderfully
  // empty, go now" when 0 almost always means shut.
  if (occupancy === 0 || pct === null) return "⚪";
  if (pct >= BUSY_PERCENT) return "\u{1F534}";
  if (pct >= MODERATE_PERCENT) return "\u{1F7E1}";
  return "\u{1F7E2}";
}

const CLOSED_NOTICE = [
  "Both gyms are closed.",
  `Open ${OPEN_HOUR}am–${CLOSE_HOUR - 12}pm daily.`,
].join("\n");

const SCAN_CAVEAT =
  "⚠️ Counts are based on QR scans and may be higher than the actual number of people inside.\n/about for more info.";

const HEADER = "\u{1F3CB} <b>NUS Gym Tracker</b>";

/**
 * The line that answers "which one should I go to".
 *
 * A gym reading 0 is not evidence that it is quiet - it is more often closed.
 * Calling it "quieter" would be the most misleading thing this bot could say,
 * so that case is handled before any comparison.
 */
function verdict(readings: Reading[]): string | null {
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
  // Outside opening hours the stored number is a frozen leftover from before
  // closing. Showing it - even labelled - invites reading it as occupancy.
  if (!isOpen(now)) {
    return `${HEADER}\n\n${CLOSED_NOTICE}`;
  }

  if (readings.length === 0) {
    return [
      HEADER,
      "",
      "No readings yet.",
      "",
      "The collector has not recorded any gym data, so there is nothing to show.",
      "Try again in a few minutes.",
    ].join("\n");
  }

  // Each gym's row is fetched independently, so a failed insert can leave one
  // fresh and the other hours old. Age everything by the OLDEST reading:
  // understating freshness is safe, overstating it is the lie worth avoiding.
  const ages = new Map(readings.map((r) => [r.facilityId, minutesAgo(r.collectedAt, now)]));
  const freshest = Math.min(...ages.values());
  const oldest = Math.max(...ages.values());

  const lines = [HEADER, ""];

  for (const reading of [...readings].sort(
    (a, b) => (percentFull(a) ?? 0) - (percentFull(b) ?? 0),
  )) {
    const pct = percentFull(reading);
    const lagging = (ages.get(reading.facilityId) ?? 0) - freshest > STALE_AFTER_MINUTES;

    lines.push(`<b>${escapeHtml(gymName(reading))}</b>`);
    lines.push(
      `${marker(pct, reading.occupancy)} ${reading.occupancy} / ${reading.capacity}` +
        (pct === null ? " · capacity unknown" : ` · ${pct.toFixed(0)}%`) +
        (lagging ? " · older reading" : ""),
    );
    lines.push("");
  }

  const call = verdict(readings);
  if (call) lines.push(escapeHtml(call));

  lines.push(describeAge(oldest));
  if (oldest > STALE_AFTER_MINUTES) {
    lines.push("⚠️ Data may be stale — the collector may be stuck.");
  }

  lines.push("", SCAN_CAVEAT);
  return lines.join("\n").trim();
}

interface Bucket {
  startHour: number;
  percent: number;
}

/**
 * Average percentage per BUCKET_HOURS block, Singapore time.
 *
 * Only 07:00-22:00 is bucketed. Readings outside that are either the pre-opening
 * zeros or the frozen post-closing value, and both would distort the shape.
 */
export function bucketByHour(readings: Reading[]): Bucket[] {
  const totals = new Map<number, { sum: number; count: number }>();

  for (const reading of readings) {
    const collected = new Date(reading.collectedAt);
    const hour = sgtHour(collected);
    if (hour < OPEN_HOUR || hour >= CLOSE_HOUR) continue;

    const pct = percentFull(reading);
    if (pct === null) continue;

    // Buckets are anchored to opening time, not to even hours. Anchoring to
    // even hours would label the 07:00 readings as 06:00 - an hour when the
    // gym is shut and every reading is a pre-reset zero.
    const start = OPEN_HOUR + Math.floor((hour - OPEN_HOUR) / BUCKET_HOURS) * BUCKET_HOURS;
    const bucket = totals.get(start) ?? { sum: 0, count: 0 };
    bucket.sum += pct;
    bucket.count += 1;
    totals.set(start, bucket);
  }

  return [...totals.entries()]
    .sort(([a], [b]) => a - b)
    .map(([startHour, { sum, count }]) => ({ startHour, percent: sum / count }));
}

/**
 * Filled blocks only - no empty track.
 *
 * `█` and `░` are NOT the same width in Telegram's proportional font: the full
 * block is wider, so a half-filled bar came out a different total length from an
 * almost-empty one and everything after it sat at a different position. One
 * repeated glyph cannot disagree with itself.
 */
function bar(percent: number): string {
  return "█".repeat(Math.min(BAR_WIDTH, Math.max(0, Math.round((percent / 100) * BAR_WIDTH))));
}

/**
 * Time, then percentage, then the bar.
 *
 * The bar goes last on purpose. Bars have different lengths, so anything printed
 * after one is pushed to a different position on every row - which is exactly
 * how the percentages ended up ragged. Nothing follows the bar now.
 */
function chartFor(buckets: Bucket[]): string {
  return buckets
    .map((b) => {
      const label = `${String(b.startHour).padStart(2, "0")}:00`;
      const pct = `${String(Math.round(b.percent)).padStart(3)}%`;
      return `${label}  ${pct}  ${bar(b.percent)}`;
    })
    .join("\n");
}

/**
 * The reply to /history: today's shape for both gyms.
 *
 * Both, deliberately. The point of this project is choosing between them, and
 * making someone send a second command to see the other one breaks that.
 */
export function formatHistoryMessage(readings: Reading[], now: Date): string {
  const byGym = new Map<number, Reading[]>();
  for (const reading of readings) {
    byGym.set(reading.facilityId, [...(byGym.get(reading.facilityId) ?? []), reading]);
  }

  const charts: string[] = [];
  let peak: { name: string; hour: number; percent: number } | null = null;

  for (const [facilityId, gymReadings] of [...byGym.entries()].sort(([a], [b]) => a - b)) {
    const buckets = bucketByHour(gymReadings);
    if (buckets.length === 0) continue;

    const name = GYM_NAMES[facilityId] ?? gymReadings[0].facilityName;
    // <pre> is the only way Telegram gives us a monospace font, and a chart is a
    // table: columns line up only when every character is the same width. In the
    // default proportional font `1` is narrower than `0`, so `11:00` is shorter
    // than `07:00` and each row's bar starts somewhere slightly different. The
    // gym name stays outside the block so the message still reads as a message.
    charts.push(`<b>${escapeHtml(name)}</b>\n<pre>${escapeHtml(chartFor(buckets))}</pre>`);

    for (const bucket of buckets) {
      if (!peak || bucket.percent > peak.percent) {
        peak = { name, hour: bucket.startHour, percent: bucket.percent };
      }
    }
  }

  if (charts.length === 0) {
    return [
      "\u{1F4C8} <b>Today</b>",
      "",
      "No readings for today yet.",
      `The gyms open at ${OPEN_HOUR}am.`,
    ].join("\n");
  }

  const lines = ["\u{1F4C8} <b>Today</b>", "", ...charts];
  if (peak) {
    lines.push(
      `Busiest so far: ${escapeHtml(peak.name)} at ${String(peak.hour).padStart(2, "0")}:00 (${Math.round(peak.percent)}%)`,
    );
  }

  // No closing notice here. /history answers "how has today looked", and that
  // reads the same whether the gym is open now or not. Explaining a missing
  // current reading is /gym's job.
  return lines.join("\n").trim();
}

/**
 * Should a failed run alert, given when collection last succeeded?
 *
 * Alert on the first failure of an outage, then go quiet. The signal that we
 * have already alerted is simply that the newest stored reading is no longer
 * recent - no extra table needed to remember we sent a message.
 *
 * The window is a little over two sampling intervals. Tighter would risk a
 * delayed cron run looking like an ongoing outage and alerting for nothing at
 * all, which is the failure this whole mechanism exists to prevent. Wider means
 * more duplicate messages. At 5-minute sampling this sends at most two.
 */
const ALERT_WINDOW_MINUTES = 12;

export function shouldAlertOnFailure(lastSuccess: string | null, now: Date): boolean {
  if (lastSuccess === null) return true;
  return (now.getTime() - Date.parse(lastSuccess)) / 60000 <= ALERT_WINDOW_MINUTES;
}

/** The message sent to the operator when a collection run fails. */
export function collectionFailedMessage(error: unknown, lastSuccess: string | null): string {
  const detail = error instanceof Error ? error.message : String(error);
  return [
    "\u{1F6A8} <b>NUS Gym Tracker: collection failed</b>",
    "",
    escapeHtml(detail.slice(0, 300)),
    "",
    lastSuccess
      ? `Last successful collection: ${escapeHtml(lastSuccess)}`
      : "There has never been a successful collection.",
  ].join("\n");
}

/** The reply to /start. */
export function startMessage(): string {
  return [
    "\u{1F3CB} <b>Welcome to NUS Gym Tracker</b>",
    "",
    "Check how busy the NUS gyms are before you head down.",
    "",
    "/gym — current crowd levels",
    "/history — today's crowd levels",
    "/about — how the numbers work",
    "/help — available commands",
  ].join("\n");
}

/** The reply to /help. */
export function helpMessage(): string {
  return [
    HEADER,
    "",
    "/gym — current crowd levels",
    "/history — today's crowd levels",
    "/about — how the numbers work",
    "/help — available commands",
  ].join("\n");
}

/** The reply to /about. Everything the numbers do not say for themselves. */
export function aboutMessage(): string {
  return [
    HEADER,
    "",
    `Gym occupancy is based on readings from the public NUS REBOKS capacity page, collected every 5 minutes while the gyms are open (${OPEN_HOUR}am–${CLOSE_HOUR - 12}pm).`,
    "",
    "<b>A note about the numbers</b>",
    "",
    "The reported count is based on QR entry scans. Since people may forget to scan out, the number can be higher than the actual number of people in the gym.",
    "",
    "A reading of <b>0</b> usually means the gym is closed, rather than completely empty.",
    "",
    "<b>How we label capacity</b>",
    "",
    `\u{1F7E2} <b>Under ${MODERATE_PERCENT}%</b> · Low`,
    `\u{1F7E1} <b>${MODERATE_PERCENT}–${BUSY_PERCENT}%</b> · Moderate`,
    `\u{1F534} <b>Over ${BUSY_PERCENT}%</b> · High`,
    "",
    "These are labels used by NUS Gym Tracker and are not official NUS capacity ratings.",
  ].join("\n");
}

/**
 * Send a message via the Telegram Bot API.
 *
 * Never throws. Telegram retries any webhook we fail to answer, so letting an
 * error escape here would mean the same update being delivered again and again
 * - and the user getting the message twice once it eventually works.
 */
export async function sendMessage(
  token: string,
  chatId: number,
  text: string,
): Promise<void> {
  try {
    const response = await fetch(`https://api.telegram.org/bot${token}/sendMessage`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: chatId,
        text,
        parse_mode: "HTML",
        link_preview_options: { is_disabled: true },
      }),
    });

    if (!response.ok) {
      console.error(`sendMessage failed: ${response.status} ${await response.text()}`);
    }
  } catch (error) {
    console.error(`sendMessage threw: ${error}`);
  }
}
