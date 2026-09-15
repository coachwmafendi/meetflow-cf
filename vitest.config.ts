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
          APP_URL: "https://example.com",
          GOOGLE_CLIENT_ID: "test-client-id",
          GOOGLE_CLIENT_SECRET: "test-client-secret",
          GOOGLE_TOKEN_KEY: btoa("0123456789abcdef0123456789abcdef"),
          TEST_MIGRATIONS: migrations,
          // The suite exercises each endpoint far above its production limit from a
          // single key, so lift every bucket. The real limits are exercised in
          // test/integration/rateLimit.test.ts and authRateLimit.test.ts, which
          // supply their own narrower overrides.
          RATE_LIMIT_OVERRIDES: JSON.stringify({
            book: 1_000_000,
            login: 1_000_000,
            register: 1_000_000,
            avatar: 1_000_000,
          }),
        },
        d1Databases: { DB: "meetflow-test" },
        durableObjects: { RATE_LIMITER: { className: "RateLimiter", useSQLite: true } },
        r2Buckets: { AVATARS: "meetflow-avatars-test" },
        queueProducers: { EMAIL_QUEUE: "meetflow-emails-test" },
      },
    }),
  ],
  test: {
    setupFiles: ["./test/setup.ts"],
    // Git worktrees under .worktrees/ carry their own copies of the suite.
    exclude: ["**/node_modules/**", ".worktrees/**"],
  },
});
