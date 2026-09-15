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
  /** Requests allowed per window. Overridable per-bucket via RATE_LIMIT_OVERRIDES. */
  limit: number;
  /** Window length in seconds. */
  periodSeconds?: number;
  /**
   * Renders the rejection. Defaults to JSON; HTML form routes pass a renderer so
   * a throttled human sees the page again rather than a bare JSON blob.
   */
  onLimited?: (c: Context<AppEnv>, retryAfterSeconds: number) => Response;
}

/**
 * Shared limit definitions. The JSON API and the HTML form for a given action
 * MUST use the same bucket, otherwise an attacker doubles their budget by
 * alternating between the two entry points.
 */
export const LIMITS = {
  /** Unauthenticated write. */
  book: { bucket: "book", limit: 10, periodSeconds: 60 },
  /**
   * Every attempt runs PBKDF2 (100k iterations) even for an unknown email, so
   * this caps CPU burn as much as it caps credential stuffing. Ten a minute is
   * far above what a human retrying a password needs.
   */
  login: { bucket: "login", limit: 10, periodSeconds: 60 },
  /** Account creation also runs PBKDF2, and bulk signups are pure spam. */
  register: { bucket: "register", limit: 5, periodSeconds: 3600 },
  /** Authenticated, but each upload writes up to 2MB to R2. */
  avatar: { bucket: "avatar", limit: 20, periodSeconds: 3600 },
  /**
   * Unauthenticated: the signed link is the only credential, so cap how fast
   * tokens can be tried even though forging one requires the secret.
   */
  guestCancel: { bucket: "guest-cancel", limit: 20, periodSeconds: 60 },
  /** Keystroke-driven: 60/min per host is far above human typing, well below abuse. */
  search: { bucket: "search", limit: 60, periodSeconds: 60 },
} as const satisfies Record<string, { bucket: string; limit: number; periodSeconds: number }>;

/** Bucket names the overrides map is allowed to mention. */
const KNOWN_BUCKETS: ReadonlySet<string> = new Set(
  Object.values(LIMITS).map((definition) => definition.bucket),
);

// Overrides rarely change, so parse once per distinct value rather than per request.
let cachedRaw: string | undefined | null = null;
let cachedOverrides: ReadonlyMap<string, number> = new Map();

/**
 * Parses RATE_LIMIT_OVERRIDES, a JSON object of bucket name to request limit —
 * for example `{"book":50}`.
 *
 * Deliberately per-bucket: a single global override is a footgun, because
 * raising one endpoint's limit would silently raise every other endpoint's too,
 * including the auth limits that cap PBKDF2 CPU burn.
 *
 * Anything malformed is ignored rather than throwing, and rather than being
 * treated as "unlimited": a bad value must never be able to disable a limit.
 */
export function parseRateLimitOverrides(raw: string | undefined): ReadonlyMap<string, number> {
  const result = new Map<string, number>();
  if (!raw) return result;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    console.warn("rateLimit: RATE_LIMIT_OVERRIDES is not valid JSON, ignoring it");
    return result;
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    console.warn("rateLimit: RATE_LIMIT_OVERRIDES must be a JSON object, ignoring it");
    return result;
  }

  for (const [bucket, value] of Object.entries(parsed as Record<string, unknown>)) {
    if (!KNOWN_BUCKETS.has(bucket)) {
      console.warn(`rateLimit: RATE_LIMIT_OVERRIDES names unknown bucket "${bucket}", ignoring it`);
      continue;
    }
    if (typeof value !== "number" || !Number.isInteger(value) || value <= 0) {
      console.warn(`rateLimit: RATE_LIMIT_OVERRIDES["${bucket}"] is not a positive integer`);
      continue;
    }
    result.set(bucket, value);
  }

  return result;
}

function overridesFor(raw: string | undefined): ReadonlyMap<string, number> {
  if (raw === cachedRaw) return cachedOverrides;
  cachedRaw = raw;
  cachedOverrides = parseRateLimitOverrides(raw);
  return cachedOverrides;
}

/**
 * Rejects with 429 once a caller exceeds `limit` requests per window.
 *
 * Backed by the RateLimiter Durable Object: one instance per `bucket:ip`, so the
 * counter is exact and global rather than per-colo. Fails open if the binding is
 * missing — losing rate limiting beats losing the booking endpoint.
 */
export function rateLimit({ bucket, limit, periodSeconds = 60, onLimited }: RateLimitOptions) {
  return createMiddleware<AppEnv>(async (c, next) => {
    const namespace = c.env.RATE_LIMITER as
      DurableObjectNamespace<import("../rateLimiter").RateLimiter> | undefined;

    if (!namespace) {
      console.warn(`rateLimit: RATE_LIMITER binding missing, allowing ${bucket}`);
      return next();
    }

    const effectiveLimit = overridesFor(c.env.RATE_LIMIT_OVERRIDES).get(bucket) ?? limit;

    const key = `${bucket}:${clientKey(c)}`;
    const stub = namespace.get(namespace.idFromName(key));
    const { success, resetAt } = await stub.hit(effectiveLimit, periodSeconds);

    if (!success) {
      const retryAfter = Math.max(1, Math.ceil((resetAt - Date.now()) / 1000));
      if (onLimited) {
        const res = onLimited(c, retryAfter);
        res.headers.set("retry-after", String(retryAfter));
        return res;
      }
      return c.json({ error: "Too many requests. Please wait a moment and try again." }, 429, {
        "retry-after": String(retryAfter),
      });
    }

    await next();
  });
}
