import { cloudflareTest } from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    projects: [
      // Pure functions: parsing and message formatting. Plain Node, fast, and
      // able to read the saved REBOKS fixture off disk.
      {
        test: { name: "unit", include: ["tests/*.test.ts"] },
      },
      // Anything needing real Worker bindings - D1 queries, the webhook handler
      // - runs inside workerd against a real local database.
      {
        plugins: [
          cloudflareTest({
            wrangler: { configPath: "./wrangler.toml" },
            miniflare: {
              // The workerd bundled with the test pool lags the date we pin in
              // production, and refuses to boot on a future one. Tests run on
              // the newest it supports; wrangler.toml stays authoritative for
              // the deployed Worker.
              compatibilityDate: "2026-08-22",
            },
          }),
        ],
        test: {
          name: "worker",
          include: ["tests/worker/**/*.test.ts"],
          setupFiles: ["./tests/worker/setup.ts"],
        },
      },
    ],
  },
});
