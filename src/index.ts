/**
 * Worker entry point.
 *
 * Two ways in:
 *   scheduled() - the Cron Trigger, every 15 minutes -> read REBOKS
 *   fetch()     - HTTP, later the Telegram webhook
 *
 * Scaffolding only. Storage (D1) is Stage 2 and Telegram is Stage 3; both are
 * marked below rather than half-implemented.
 */

import { observe, percentFull } from "./reboks";

export interface Env {
  // Stage 2: uncomment the d1_databases binding in wrangler.toml, then:
  // DB: D1Database;
  //
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

    for (const facility of observations) {
      const pct = percentFull(facility);
      console.log(
        `${facility.name}: ${facility.occupancy}/${facility.capacity}` +
          (pct === null ? "" : ` (${pct.toFixed(0)}%)`),
      );
    }

    // Stage 2: write `observations` to D1 here.
  },

  /**
   * HTTP handler. Stage 3 turns this into the Telegram webhook; for now it is a
   * health check that proves the Worker is deployed and can reach REBOKS.
   */
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      const observations = await observe();
      return Response.json({
        ok: true,
        observedAt: observations[0].observedAt.toISOString(),
        facilities: observations.map((f) => ({
          id: f.facilityId,
          name: f.name,
          occupancy: f.occupancy,
          capacity: f.capacity,
        })),
      });
    }

    return new Response("nus-gym-tracker\n", {
      headers: { "content-type": "text/plain" },
    });
  },
} satisfies ExportedHandler<Env>;
