import { createMiddleware } from "hono/factory";
import type { Context } from "hono";
import type { AppEnv } from "../types";

/**
 * Caller identity for rate limiting. `CF-Connecting-IP` is set by the edge and
 * cannot be spoofed by the client; the other headers are only a local-dev
 * convenience and are never present in production.
 */
export function clientKey(c: Context<AppEnv>): string {
  const cf = c.req.header("cf-connecting-ip");
  if (cf) return cf;
  const forwarded = c.req.header("x-forwarded-for")?.split(",")[0]?.trim();
  return forwarded || "unknown";
}

export interface RateLimitOptions {
  /** Namespaces the counter so separate endpoints do not share a bucket. */
  bucket: string;
}

/**
 * Rejects with 429 once the caller exceeds the limit configured for the
 * binding in wrangler.jsonc. Counters are per-colo, so this is an abuse
 * guard rather than an exact quota.
 *
 * Fails open: if the binding is missing the request is allowed through, since
 * losing rate limiting is better than losing the booking endpoint. TypeScript
 * guards against the binding actually going missing — `wrangler types` emits
 * it as a required member of `Cloudflare.Env`.
 */
export function rateLimit({ bucket }: RateLimitOptions) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const limiter = c.env.BOOK_RATE_LIMITER as RateLimit | undefined;
    if (!limiter) {
      console.warn(`rateLimit: BOOK_RATE_LIMITER binding missing, allowing ${bucket}`);
      return next();
    }

    const { success } = await limiter.limit({ key: `${bucket}:${clientKey(c)}` });
    if (!success) {
      return c.json({ error: "Too many requests. Please wait a moment and try again." }, 429, {
        "retry-after": "60",
      });
    }

    await next();
  });
}
