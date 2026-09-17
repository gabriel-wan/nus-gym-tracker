# Architecture

## Current state (Stage 0)

There is no architecture yet — only a local Python script that proves the data can be
read:

```
REBOKS capacity page  ──GET──>  prototype/scrape.py  ──>  stdout
```

Nothing is deployed, nothing is stored. That is deliberate: the point of Stage 0 was to
find out whether the data source is usable at all before committing to a stack.

## Target architecture

Two independent flows. They share a Worker and a database, but never wait on each other.

### Collecting — runs on a timer, nobody triggers it

```
   Cron Trigger  (every 5 min, 06:00-23:59 SGT)
        |  wakes
        v
   Cloudflare Worker  ──── HTTPS GET ────>  REBOKS capacity page
        |                                        |
        |<──────────────── HTML ─────────────────+
        |  parse, keep the two gyms
        v
   D1   one row per gym per scrape
```

### Answering — runs when someone messages the bot

```
   User types /gym
        |
        v
   Telegram  ──── POST (webhook) ────>  Cloudflare Worker
                                             |  SELECT newest row per gym
                                             v
                                            D1
                                             |  format the reply
                                             v
   User  <──── delivers ────  Telegram  <──── POST sendMessage
```

The only arrow that touches NUS is in the first diagram. `/gym` never reaches REBOKS —
it reads what the collector already stored, so REBOKS sees the same 12 requests an hour
whether one person uses the bot or a hundred.

## Why each component exists

### Cron Trigger

REBOKS publishes a snapshot and no history. Nobody is storing this data over time, so
if we want to answer "when is the gym quiet?" we have to build the history ourselves.
The Cron Trigger is what turns a one-off reading into a time series.

Sampling runs every 5 minutes. 15 was the original interval and was adequate for "should
I go now", but the finer grid gives the historical work a much better curve to fit, and
the cost is still negligible: 216 samples a day against a 100,000-request allowance.

The gyms open 07:00–22:00 SGT, so there is nothing to learn overnight — the cron runs
06:00–23:59 SGT only, which is 216 samples a day rather than 288. The hour of buffer at
each end is deliberate: it captures the opening and closing transitions, and it means a
holiday or exam-period change to the hours still lands inside the window instead of
silently falling outside it.

Because Cron Triggers execute on **UTC**, that window is written shifted back 8 hours
(`*/5 0-15,22-23 * * *`). Getting this wrong would silently sample the wrong half of
the day, so `wrangler.toml` spells out the conversion.

**Scheduled runs are not precise.** Cloudflare does not guarantee a cron fires at exactly
`:00/:15/:30/:45`, and a run can be delayed or skipped. This is why the database stores
the *observed* timestamp taken at scrape time rather than assuming a tidy grid — any
later analysis must treat the samples as irregular.

### Cloudflare Worker

The Worker is the only compute in the system, and it handles both directions:

- **`scheduled()`** — invoked by the Cron Trigger. Fetches REBOKS, parses, writes to D1.
- **`fetch()`** — invoked by Telegram's webhook. Reads D1, replies to the user.

One deployment, one codebase, two entry points. Workers were chosen over a traditional
always-on server because nothing here needs to stay running: both paths are short,
event-driven, and idle almost all the time.

### D1

D1 is Cloudflare's managed SQLite. It is chosen mainly because it binds directly to the
Worker with no extra account, connection string, or credentials to manage.

The data is small and relational and the questions are aggregate ones ("average
occupancy at Thursday 7pm"), which is exactly what SQL is good at.

D1 also protects REBOKS once the bot has more than one user. If `/gym` scraped REBOKS on
every message, ten people checking at 6pm would mean ten requests to a university server
that owes us nothing. Serving `/gym` from the most recent stored row instead means
REBOKS sees a steady 12 requests an hour no matter how many people use the bot — and
users get an instant reply rather than waiting on a round trip to NUS.

### Telegram webhook (not long polling)

Telegram offers two ways to receive messages:

- **Long polling** — your program repeatedly asks Telegram "any new messages?". This
  requires a process running continuously.
- **Webhook** — Telegram sends an HTTP POST to your URL when a message arrives.

Webhooks are the reason this project can be serverless. A Worker cannot sit in a polling
loop, but it handles an incoming POST perfectly. Long polling would force us onto an
always-on host, which is the thing we are avoiding.

## Why this fits comfortably in the free tier

Verified against Cloudflare's official documentation, not third-party summaries:

| Limit (Workers/D1 Free) | Official value | Our expected usage |
|---|---|---|
| Worker requests | 100,000 / day | 216 cron runs + bot messages |
| CPU time per invocation | 10 ms | regex over 16 KB is far below this |
| Cron Triggers | 5 per account | 1 |
| D1 rows written | 100,000 / day | 2 gyms × 216 = **432** |
| D1 rows read | 5 million / day | trivial |
| D1 storage | 5 GB per account | ~12 MB per year of history |
| D1 queries per invocation | 50 | 1 batched insert |

The headroom is roughly 230× on the tightest limit (rows written). Note that waiting on
the REBOKS response is I/O, not CPU, so it does not count against the 10 ms CPU budget.

Sources: [Workers limits](https://developers.cloudflare.com/workers/platform/limits/),
[D1 limits](https://developers.cloudflare.com/d1/platform/limits/),
[D1 pricing](https://developers.cloudflare.com/d1/platform/pricing/).

## Deliberate non-goals

No Docker, no queues, no Redis, no CI/CD, no auth, no frontend. The workload is one HTTP
request every 5 minutes. Anything more than a Worker and a table would be architecture
for its own sake.
