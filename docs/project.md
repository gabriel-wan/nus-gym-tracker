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

1. Reliably read live occupancy from REBOKS. **(done — Stage 0)**
2. Collect it automatically so history accumulates.
3. Expose the current reading over Telegram via `/gym`.

Everything else waits until there is data to justify it.

## Current features

- A local Python prototype that fetches the REBOKS capacity page and prints occupancy,
  capacity, facility ID and timestamp for all four published facilities.
- A Cloudflare Worker skeleton with the scraper ported to TypeScript, a `/health`
  endpoint returning live gym occupancy as JSON, and a `scheduled()` handler wired to a
  15-minute cron. Both entry points run under `wrangler dev`.
- Eight parser tests against a real saved REBOKS response.

Nothing is deployed, and nothing is stored yet — `scheduled()` currently logs instead of
writing to D1.

## Planned features

| Command | Purpose | Requires |
|---|---|---|
| `/gym` | current occupancy for both gyms | Worker + Telegram |
| `/history` | typical crowding by hour/day | weeks of collected data |
| `/best` | quietest time today | historical patterns |
| `/predict` | occupancy 30/60/90 min ahead | modelling, and a baseline to beat |
| `/alert` | notify when a gym drops below a threshold | per-user state |

`/gym` is the only one in scope now. The rest are blocked on data we do not have yet.

## Technical decisions

| Decision | Reasoning |
|---|---|
| Scrape HTML, not JSON | A JSON API is referenced in REBOKS's own JavaScript but every endpoint returns 404, identical to a nonexistent route. See `docs/data-source.md`. |
| Regex over an HTML parser | The markup is machine-generated, uniform and unnested. Adding a parser dependency would buy nothing. |
| Python prototype first | Stage 0 is about understanding the data source. Doing that locally avoids learning Cloudflare and REBOKS at the same time. |
| Cloudflare Workers + D1 | The workload is one request every 15 minutes. Free tier covers it with ~250× headroom, and D1 binds to the Worker with no extra credentials. |
| Telegram webhooks, not long polling | Long polling needs an always-on process, which would rule out serverless entirely. |
| Store `capacity` per observation | Capacity is a property of the moment, not the facility, and appears to change over time. |
| Store observed timestamp, not scheduled time | Cron Triggers are not guaranteed to fire on time, so the schedule is not a reliable clock. |
| Store UTC | Unambiguous and immune to any future timezone handling mistakes; convert to SGT only for display. |
| No ML yet | There is no historical data to train or evaluate on. |
| Sample 06:00-23:59 SGT, not 24/7 | The gyms open 07:00-22:00 SGT, so overnight rows carry no information. An hour of buffer either side captures the opening/closing transitions and tolerates holiday hour changes. Cron Triggers run on UTC, so the window is written shifted back 8 hours. |
| Serve `/gym` from D1, not a live scrape | With several users, scraping on every message would multiply load on a university server. Reading the latest stored row keeps REBOKS at a steady 4 requests/hour regardless of user count, and replies are instant. |
| Design for multiple users from the start | The bot will be shared with a small group and may grow. `/gym` is stateless so it scales for free; `/alert` will need a per-user table later. Cheap to allow for now, annoying to retrofit. |
| Track gyms only, not pools | This is a gym tracker. REBOKS publishes two pools; we parse them (that is what the `gymbox`/`swimbox` class is for) but do not store them, because unused rows are noise. Filtering on `kind` rather than a fixed ID list means a third gym would be picked up automatically. |
| `wrangler.toml`, not `wrangler.jsonc` | Cloudflare recommends JSON for new projects, but TOML is fully supported and takes comments, which is worth more here than access to config-only features we do not use. |
| Plain `vitest`, not `@cloudflare/vitest-pool-workers` | The parser is a pure function and needs no Workers runtime. The Workers test pool only becomes worthwhile when there are D1 bindings to test. |
| Test against a real saved page | `tests/fixtures/capacity.html` is a genuine response, so the test fails if REBOKS changes its markup — handwritten HTML would only test our own assumptions. |
| `@types/node` in `tsconfig.json` | The test reads the fixture from disk. Slight downside: TypeScript will no longer stop you importing a Node API into Worker code, though `wrangler dev` would fail loudly if you did. |

## Current implementation state

```
Stage 0  Investigate REBOKS + build scraper     DONE
Stage 1  Move scraper into a Cloudflare Worker  IN PROGRESS - runs locally, not deployed
Stage 2  D1 schema + scheduled collection       not started
Stage 3  Telegram /gym                          not started
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
- **Be a polite client.** One request per 15 minutes, honest User-Agent, no retry storms.
  REBOKS is a university service, not an API product.
- **No secrets in the repository.** The Telegram bot token goes in Wrangler secrets.
- **Minimal dependencies.** Every added dependency needs a justification.
