# Deployment

Everything runs on Cloudflare's free plan. There is no server to maintain: the Worker
only exists while it is handling a cron run or a Telegram message.

## One-time setup

### 1. Cloudflare account and login

Sign up at [dash.cloudflare.com](https://dash.cloudflare.com), then:

```bash
npx wrangler login
```

This opens a browser and stores the credential locally. Nothing is kept in the repo.

### 2. Create the database

```bash
npx wrangler d1 create nus-gym-tracker
```

It prints a `database_id`. Put it in `wrangler.toml` under `[[d1_databases]]`.

**The id is not a secret.** It identifies the database; it does not grant access to it.
Cloudflare's own documentation has you commit it, and it is committed here.

### 3. Create the tables

```bash
npx wrangler d1 migrations apply nus-gym-tracker --remote
```

Without `--remote`, wrangler applies migrations to a local SQLite file instead. That
local database is keyed by `database_id`, so **changing the id in `wrangler.toml` points
local development at a different, empty database** and you have to re-run the migration
locally. This is confusing the first time it happens.

### 4. Store the secrets

Two of them, both entered interactively and stored encrypted by Cloudflare:

```bash
npx wrangler secret put TELEGRAM_BOT_TOKEN       # from @BotFather
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET  # any long random string you invent
```

Secrets attach to a Worker, so if you have not deployed yet, wrangler offers to create an
empty Worker to hold them. Saying yes is fine — the first real deploy fills it in.

Neither value can be read back afterwards, only overwritten. Neither belongs in git.

For local development the same two names go in `.dev.vars`, which is gitignored:

```
TELEGRAM_BOT_TOKEN=...
TELEGRAM_WEBHOOK_SECRET=...
```

### 5. Deploy

```bash
npm run deploy
```

This uploads the Worker and registers the cron trigger from `wrangler.toml`. It prints
the public URL, of the form `https://nus-gym-tracker.<subdomain>.workers.dev`.

From this point the collector runs on Cloudflare's schedule whether or not your computer
is on.

### 6. Point Telegram at the Worker

Telegram has to be told where to deliver messages. Once, with your own values:

```bash
curl -X POST "https://api.telegram.org/bot<BOT_TOKEN>/setWebhook" \
  -H "content-type: application/json" \
  -d '{"url":"https://<your-worker>.workers.dev/telegram","secret_token":"<WEBHOOK_SECRET>"}'
```

`secret_token` is the important part. Telegram sends it back in an
`X-Telegram-Bot-Api-Secret-Token` header on every request, and the Worker rejects
anything that does not match. Without it, anyone who found the URL could feed the bot
fake messages.

Check it took:

```bash
curl "https://api.telegram.org/bot<BOT_TOKEN>/getWebhookInfo"
```

`pending_update_count` climbing, or a populated `last_error_message`, means Telegram is
trying to deliver and failing.

## Everyday commands

| Command | What it does |
|---|---|
| `npm run dev` | Worker locally, with a local D1 |
| `npm test` | parser and message-formatting tests |
| `npm run typecheck` | TypeScript, no emit |
| `npm run deploy` | publish to Cloudflare |
| `npx wrangler tail` | live logs from the deployed Worker |

## Checking it is alive

```bash
curl https://<your-worker>.workers.dev/health
```

It reads the newest rows out of D1, so `{"ok":false,"gyms":[]}` means **the collector has
not run**, not that the gyms are empty.

To look at the data directly:

```bash
npx wrangler d1 execute nus-gym-tracker --remote \
  --command "SELECT COUNT(*) AS rows, MAX(collected_at) AS last FROM occupancy;"
```

## The cron

```toml
[triggers]
crons = ["*/15 0-15,22-23 * * *"]
```

Every 15 minutes, during UTC hours 0–15 and 22–23, which is 06:00–23:59 Singapore time.
**Cron Triggers run on UTC**, so the Singapore window has to be written shifted back
8 hours. See `docs/ARCHITECTURE.md`.

A newly registered trigger does not necessarily fire at the very next quarter hour — give
it a cycle or two before concluding something is broken, and check `npx wrangler tail`.

Cloudflare does not guarantee a cron fires exactly on time, and runs can be skipped, so
rows are stamped with the observed time rather than the scheduled one.
