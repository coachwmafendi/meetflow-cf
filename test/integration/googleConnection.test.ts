import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { encryptToBase64 } from "../../src/lib/encrypt";
import { upsertGoogleConnection } from "../../src/db/googleConnections";
import { api, createHost, resetDb } from "../helpers";

const TEST_KEY = btoa("0123456789abcdef0123456789abcdef");

describe("google calendar connection", () => {
  beforeEach(resetDb);

  it("redirects anonymous visitors from authorize to login", async () => {
    const res = await SELF.fetch("https://example.com/oauth/google/authorize", {
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
  });

  it("sends the host to Google with the client id and a signed state", async () => {
    const host = await createHost("wan");
    const res = await SELF.fetch("https://example.com/oauth/google/authorize", {
      headers: { cookie: host.cookie },
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location")!);
    expect(location.origin + location.pathname).toBe(
      "https://accounts.google.com/o/oauth2/v2/auth",
    );
    expect(location.searchParams.get("client_id")).toBe("test-client-id");
    expect(location.searchParams.get("redirect_uri")).toBe(
      "https://example.com/oauth/google/callback",
    );
    expect(location.searchParams.get("scope")).toContain("calendar.readonly");
    expect(location.searchParams.get("state")).toBeTruthy();
  });

  it("rejects a callback whose state does not verify", async () => {
    const host = await createHost("wan");
    const res = await SELF.fetch(
      "https://example.com/oauth/google/callback?code=auth-code&state=garbage",
      { headers: { cookie: host.cookie }, redirect: "manual" },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/dashboard/settings");
    expect(decodeURIComponent(res.headers.get("location")!)).toContain("could not be verified");
  });

  it("shows the connect card before and the connected card after seeding", async () => {
    const host = await createHost("wan");
    const before = await SELF.fetch("https://example.com/dashboard/settings", {
      headers: { cookie: host.cookie },
    });
    const beforeHtml = await before.text();
    expect(beforeHtml).toContain("Connect Google Calendar");

    await upsertGoogleConnection(env.DB, {
      userId: host.id,
      googleEmail: "wan@gmail.com",
      encRefresh: await encryptToBase64(TEST_KEY, "refresh"),
      encAccess: await encryptToBase64(TEST_KEY, "access"),
      accessExpiresAt: Date.now() + 3_600_000,
      now: "2026-09-15T00:00:00Z",
    });

    const after = await SELF.fetch("https://example.com/dashboard/settings", {
      headers: { cookie: host.cookie },
    });
    const afterHtml = await after.text();
    expect(afterHtml).toContain("Connected as");
    expect(afterHtml).toContain("wan@gmail.com");
    expect(afterHtml).toContain("Disconnect");
    expect(afterHtml).not.toContain("Connect Google Calendar");
  });

  it("disconnects and returns to the connect card", async () => {
    const host = await createHost("wan");
    await upsertGoogleConnection(env.DB, {
      userId: host.id,
      googleEmail: "wan@gmail.com",
      encRefresh: await encryptToBase64(TEST_KEY, "refresh"),
      encAccess: await encryptToBase64(TEST_KEY, "access"),
      accessExpiresAt: Date.now() + 3_600_000,
      now: "2026-09-15T00:00:00Z",
    });

    const res = await api("/dashboard/settings/calendar/disconnect", {
      method: "POST",
      cookie: host.cookie,
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(decodeURIComponent(res.headers.get("location")!)).toContain("disconnected");

    const row = await env.DB.prepare("SELECT user_id FROM google_connections").first();
    expect(row).toBe(null);

    const page = await SELF.fetch("https://example.com/dashboard/settings", {
      headers: { cookie: host.cookie },
    });
    expect(await page.text()).toContain("Connect Google Calendar");
  });
});
