import { SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createHost, resetDb } from "../helpers";

describe("legal pages", () => {
  beforeEach(resetDb);

  it("serves the privacy policy", async () => {
    const res = await SELF.fetch("https://example.com/privacy");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("Privacy Policy");
    expect(html).toContain("Data we collect");
  });

  it("serves the terms of service", async () => {
    const res = await SELF.fetch("https://example.com/terms");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    const html = await res.text();
    expect(html).toContain("Terms of Service");
    expect(html).toContain("Acceptable use");
  });

  it("links the legal pages from the marketing footer", async () => {
    const res = await SELF.fetch("https://example.com/");
    const html = await res.text();
    expect(html).toContain('href="/privacy"');
    expect(html).toContain('href="/terms"');
  });

  it("rejects privacy and terms as usernames", async () => {
    for (const slug of ["privacy", "terms"]) {
      const res = await SELF.fetch("https://example.com/api/auth/register", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          name: "Test",
          email: `${slug}@example.com`,
          password: "password123",
          slug,
          timezone: "UTC",
        }),
      });
      expect(res.status).not.toBe(201);
    }
  });

  it("serves the legal pages to signed-in hosts", async () => {
    const host = await createHost("wan");
    for (const path of ["/privacy", "/terms"]) {
      const res = await SELF.fetch(`https://example.com${path}`, {
        headers: { cookie: host.cookie },
      });
      expect(res.status).toBe(200);
    }
  });
});