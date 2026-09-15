// Bindings that `wrangler types` cannot always see: secrets are not in wrangler.jsonc,
// and RATE_LIMIT_OVERRIDES is normally only set in the test environment.
// Merged into the generated Cloudflare.Env in worker-configuration.d.ts.
declare namespace Cloudflare {
  interface Env {
    SESSION_SECRET: string;
    /**
     * Optional per-bucket rate limit overrides as JSON, e.g. `{"book":50}`.
     * Buckets are the keys of LIMITS in src/middleware/rateLimit.ts.
     */
    RATE_LIMIT_OVERRIDES?: string;
    /** Resend API key. Absent means email is switched off, not broken. */
    RESEND_API_KEY?: string;
    /**
     * Google Calendar OAuth app + token encryption key. All three absent means
     * the calendar connection is switched off and availability behaves as before.
     */
    GOOGLE_CLIENT_ID?: string;
    GOOGLE_CLIENT_SECRET?: string;
    GOOGLE_TOKEN_KEY?: string;
  }
}
