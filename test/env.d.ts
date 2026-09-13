declare module "cloudflare:test" {
  interface ProvidedEnv extends import("../src/types").Env {
    TEST_MIGRATIONS: D1Migration[];
  }
}
