// Test-only binding, injected by vitest.config.ts so setup.ts can apply migrations.
declare namespace Cloudflare {
  interface Env {
    TEST_MIGRATIONS: import("@cloudflare/vitest-pool-workers").D1Migration[];
  }
}
