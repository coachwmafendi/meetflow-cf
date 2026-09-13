import { createExecutionContext, env, waitOnExecutionContext } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import app from "../../src/index";
import { resetDb } from "../helpers";

/**
 * The worker env sets RATE_LIMIT_MAX very high so the rest of the suite is not
 * throttled. These tests drive the real app with a low override instead, which
 * exercises the actual mounted routes rather than a stand-in.
 */
function withLimit(max: string) {
  const testEnv = { ...env, RATE_LIMIT_MAX: max } as unknown as Cloudflare.Env;
  return async (path: string, init: RequestInit, ip = "203.0.113.200") => {
    const ctx = createExecutionContext();
    const res = await app.fetch(
      new Request(`https://example.com${path}`, {
        ...init,
        headers: { "cf-connecting-ip": ip, ...(init.headers as Record<string, string>) },
      }),
      testEnv,
      ctx,
    );
    await waitOnExecutionContext(ctx);
    return res;
  };
}

const credentials = {
  name: "Wan",
  email: "wan@example.com",
  password: "hunter2hunter2",
  slug: "wan",
  timezone: "Asia/Kuala_Lumpur",
};

const json = (body: unknown): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify(body),
});

const form = (fields: Record<string, string>): RequestInit => ({
  method: "POST",
  headers: { "content-type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams(fields).toString(),
  redirect: "manual",
});

describe("auth rate limiting", () => {
  beforeEach(resetDb);

  it("throttles repeated failed logins on the JSON API", async () => {
    const fetch = withLimit("3");
    const attempt = () =>
      fetch("/api/auth/login", json({ email: "nobody@example.com", password: "wrong" }), "203.0.113.1");

    expect((await attempt()).status).toBe(401);
    expect((await attempt()).status).toBe(401);
    expect((await attempt()).status).toBe(401);

    const blocked = await attempt();
    expect(blocked.status).toBe(429);
    expect(Number(blocked.headers.get("retry-after"))).toBeGreaterThan(0);
  });

  it("shares one counter between the JSON API and the HTML form", async () => {
    const fetch = withLimit("2");
    const ip = "203.0.113.2";

    expect(
      (await fetch("/api/auth/login", json({ email: "a@example.com", password: "x" }), ip)).status,
    ).toBe(401);
    expect(
      (await fetch("/login", form({ email: "a@example.com", password: "x" }), ip)).status,
    ).toBe(401);

    // Budget spent. Neither entry point may be used to get a third attempt.
    expect(
      (await fetch("/api/auth/login", json({ email: "a@example.com", password: "x" }), ip)).status,
    ).toBe(429);
    expect(
      (await fetch("/login", form({ email: "a@example.com", password: "x" }), ip)).status,
    ).toBe(429);
  });

  it("renders the throttled login form as HTML, not JSON", async () => {
    const fetch = withLimit("1");
    const ip = "203.0.113.3";
    await fetch("/login", form({ email: "a@example.com", password: "x" }), ip);

    const blocked = await fetch("/login", form({ email: "a@example.com", password: "x" }), ip);
    expect(blocked.status).toBe(429);
    expect(blocked.headers.get("content-type")).toContain("text/html");
    const body = await blocked.text();
    expect(body).toContain("Too many attempts");
    expect(body).toContain("Sign in");
  });

  it("throttles registration and shares its counter with the form", async () => {
    const fetch = withLimit("1");
    const ip = "203.0.113.4";

    expect((await fetch("/api/auth/register", json(credentials), ip)).status).toBe(201);

    const blocked = await fetch("/api/auth/register", json({ ...credentials, slug: "wan2" }), ip);
    expect(blocked.status).toBe(429);

    const blockedForm = await fetch("/register", form({ ...credentials, slug: "wan3" }), ip);
    expect(blockedForm.status).toBe(429);
    expect(blockedForm.headers.get("content-type")).toContain("text/html");
  });

  it("keeps login and register on separate counters", async () => {
    const fetch = withLimit("1");
    const ip = "203.0.113.5";

    expect(
      (await fetch("/api/auth/login", json({ email: "a@example.com", password: "x" }), ip)).status,
    ).toBe(401);
    expect(
      (await fetch("/api/auth/login", json({ email: "a@example.com", password: "x" }), ip)).status,
    ).toBe(429);

    // Registration budget is untouched by the spent login budget.
    expect((await fetch("/api/auth/register", json(credentials), ip)).status).toBe(201);
  });

  it("limits per client IP", async () => {
    const fetch = withLimit("1");
    const body = json({ email: "a@example.com", password: "x" });

    expect((await fetch("/api/auth/login", body, "203.0.113.6")).status).toBe(401);
    expect((await fetch("/api/auth/login", body, "203.0.113.6")).status).toBe(429);
    expect((await fetch("/api/auth/login", body, "203.0.113.7")).status).toBe(401);
  });

  it("does not throttle logout", async () => {
    const fetch = withLimit("1");
    const ip = "203.0.113.8";
    expect((await fetch("/api/auth/logout", json({}), ip)).status).toBe(200);
    expect((await fetch("/api/auth/logout", json({}), ip)).status).toBe(200);
    expect((await fetch("/api/auth/logout", json({}), ip)).status).toBe(200);
  });
});
