import { SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createHost, resetDb } from "../helpers";

describe("pages", () => {
  beforeEach(resetDb);

  it("serves the login page as HTML", async () => {
    const res = await SELF.fetch("https://example.com/login");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("Sign in");
  });

  it("redirects an anonymous visitor away from the dashboard", async () => {
    const res = await SELF.fetch("https://example.com/dashboard", { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
  });

  it("renders the dashboard for a signed-in host", async () => {
    const host = await createHost("wan");
    const res = await SELF.fetch("https://example.com/dashboard", {
      headers: { cookie: host.cookie },
    });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Upcoming");
  });

  it("404s an unknown public profile", async () => {
    const res = await SELF.fetch("https://example.com/nobody");
    expect(res.status).toBe(404);
  });

  it("renders a public booking page", async () => {
    const host = await createHost("wan");
    await SELF.fetch("https://example.com/api/event-types", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: host.cookie },
      body: JSON.stringify({ name: "Consultation", slug: "consultation", duration_minutes: 30 }),
    });
    const res = await SELF.fetch("https://example.com/wan/consultation");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Confirm booking");
    expect(html).toContain('id="page-data"');
  });

  it("escapes host-controlled text", async () => {
    const host = await createHost("wan");
    await SELF.fetch("https://example.com/api/event-types", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: host.cookie },
      body: JSON.stringify({
        name: "<script>alert(1)</script>",
        slug: "xss",
        duration_minutes: 30,
      }),
    });
    const res = await SELF.fetch("https://example.com/dashboard/event-types", {
      headers: { cookie: host.cookie },
    });
    const html = await res.text();
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });

  it("logs out and clears the cookie", async () => {
    const host = await createHost("wan");
    const res = await SELF.fetch("https://example.com/logout", {
      method: "POST",
      headers: { cookie: host.cookie },
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
