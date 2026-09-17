import { env } from "cloudflare:test";
import { beforeEach } from "vitest";

import migration0001 from "../../migrations/0001_create_occupancy.sql?raw";
import migration0002 from "../../migrations/0002_rename_observed_to_collected.sql?raw";

/**
 * Build each test's database from the real migration files.
 *
 * Copying the schema into the tests would let it drift from the migrations
 * silently, and a schema test that does not test the real schema is worse than
 * none. Each test file gets its own isolated D1, so this runs per file.
 */
const MIGRATIONS = [migration0001, migration0002];

function statementsIn(sql: string): string[] {
  return sql
    .replace(/--[^\n]*/g, "") // strip comments; D1's exec does not like them
    .split(";")
    .map((statement) => statement.replace(/\s+/g, " ").trim())
    .filter(Boolean);
}

beforeEach(async () => {
  await env.DB.exec("DROP TABLE IF EXISTS occupancy");
  for (const migration of MIGRATIONS) {
    for (const statement of statementsIn(migration)) {
      await env.DB.exec(statement);
    }
  }
});
