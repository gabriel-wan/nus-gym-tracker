/**
 * Worker entry point.
 *
 * Two ways in:
 *   scheduled() - the Cron Trigger -> read REBOKS, store in D1
 *   fetch()     - HTTP, later the Telegram webhook
 */

import { insertObservations, latestReadings } from "./db";
import { observe, percentFull } from "./reboks";

export interface Env {
  DB: D1Database;

  // Stage 3: set with `wrangler secret put TELEGRAM_BOT_TOKEN`, never in the repo.
  // TELEGRAM_BOT_TOKEN: string;
}

export default {
  /**
   * Cron Trigger handler.
   *
   * `controller.scheduledTime` is when the run was *meant* to happen. We ignore
   * it and stamp rows with the real time instead, because Cloudflare does not
   * guarantee crons fire on schedule. See docs/ARCHITECTURE.md.
   */
  async scheduled(controller: ScheduledController, env: Env, ctx: ExecutionContext) {
    const observations = await observe();
    await insertObservations(env.DB, observations);

    // One line per run, so a broken scrape is visible in `wrangler tail`.
    console.log(
      `stored ${observations.length} readings: ` +
        observations.map((o) => `${o.name} ${o.occupancy}/${o.capacity}`).join(", "),
    );
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

    if (url.pathname === "/health") {
      const readings = await latestReadings(env.DB);

      return Response.json({
        ok: readings.length > 0,
        gyms: readings.map((reading) => ({
          name: reading.facilityName,
          occupancy: reading.occupancy,
          capacity: reading.capacity,
          percent: percentFull(reading),
          observedAt: reading.observedAt,
        })),
      });
    }

    return new Response("nus-gym-tracker\n", {
      headers: { "content-type": "text/plain" },
    });
  },
} satisfies ExportedHandler<Env>;
