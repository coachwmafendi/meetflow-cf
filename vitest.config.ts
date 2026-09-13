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
        },
        d1Databases: { DB: "meetflow-test" },
        // Effectively unlimited: the suite books far more than 10 times a minute
        // from one key. The 429 path is covered in test/unit/rateLimit.test.ts.
        ratelimits: {
          BOOK_RATE_LIMITER: {
            namespace_id: "1001",
            simple: { limit: 1_000_000, period: 60 },
          },
        },
      },
    }),
  ],
  test: {
    setupFiles: ["./test/setup.ts"],
  },
});
