/**
 * Render a bot message from real data and send it to yourself.
 *
 * Whether a chart's columns line up depends on Telegram's font, not on our
 * code, so it is the one thing the tests cannot check. This builds the real
 * message from the live database and sends it through the real API, so it can
 * be looked at before deploying.
 *
 *   npm run preview history              # print it
 *   npm run preview -- history --send    # print it and send it to yourself
 *
 * Printing is the default and sending is opt-in, because `npm run` swallows
 * unrecognised flags: `npm run preview history --dry` silently drops --dry. If
 * a flag goes missing, not sending is the harmless outcome.
 *
 * Reads TELEGRAM_BOT_TOKEN and ALERT_CHAT_ID from .dev.vars (gitignored).
 */

import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");

function readDevVars() {
  const path = join(root, ".dev.vars");
  let contents;
  try {
    contents = readFileSync(path, "utf8");
  } catch {
    throw new Error("No .dev.vars found. Copy .dev.vars.example and fill it in.");
  }

  const vars = {};
  for (const line of contents.split(/\r?\n/)) {
    if (/^\s*#/.test(line) || !line.includes("=")) continue;
    const index = line.indexOf("=");
    vars[line.slice(0, index).trim()] = line.slice(index + 1).trim();
  }
  return vars;
}

/** Midnight Singapore time today, as a UTC timestamp. */
function startOfSgtDay(now = new Date()) {
  const sgt = new Date(now.getTime() + 8 * 3600_000);
  const midnight = Date.UTC(sgt.getUTCFullYear(), sgt.getUTCMonth(), sgt.getUTCDate());
  return new Date(midnight - 8 * 3600_000).toISOString();
}

function queryD1(sql) {
  // Run wrangler's JS entry with the current node rather than the `npx` shim:
  // on Windows that shim is a .cmd, which Node refuses to spawn without a
  // shell, and going through a shell would mean quoting the SQL by hand.
  const wrangler = join(root, "node_modules/wrangler/bin/wrangler.js");
  const output = execFileSync(
    process.execPath,
    [wrangler, "d1", "execute", "nus-gym-tracker", "--remote", "--command", sql, "--json"],
    { cwd: root, encoding: "utf8", maxBuffer: 32 * 1024 * 1024, stdio: ["ignore", "pipe", "ignore"] },
  );
  // Wrangler prints a banner before the JSON, so start at the first bracket.
  return JSON.parse(output.slice(output.indexOf("[")))[0].results;
}

/**
 * Bundle the formatters so Node can run them.
 *
 * Node 24 strips TypeScript types but will not resolve this project's
 * extensionless imports, and changing src/ to suit a dev script would be the
 * tail wagging the dog. esbuild is already present via wrangler.
 */
async function loadFormatters() {
  const esbuild = await import("esbuild");
  const built = await esbuild.build({
    entryPoints: [join(root, "src/telegram.ts")],
    bundle: true,
    format: "esm",
    platform: "neutral",
    write: false,
  });
  const source = Buffer.from(built.outputFiles[0].text).toString("base64");
  return import(`data:text/javascript;base64,${source}`);
}

// One line on purpose: wrangler does not accept a --command containing newlines.
const SELECT =
  "SELECT collected_at AS collectedAt, facility_id AS facilityId, " +
  "facility_name AS facilityName, occupancy, capacity FROM occupancy " +
  `WHERE collected_at >= '${startOfSgtDay()}' ORDER BY collected_at`;

async function main() {
  const command = process.argv[2] ?? "history";
  const send = process.argv.includes("--send");

  if (!["history", "gym"].includes(command)) {
    throw new Error(`Unknown command "${command}". Use history or gym.`);
  }

  const { formatGymMessage, formatHistoryMessage } = await loadFormatters();
  const rows = queryD1(SELECT);
  if (rows.length === 0) throw new Error("No readings today yet - nothing to preview.");

  const now = new Date();
  let text;
  if (command === "history") {
    text = formatHistoryMessage(rows, now);
  } else {
    // /gym reads only the newest row per gym.
    const newest = new Map();
    for (const row of rows) newest.set(row.facilityId, row);
    text = formatGymMessage([...newest.values()], now);
  }

  console.log(text);

  if (!send) {
    console.log("\n(not sent - run `npm run preview -- history --send` to deliver it)");
    return;
  }

  const vars = readDevVars();
  for (const key of ["TELEGRAM_BOT_TOKEN", "ALERT_CHAT_ID"]) {
    if (!vars[key]) throw new Error(`${key} is missing from .dev.vars`);
  }

  const response = await fetch(
    `https://api.telegram.org/bot${vars.TELEGRAM_BOT_TOKEN}/sendMessage`,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        chat_id: vars.ALERT_CHAT_ID,
        text,
        parse_mode: "HTML",
      }),
    },
  );

  const result = await response.json();
  console.log(result.ok ? "\nsent - check Telegram" : `\nfailed: ${JSON.stringify(result)}`);
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
