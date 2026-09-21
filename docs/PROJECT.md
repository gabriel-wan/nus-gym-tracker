# NUS Gym Tracker — project context

This file is the shared context for the project. It is written both for me and for any
coding agent working on the repository. Read this first, then `docs/TODO.md`.

## What it is

A small Telegram bot that reports how crowded NUS gyms are, and — eventually — when they
are likely to be quiet.

Initially two facilities:

- University Town - Fitness gym (facility ID 26)
- University Sports Centre - Gym (facility ID 39)

## Why I am building it

NUS already publishes live gym occupancy, but only as a snapshot on a page you have to
go and look at. Two things are missing:

1. **Convenience.** Checking means opening uNivUS, being redirected to REBOKS, and
   reading a page. A Telegram message is faster.
2. **History.** The page shows *now* and nothing else. Nobody is keeping the numbers, so
   you cannot answer "is 7pm always this bad?" or "is it quieter at 9pm?". That question
   is the actual point of the project.

This is also a learning and portfolio project. Understanding the system matters more
than the amount of code in it, so it is built in deliberate stages with the reasoning
written down.

## The problem it solves

Deciding *when* to go to the gym, rather than discovering on arrival that it is full.
On 2026-09-17 at 20:38 the USC gym was at 109/110 — useful to know before walking there.

## Current goals

1. Reliably read live occupancy from REBOKS. **(done)**
2. Collect it automatically so history accumulates. **(done)**
3. Expose it over Telegram via `/gym` and `/history`. **(done)**
4. Accumulate enough history to test whether prediction beats a simple baseline.

Everything else waits until there is data to justify it.

## Current features

- A local Python prototype that fetches the REBOKS capacity page and prints occupancy,
  capacity, facility ID and timestamp for all four published facilities.
- A Cloudflare Worker whose `scheduled()` handler scrapes REBOKS and writes one row per
  gym into D1, and whose `/health` endpoint reads the latest rows back out.
- An `occupancy` table with a single migration.
- A Telegram webhook answering `/gym`, `/history`, `/start`, `/help` and `/about`,
  rejecting anything that does not carry the shared secret.
- 58 tests: REBOKS parsing against a real saved page, bot message formatting, and
  the D1 and webhook layers running inside workerd.

Deployed and collecting since 18 September 2026.

## Planned features

| Command | Purpose | Requires |
|---|---|---|
| `/gym` | current occupancy for both gyms | done |
| `/start` `/help` `/about` | onboarding, commands, data caveats | done |
| `/history` | today's shape, both gyms | done |
| `/best` | quietest time today | historical patterns |
| `/predict` | occupancy 30/60/90 min ahead | modelling, and a baseline to beat |
| `/alert` | notify when a gym drops below a threshold | per-user state |

`/best` and `/predict` are blocked on data: there are still no Tuesday, Wednesday or
Thursday readings, and a day-of-week baseline needs roughly four weeks.

## Technical decisions

