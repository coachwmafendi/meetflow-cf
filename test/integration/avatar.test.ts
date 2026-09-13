import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createHost, resetDb } from "../helpers";

const PNG = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3, 4]);

function upload(bytes: Uint8Array, cookie: string, filename = "me.png", type = "image/png") {
  const body = new FormData();
  body.append("avatar", new File([bytes], filename, { type }));
  return SELF.fetch("https://example.com/dashboard/settings/avatar", {
    method: "POST",
    headers: { cookie },
    body,
    redirect: "manual",
  });
}

async function storedKey(slug: string): Promise<string | null> {
  const row = await env.DB.prepare("SELECT avatar_key FROM users WHERE slug = ?")
    .bind(slug)
    .first<{ avatar_key: string | null }>();
  return row?.avatar_key ?? null;
}

describe("avatar upload", () => {
  beforeEach(resetDb);

  it("requires authentication", async () => {
    const res = await upload(PNG, "");
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
  });

  it("stores the object in R2 and records the key", async () => {
    const host = await createHost("wan");
    const res = await upload(PNG, host.cookie);
    expect(res.status).toBe(302);

    const key = await storedKey("wan");
    expect(key).toMatch(/^avatars\/\d+\/[0-9a-f-]{36}\.png$/);

    const object = await env.AVATARS.get(key!);
    expect(object).not.toBeNull();
    expect(object!.httpMetadata?.contentType).toBe("image/png");
  });

  it("serves the image with hardening headers", async () => {
    const host = await createHost("wan");
    await upload(PNG, host.cookie);
    const key = await storedKey("wan");

    const res = await SELF.fetch(`https://example.com/${key}`);
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("image/png");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(res.headers.get("content-security-policy")).toContain("sandbox");
    expect(res.headers.get("cache-control")).toContain("immutable");
  });

  it("404s an unknown avatar path", async () => {
    const res = await SELF.fetch("https://example.com/avatars/1/does-not-exist.png");
    expect(res.status).toBe(404);
  });

  it("rejects a script payload wearing an image filename", async () => {
    const host = await createHost("wan");
    const payload = new TextEncoder().encode("<script>alert(1)</script>");
    const res = await upload(payload, host.cookie, "xss.png", "image/png");

    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Only PNG, JPEG, WebP or GIF");
    expect(await storedKey("wan")).toBeNull();
  });

  it("rejects SVG", async () => {
    const host = await createHost("wan");
    const svg = new TextEncoder().encode('<svg xmlns="http://www.w3.org/2000/svg"/>');
    const res = await upload(svg, host.cookie, "a.svg", "image/svg+xml");
    expect(res.status).toBe(400);
    expect(await storedKey("wan")).toBeNull();
  });

  it("replaces the previous object rather than accumulating", async () => {
    const host = await createHost("wan");
    await upload(PNG, host.cookie);
    const first = await storedKey("wan");

    await upload(PNG, host.cookie);
    const second = await storedKey("wan");

    expect(second).not.toBe(first);
    expect(await env.AVATARS.get(second!)).not.toBeNull();
  });

  it("removes the avatar and falls back to the monogram", async () => {
    const host = await createHost("wan");
    await upload(PNG, host.cookie);
    expect(await storedKey("wan")).not.toBeNull();

    const res = await SELF.fetch("https://example.com/dashboard/settings/avatar/remove", {
      method: "POST",
      headers: { cookie: host.cookie },
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(await storedKey("wan")).toBeNull();
  });

  it("shows the image on the public profile once uploaded", async () => {
    const host = await createHost("wan");

    const before = await SELF.fetch("https://example.com/wan");
    expect(await before.text()).not.toContain('<img src="/avatars/');

    await upload(PNG, host.cookie);
    const after = await SELF.fetch("https://example.com/wan");
    expect(await after.text()).toContain('<img src="/avatars/');
  });
});
