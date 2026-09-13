import path from "node:path";
import { defineConfig } from "vitest/config";
import { cloudflareTest, readD1Migrations } from "@cloudflare/vitest-pool-workers";

const migrations = await readD1Migrations(path.join(import.meta.dirname, "migrations"));

export default defineConfig({
  plugins: [
    cloudflareTest({
      wrangler: { configPath: "./wrangler.jsonc" },
      miniflare: {
        bindings: {
          SESSION_SECRET: "test-secret-do-not-use-in-prod",
          TEST_MIGRATIONS: migrations,
          // The suite books far more than 10 times a minute from one key.
          // The real limit is exercised in test/integration/rateLimit.test.ts.
          RATE_LIMIT_MAX: "1000000",
        },
        d1Databases: { DB: "meetflow-test" },
        durableObjects: { RATE_LIMITER: { className: "RateLimiter", useSQLite: true } },
      },
    }),
  ],
  test: {
    setupFiles: ["./test/setup.ts"],
  },
});
