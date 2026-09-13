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
      },
    }),
  ],
  test: {
    setupFiles: ["./test/setup.ts"],
  },
});
