import { env, runInDurableObject } from "cloudflare:test";
import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { rateLimit } from "../../src/middleware/rateLimit";
import type { RateLimiter } from "../../src/rateLimiter";
import type { AppEnv } from "../../src/types";

function stub(name: string) {
  return env.RATE_LIMITER.get(env.RATE_LIMITER.idFromName(name));
}

describe("RateLimiter durable object", () => {
  it("allows exactly `limit` hits then rejects", async () => {
    const id = env.RATE_LIMITER.idFromName("do:allow-then-reject");
    const results: boolean[] = [];
    await runInDurableObject<RateLimiter, void>(env.RATE_LIMITER.get(id), async (instance) => {
      for (let i = 0; i < 5; i++) {
        results.push((await instance.hit(3, 60, 1_000_000)).success);
      }
    });
    expect(results).toEqual([true, true, true, false, false]);
  });

  it("reports remaining and resetAt", async () => {
    const id = env.RATE_LIMITER.idFromName("do:remaining");
    await runInDurableObject<RateLimiter, void>(env.RATE_LIMITER.get(id), async (instance) => {
      const first = await instance.hit(3, 60, 1_000_000);
      expect(first).toMatchObject({ success: true, remaining: 2 });
      // 1_000_000ms floors to window start 960_000 for a 60s period.
      expect(first.resetAt).toBe(1_020_000);

      const second = await instance.hit(3, 60, 1_000_000);
      expect(second.remaining).toBe(1);
    });
  });

  it("resets when the window rolls over", async () => {
    const id = env.RATE_LIMITER.idFromName("do:rollover");
    await runInDurableObject<RateLimiter, void>(env.RATE_LIMITER.get(id), async (instance) => {
      expect((await instance.hit(1, 60, 1_000_000)).success).toBe(true);
      expect((await instance.hit(1, 60, 1_000_000)).success).toBe(false);
      // Next window.
      expect((await instance.hit(1, 60, 1_090_000)).success).toBe(true);
    });
  });

  it("keeps separate keys independent", async () => {
    const a = await stub("do:key-a").hit(1, 60, 1_000_000);
    const b = await stub("do:key-b").hit(1, 60, 1_000_000);
    expect([a.success, b.success]).toEqual([true, true]);
    expect((await stub("do:key-a").hit(1, 60, 1_000_000)).success).toBe(false);
  });
});

describe("rateLimit middleware", () => {
  function app(limit: number) {
    const a = new Hono<AppEnv>();
    a.post("/book", rateLimit({ bucket: "book", limit }), (c) => c.json({ ok: true }, 201));
    return a;
  }

  // RATE_LIMIT_MAX is set very high for the rest of the suite, so exercise the
  // middleware against an env where the configured limit is the one under test.
  function testEnv(max: string) {
    return { ...env, RATE_LIMIT_MAX: max } as unknown as AppEnv["Bindings"];
  }

  it("returns 429 with Retry-After once over the limit", async () => {
    const a = app(2);
    const headers = { "cf-connecting-ip": "203.0.113.41" };
    const e = testEnv("2");

    expect((await a.request("/book", { method: "POST", headers }, e)).status).toBe(201);
    expect((await a.request("/book", { method: "POST", headers }, e)).status).toBe(201);

    const blocked = await a.request("/book", { method: "POST", headers }, e);
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(await blocked.json()).toMatchObject({
      error: "Too many requests. Please wait a moment and try again.",
    });
  });

  it("limits per client IP, not globally", async () => {
    const a = app(1);
    const e = testEnv("1");
    const hit = (ip: string) =>
      a.request("/book", { method: "POST", headers: { "cf-connecting-ip": ip } }, e);

    expect((await hit("203.0.113.60")).status).toBe(201);
    expect((await hit("203.0.113.60")).status).toBe(429);
    // A different caller is unaffected.
    expect((await hit("203.0.113.61")).status).toBe(201);
  });

  it("ignores a client-supplied X-Forwarded-For when the edge IP is present", async () => {
    const a = app(1);
    const e = testEnv("1");
    const headers = { "cf-connecting-ip": "203.0.113.70", "x-forwarded-for": "198.51.100.1" };

    expect((await a.request("/book", { method: "POST", headers }, e)).status).toBe(201);
    // Changing X-Forwarded-For must not buy a fresh bucket.
    expect(
      (
        await a.request(
          "/book",
          { method: "POST", headers: { ...headers, "x-forwarded-for": "198.51.100.99" } },
          e,
        )
      ).status,
    ).toBe(429);
  });

  it("does not share a counter between buckets", async () => {
    const e = testEnv("1");
    const headers = { "cf-connecting-ip": "203.0.113.80" };

    const book = new Hono<AppEnv>();
    book.post("/x", rateLimit({ bucket: "book", limit: 1 }), (c) => c.json({ ok: true }, 201));
    const slots = new Hono<AppEnv>();
    slots.post("/x", rateLimit({ bucket: "slots", limit: 1 }), (c) => c.json({ ok: true }, 201));

    expect((await book.request("/x", { method: "POST", headers }, e)).status).toBe(201);
    expect((await book.request("/x", { method: "POST", headers }, e)).status).toBe(429);
    expect((await slots.request("/x", { method: "POST", headers }, e)).status).toBe(201);
  });

  it("fails open when the binding is missing", async () => {
    const a = app(1);
    const e = { ...env, RATE_LIMITER: undefined } as unknown as AppEnv["Bindings"];
    const headers = { "cf-connecting-ip": "203.0.113.90" };
    expect((await a.request("/book", { method: "POST", headers }, e)).status).toBe(201);
    expect((await a.request("/book", { method: "POST", headers }, e)).status).toBe(201);
  });
});
