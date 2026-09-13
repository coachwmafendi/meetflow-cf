import { Hono } from "hono";
import { describe, expect, it } from "vitest";
import { rateLimit } from "../../src/middleware/rateLimit";
import type { AppEnv } from "../../src/types";

interface StubLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

function harness(limiter: StubLimiter | undefined) {
  const app = new Hono<AppEnv>();
  app.post("/book", rateLimit({ bucket: "book" }), (c) => c.json({ ok: true }, 201));
  return (headers: Record<string, string> = {}) =>
    app.request(
      "/book",
      { method: "POST", headers },
      { BOOK_RATE_LIMITER: limiter } as unknown as AppEnv["Bindings"],
    );
}

function recording(success: boolean) {
  const keys: string[] = [];
  const limiter: StubLimiter = {
    async limit({ key }) {
      keys.push(key);
      return { success };
    },
  };
  return { limiter, keys };
}

describe("rateLimit middleware", () => {
  it("passes the request through when under the limit", async () => {
    const { limiter } = recording(true);
    const res = await harness(limiter)({ "cf-connecting-ip": "203.0.113.7" });
    expect(res.status).toBe(201);
    expect(await res.json()).toEqual({ ok: true });
  });

  it("returns 429 with Retry-After once over the limit", async () => {
    const { limiter } = recording(false);
    const res = await harness(limiter)({ "cf-connecting-ip": "203.0.113.7" });
    expect(res.status).toBe(429);
    expect(res.headers.get("retry-after")).toBe("60");
    expect(await res.json()).toMatchObject({
      error: "Too many requests. Please wait a moment and try again.",
    });
  });

  it("does not run the handler when rejected", async () => {
    let handlerRan = false;
    const app = new Hono<AppEnv>();
    app.post("/book", rateLimit({ bucket: "book" }), (c) => {
      handlerRan = true;
      return c.json({ ok: true }, 201);
    });
    const { limiter } = recording(false);
    await app.request(
      "/book",
      { method: "POST" },
      { BOOK_RATE_LIMITER: limiter } as unknown as AppEnv["Bindings"],
    );
    expect(handlerRan).toBe(false);
  });

  it("keys on the edge-supplied client IP, namespaced by bucket", async () => {
    const { limiter, keys } = recording(true);
    await harness(limiter)({ "cf-connecting-ip": "203.0.113.7" });
    expect(keys).toEqual(["book:203.0.113.7"]);
  });

  it("prefers CF-Connecting-IP over a client-supplied X-Forwarded-For", async () => {
    const { limiter, keys } = recording(true);
    await harness(limiter)({
      "cf-connecting-ip": "203.0.113.7",
      "x-forwarded-for": "198.51.100.1, 10.0.0.1",
    });
    expect(keys).toEqual(["book:203.0.113.7"]);
  });

  it("falls back to a constant key when no IP header is present", async () => {
    const { limiter, keys } = recording(true);
    await harness(limiter)();
    expect(keys).toEqual(["book:unknown"]);
  });

  it("fails open when the binding is missing", async () => {
    const res = await harness(undefined)({ "cf-connecting-ip": "203.0.113.7" });
    expect(res.status).toBe(201);
  });

  it("separates buckets so endpoints do not share a counter", async () => {
    const { limiter, keys } = recording(true);
    const app = new Hono<AppEnv>();
    app.post("/other", rateLimit({ bucket: "slots" }), (c) => c.json({ ok: true }));
    await app.request(
      "/other",
      { method: "POST", headers: { "cf-connecting-ip": "203.0.113.7" } },
      { BOOK_RATE_LIMITER: limiter } as unknown as AppEnv["Bindings"],
    );
    expect(keys).toEqual(["slots:203.0.113.7"]);
  });
});