| Decision | Reasoning |
|---|---|
| Scrape HTML, not JSON | A JSON API is referenced in REBOKS's own JavaScript but every endpoint returns 404, identical to a nonexistent route. See `docs/DATA-SOURCE.md`. |
| Regex over an HTML parser | The markup is machine-generated, uniform and unnested. Adding a parser dependency would buy nothing. |
| Python prototype first | Stage 0 is about understanding the data source. Doing that locally avoids learning Cloudflare and REBOKS at the same time. |
| Cloudflare Workers + D1 | The workload is one request every 5 minutes. Free tier covers it with ~250× headroom, and D1 binds to the Worker with no extra credentials. |
| Telegram webhooks, not long polling | Long polling needs an always-on process, which would rule out serverless entirely. |
| Store `capacity` per observation | Capacity is a property of the moment, not the facility, and appears to change over time. |
| Store `collected_at`, not `observed_at` | Cron Triggers are not guaranteed to fire on time, so the schedule is not a reliable clock. And REBOKS publishes no observation time - its "Last Updated at" is the page render clock - so collection time is the only honest timestamp we have. |
| Store UTC | Unambiguous and immune to any future timezone handling mistakes; convert to SGT only for display. |
| No ML yet | Revisit in mid-October. The limit is not rows but weeks: there are only ~105 distinct (day, hour) situations and one fresh observation of each per week. |
| Messages use `parse_mode: HTML` | Bold copy needs a parse mode, and `<pre>` is the only way to get aligned bars in `/history` - Telegram's default font is proportional. HTML over MarkdownV2 because it escapes three characters rather than eighteen. |
| Hide counts outside opening hours | After 22:00 the REBOKS counter freezes on its last value, so any number shown would describe an empty building. Forcing a `0` was rejected: that is a figure REBOKS never reported. Better to show nothing than to invent. |
| `/history` buckets anchor to 07:00 | Anchoring to even hours labelled the 07:00 readings as 06:00 - an hour when the gym is shut and every reading is a pre-reset zero. |
| Sample every 5 min, 06:00-23:59 SGT | The gyms open 07:00-22:00 SGT, so overnight rows carry no information. An hour of buffer either side captures the opening/closing transitions and tolerates holiday hour changes. Cron Triggers run on UTC, so the window is written shifted back 8 hours. |
| Serve `/gym` from D1, not a live scrape | With several users, scraping on every message would multiply load on a university server. Reading the latest stored row keeps REBOKS at a steady 12 requests/hour regardless of user count, and replies are instant. |
| Design for multiple users from the start | The bot will be shared with a small group and may grow. `/gym` is stateless so it scales for free; `/alert` will need a per-user table later. Cheap to allow for now, annoying to retrofit. |
| Track gyms only, not pools | This is a gym tracker. REBOKS publishes two pools; we parse them (that is what the `gymbox`/`swimbox` class is for) but do not store them, because unused rows are noise. Filtering on `kind` rather than a fixed ID list means a third gym would be picked up automatically. |
| `wrangler.toml`, not `wrangler.jsonc` | Cloudflare recommends JSON for new projects, but TOML is fully supported and takes comments, which is worth more here than access to config-only features we do not use. |
| Two vitest projects: `unit` and `worker` | Pure functions run in plain Node, fast, and can read the saved REBOKS fixture off disk. Anything needing real bindings - D1 queries, the webhook handler - runs inside workerd via `@cloudflare/vitest-pool-workers`. Deferring the pool was a mistake: the untested D1 layer is exactly where a real freshness bug hid. |
| Tests build their schema from the migration files | A hand-copied schema in the tests drifts from the real one silently, and a schema test that does not test the real schema is worse than none. |
| Alert on collection failure, opt-in via `ALERT_CHAT_ID` | Lost history cannot be recovered, so a silent collector is the worst failure mode. Re-alerting is suppressed during an ongoing outage by checking how old the newest stored row is - no extra table needed to remember that we already sent one. |
| Test against a real saved page | `tests/fixtures/capacity.html` is a genuine response, so the test fails if REBOKS changes its markup — handwritten HTML would only test our own assumptions. |
| `@types/node` in `tsconfig.json` | The test reads the fixture from disk. Slight downside: TypeScript will no longer stop you importing a Node API into Worker code, though `wrangler dev` would fail loudly if you did. |

## Current implementation state

```
Stage 0  Investigate REBOKS + build scraper     DONE
Stage 1  Move scraper into a Cloudflare Worker  DONE - runs locally
Stage 2  D1 schema + scheduled collection       DONE - deployed
Stage 3  Telegram /gym                          DONE - webhook registration pending
Stage 4  Historical analysis                    blocked on data
Stage 5  Prediction experiments                 blocked on Stage 4
```

## Important constraints

- **Do not build ahead of need.** Features come after the data that justifies them.
- **`0` is not trustworthy.** A gym reading `0` may be closed, empty, or have a broken
  counter, and the page cannot distinguish these. UTown read `0/120` all evening on
  2026-09-17 while USC was at 99%; that turned out to be a genuine closure (reopening
  18 Sep 2026), but only because someone knew — the page gave no signal. Store zeroes
  verbatim, never present them as "empty".
- **Compare percentages, not headcount.** The gyms have different capacities (120 vs
  110), so raw numbers are not comparable.
- **Gym opening hours are 07:00-22:00 SGT, daily.** Readings outside those hours are
  closure, not demand.
- **The number is a QR-scan proxy, not a headcount.** People scan in but usually not
  out, so it likely over-reports, increasingly so through the day. Present it as
  reported occupancy and lean on the gym-vs-gym comparison, which is counted the same
  way on both sides. See `docs/DATA-SOURCE.md`.
- **Be a polite client.** One request per 5 minutes, honest User-Agent, no retry storms.
  REBOKS is a university service, not an API product.
- **No secrets in the repository.** The Telegram bot token goes in Wrangler secrets.
- **Minimal dependencies.** Every added dependency needs a justification.
