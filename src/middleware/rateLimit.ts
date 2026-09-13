import { createMiddleware } from "hono/factory";
import type { Context } from "hono";
import type { AppEnv } from "../types";

/**
 * Caller identity for rate limiting. `CF-Connecting-IP` is set by the edge and
 * cannot be spoofed by the client; the other header is only a local-dev
 * convenience and is never trusted in production.
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
  /** Requests allowed per window. Overridable per-environment via RATE_LIMIT_MAX. */
  limit: number;
  /** Window length in seconds. */
  periodSeconds?: number;
}

/**
 * Rejects with 429 once a caller exceeds `limit` requests per window.
 *
 * Backed by the RateLimiter Durable Object: one instance per `bucket:ip`, so the
 * counter is exact and global rather than per-colo. Fails open if the binding is
 * missing — losing rate limiting beats losing the booking endpoint.
 */
export function rateLimit({ bucket, limit, periodSeconds = 60 }: RateLimitOptions) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const namespace = c.env.RATE_LIMITER as DurableObjectNamespace<
      import("../rateLimiter").RateLimiter
    > | undefined;

    if (!namespace) {
      console.warn(`rateLimit: RATE_LIMITER binding missing, allowing ${bucket}`);
      return next();
    }

    const override = Number(c.env.RATE_LIMIT_MAX);
    const effectiveLimit = Number.isFinite(override) && override > 0 ? override : limit;

    const key = `${bucket}:${clientKey(c)}`;
    const stub = namespace.get(namespace.idFromName(key));
    const { success, resetAt } = await stub.hit(effectiveLimit, periodSeconds);

    if (!success) {
      const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
      return c.json({ error: "Too many requests. Please wait a moment and try again." }, 429, {
        "retry-after": String(retryAfter),
      });
    }

    await next();
  });
}
