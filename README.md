# NUS Gym Tracker

A Telegram bot that tracks how crowded NUS gyms are, and collects the history that NUS
itself does not keep.

NUS publishes live gym occupancy on the REBOKS capacity page, but only as a snapshot —
there is no history, so you cannot tell whether 7pm is always this bad. This project
samples that page every 5 minutes, stores the readings, and answers questions over
Telegram.

Currently tracking:

- University Town - Fitness gym
- University Sports Centre - Gym

## Status

**Deployed and collecting. `/gym` works; the bot needs its webhook registered.**

```
[x] Stage 0  Investigate REBOKS, build scraper
[x] Stage 1  Cloudflare Worker
[x] Stage 2  D1 storage + cron
[x] Stage 3  Telegram /gym
[ ] Stage 4  Historical analysis
```

## Run it

The Worker, locally:

```bash
npm install
npx wrangler d1 migrations apply nus-gym-tracker --local
npm run dev
```

The migration only has to be run once. Local development keeps its own SQLite file
under `.wrangler/`, so none of this needs a Cloudflare account.

Then, in another terminal:

```bash
curl http://127.0.0.1:8787/health
curl "http://127.0.0.1:8787/cdn-cgi/local/scheduled"
```

The second URL manually fires the cron handler, which is how Wrangler lets you test a
scheduled run without waiting for the next slot. It scrapes REBOKS and writes a row per gym.

`/health` then reads those rows back out of D1 — so an empty response means the
collector has not run, not that the gyms are empty.

REBOKS also publishes two swimming pools. This project parses them but does not track
them — it is a gym tracker. The Python prototype predates that decision and still prints
everything:

```bash
python prototype/scrape.py
```

```
Observed at 2026-09-17 21:08:10 SGT

[ 41] Kent Ridge - Swimming Pool: 100/250 (40%)
[ 25] University Town - Recreational swimming pool: 8/50 (16%)
[ 39] University Sports Centre - Gym: 106/110 (96%)
[ 26] University Town - Fitness gym: 0/120 (0%)
```

UTown showing `0/120` there is correct — the gym was closed, reopening 18 Sep 2026.

## Layout

```
src/index.ts        Worker entry: scheduled() + fetch()
src/reboks.ts       fetch + parse the REBOKS page
src/db.ts           read/write occupancy history in D1
src/telegram.ts     bot replies and the Telegram Bot API
tests/              parser tests against a real saved page
migrations/         D1 schema
prototype/          the original Python scraper
docs/               why things are the way they are
```

| Command | What it does |
|---|---|
| `npm run dev` | Worker locally via Wrangler |
| `npm test` | parser tests |
| `npm run typecheck` | TypeScript, no emit |
| `npm run deploy` | push to Cloudflare (needs an account) |

## How it works

```
REBOKS capacity page
        |  scrape every 5 min
        v
Cloudflare Worker  -->  D1 (history)
        ^                  |
        |  webhook         v
     Telegram  <--------  reply
```

The data source is a public, unauthenticated page. No NUS login is involved.

## Documentation

| File | Contents |
|---|---|
| [docs/PROJECT.md](docs/PROJECT.md) | What this is, why it exists, decisions, constraints |
| [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) | How the components fit together and why |
| [docs/DATA-SOURCE.md](docs/DATA-SOURCE.md) | The REBOKS investigation — findings, assumptions, failure modes |
| [docs/DATABASE.md](docs/DATABASE.md) | Schema, why each column exists, why the index |
| [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md) | Cloudflare, D1, secrets, webhook, cron |
| [docs/TODO.md](docs/TODO.md) | What is next |

## A note on the data

A reading of `0` cannot be trusted on its own. The page gives no way to distinguish
"closed" from "empty" from "the counter is offline" — UTown reported `0/120` at peak
evening while USC was at 99%. That case turned out to be a genuine closure, but only
because we were told; the page itself showed nothing. See
[docs/DATA-SOURCE.md](docs/DATA-SOURCE.md).

## Etiquette

REBOKS is a university service, not a public API. This project makes one request every
5 minutes with an honest User-Agent, and does not retry aggressively.
