import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("assets", () => {
  it("serves the popup embed script from the assets binding", async () => {
    const res = await env.ASSETS.fetch(new Request("https://example.com/embed.js"));
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("javascript");
    const body = await res.text();
    expect(body).toContain("data-meetflow-link");
    expect(body).toContain("iframe");
  });
});
