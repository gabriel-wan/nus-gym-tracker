/**
 * Worker entry point.
 *
 * Two ways in:
 *   scheduled() - the Cron Trigger -> read REBOKS, store in D1
 *   fetch()     - HTTP, later the Telegram webhook
 */

import {
  insertObservations,
  latestReadings,
  newestCollectedAt,
  readingsSince,
} from "./db";
import { observe, percentFull } from "./reboks";
import {
  aboutMessage,
  collectionFailedMessage,
  formatGymMessage,
  formatHistoryMessage,
  helpMessage,
  parseCommand,
  sendMessage,
  shouldAlertOnFailure,
  startMessage,
  type TelegramUpdate,
} from "./telegram";

export interface Env {
  DB: D1Database;

  // Both set with `wrangler secret put`, never in the repo.
  TELEGRAM_BOT_TOKEN: string;
  TELEGRAM_WEBHOOK_SECRET: string;

  // Optional: the chat to alert when collection fails. Send /start to the bot
  // and read the chat id from `wrangler tail` to find yours.
  ALERT_CHAT_ID?: string;
}

/** Where Telegram posts updates. Told to Telegram once, via setWebhook. */
const WEBHOOK_PATH = "/telegram";

export default {
  /**
   * Cron Trigger handler.
   *
   * `controller.scheduledTime` is when the run was *meant* to happen. We ignore
   * it and stamp rows with the real time instead, because Cloudflare does not
   * guarantee crons fire on schedule. See docs/ARCHITECTURE.md.
   */
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    try {
      const observations = await observe();
      await insertObservations(env.DB, observations);

      // One line per run, so a broken scrape is visible in `wrangler tail`.
      console.log(
        `stored ${observations.length} readings: ` +
          observations.map((o) => `${o.name} ${o.occupancy}/${o.capacity}`).join(", "),
      );
    } catch (error) {
      console.error(`collection failed: ${error}`);
      await reportCollectionFailure(env, error);
    }
  },

  /**
   * HTTP handler. Stage 3 turns this into the Telegram webhook.
   *
   * `/health` reads from D1 rather than scraping. That is what the bot will do
   * too: it shows whether the collector is actually running, and it keeps our
   * traffic to REBOKS at one request per cron however many people ask.
   */
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (request.method === "POST" && url.pathname === WEBHOOK_PATH) {
      return handleTelegramUpdate(request, env);
    }

    if (url.pathname === "/health") {
      const readings = await latestReadings(env.DB);

      return Response.json({
        ok: readings.length > 0,
        gyms: readings.map((reading) => ({
          name: reading.facilityName,
          occupancy: reading.occupancy,
          capacity: reading.capacity,
          percent: percentFull(reading),
          collectedAt: reading.collectedAt,
        })),
      });
    }

    return new Response("nus-gym-tracker\n", {
      headers: { "content-type": "text/plain" },
    });
  },
} satisfies ExportedHandler<Env>;

/**
 * Handle one Telegram update.
 *
 * The webhook URL is public, so the first thing to establish is that Telegram
 * really sent this. Telegram echoes back the secret we gave it at setWebhook
 * time in a header; anything else is someone poking at the URL.
 *
 * We always answer 200 once the request is authentic, including for commands we
 * do not know. A non-200 makes Telegram retry the same update repeatedly.
 */
async function handleTelegramUpdate(request: Request, env: Env): Promise<Response> {
  const sent = request.headers.get("X-Telegram-Bot-Api-Secret-Token");
  if (sent !== env.TELEGRAM_WEBHOOK_SECRET) {
    return new Response("forbidden", { status: 403 });
  }

  const update = (await request.json()) as TelegramUpdate;
  const chatId = update.message?.chat.id;
  const command = parseCommand(update.message?.text);

  if (chatId === undefined || command === null) {
    return new Response("ok");
  }

  // A D1 failure inside replyTo must not escape. An unhandled throw answers
  // Telegram with a 500, and Telegram redelivers that update again and again
  // while the user sees nothing at all.
  try {
    const reply = await replyTo(command, env);
    if (reply !== null) {
      await sendMessage(env.TELEGRAM_BOT_TOKEN, chatId, reply);
    }
  } catch (error) {
    console.error(`command ${command} failed: ${error}`);
    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      chatId,
      "Something went wrong looking that up. Please try again in a moment.",
    );
  }

  return new Response("ok");
}

/** null means "say nothing", which is the right response to an unknown command. */
async function replyTo(command: string, env: Env): Promise<string | null> {
  switch (command) {
    case "/gym":
      return formatGymMessage(await latestReadings(env.DB), new Date());
    case "/history": {
      const now = new Date();
      return formatHistoryMessage(await readingsSince(env.DB, startOfSgtDay(now)), now);
    }
    case "/start":
      return startMessage();
    case "/help":
      return helpMessage();
    case "/about":
      return aboutMessage();
    default:
      return null;
  }
}

/**
 * Tell the operator that a collection run failed.
 *
 * Silent by design if ALERT_CHAT_ID is unset - alerting is opt-in, and a
 * missing chat id must never turn one failure into two.
 */
async function reportCollectionFailure(env: Env, error: unknown): Promise<void> {
  if (!env.ALERT_CHAT_ID) return;

  try {
    const lastSuccess = await newestCollectedAt(env.DB);
    if (!shouldAlertOnFailure(lastSuccess, new Date())) return;

    await sendMessage(
      env.TELEGRAM_BOT_TOKEN,
      Number(env.ALERT_CHAT_ID),
      collectionFailedMessage(error, lastSuccess),
    );
  } catch (alertError) {
    // Never let the alert path throw: it runs inside the handler that just
    // failed, and a crash here would hide the original error.
    console.error(`failed to report failure: ${alertError}`);
  }
}

/**
 * Midnight Singapore time today, as a UTC timestamp.
 *
 * /history is "today" in the reader's terms, and a Singapore day starts 8 hours
 * before the UTC one it overlaps.
 */
function startOfSgtDay(now: Date): string {
  const sgt = new Date(now.getTime() + 8 * 3600_000);
  const midnightSgt = Date.UTC(sgt.getUTCFullYear(), sgt.getUTCMonth(), sgt.getUTCDate());
  return new Date(midnightSgt - 8 * 3600_000).toISOString();
}
