// Bindings that `wrangler types` cannot always see: secrets are not in wrangler.jsonc,
// and RATE_LIMIT_MAX is only set in the test environment.
// Merged into the generated Cloudflare.Env in worker-configuration.d.ts.
declare namespace Cloudflare {
  interface Env {
    SESSION_SECRET: string;
    /** Optional per-environment override for the booking rate limit. */
    RATE_LIMIT_MAX?: string;
  }
}
