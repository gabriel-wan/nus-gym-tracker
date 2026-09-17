# NUS Gym Tracker

A Telegram bot that tracks how crowded NUS gyms are, and collects the history that NUS
itself does not keep.

NUS publishes live gym occupancy on the REBOKS capacity page, but only as a snapshot —
there is no history, so you cannot tell whether 7pm is always this bad. This project
samples that page every 15 minutes, stores the readings, and answers questions over
Telegram.

Currently tracking:

- University Town - Fitness gym
- University Sports Centre - Gym

## Status

**Stage 0 of 5 — the scraper works; nothing is deployed yet.**

```
[x] Stage 0  Investigate REBOKS, build scraper
[ ] Stage 1  Cloudflare Worker
[ ] Stage 2  D1 storage + 15-minute Cron Trigger
[ ] Stage 3  Telegram /gym
[ ] Stage 4  Historical analysis
```

## Try it

Requires Python 3 and `requests`:

```bash
python prototype/scrape.py
```

Example output:

```
Observed at 2026-09-17 20:41:03 SGT

[ 41] Kent Ridge - Swimming Pool: 107/250 (43%)
[ 25] University Town - Recreational swimming pool: 7/50 (14%)
[ 39] University Sports Centre - Gym: 108/110 (98%)
[ 26] University Town - Fitness gym: 0/120 (0%)
```

## How it works

```
REBOKS capacity page
        |  scrape every 15 min
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
| [docs/project.md](docs/project.md) | What this is, why it exists, decisions, constraints |
| [docs/architecture.md](docs/architecture.md) | How the components fit together and why |
| [docs/data-source.md](docs/data-source.md) | The REBOKS investigation — findings, assumptions, failure modes |
| [docs/TODO.md](docs/TODO.md) | What is next |

`docs/database.md` and `docs/deployment.md` will be added when D1 and deployment
actually exist.

## A note on the data

A reading of `0` cannot be trusted. The page gives no way to distinguish "closed" from
"empty" from "the counter is offline" — UTown reported `0/120` at peak evening while USC
was at 99%. See [docs/data-source.md](docs/data-source.md).

## Etiquette

REBOKS is a university service, not a public API. This project makes one request every
15 minutes with an honest User-Agent, and does not retry aggressively.
