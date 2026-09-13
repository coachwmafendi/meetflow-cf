// Bindings that `wrangler types` cannot see: secrets are not in wrangler.jsonc.
// Merged into the generated Cloudflare.Env in worker-configuration.d.ts.
declare namespace Cloudflare {
  interface Env {
    SESSION_SECRET: string;
  }
}
