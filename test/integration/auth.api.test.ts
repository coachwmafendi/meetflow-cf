import { beforeEach, describe, expect, it } from "vitest";
import { api, resetDb } from "../helpers";

const body = {
  name: "Wan",
  email: "wan@example.com",
  password: "hunter2hunter2",
  slug: "wan",
  timezone: "Asia/Kuala_Lumpur",
};

const post = (path: string, json: unknown) =>
  api(path, { method: "POST", body: JSON.stringify(json) });

describe("auth api", () => {
  beforeEach(resetDb);

  it("registers and sets an HttpOnly session cookie", async () => {
    const res = await post("/api/auth/register", body);
    expect(res.status).toBe(201);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("mf_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(await res.json()).toMatchObject({ user: { slug: "wan" } });
  });

  it("never returns the password hash", async () => {
    const res = await post("/api/auth/register", body);
    expect(JSON.stringify(await res.json())).not.toContain("pbkdf2");
  });

  it("rejects a duplicate email with 409", async () => {
    await post("/api/auth/register", body);
    const res = await post("/api/auth/register", { ...body, slug: "wan2" });
    expect(res.status).toBe(409);
  });

  it("logs in and returns the user", async () => {
    await post("/api/auth/register", body);
    const res = await post("/api/auth/login", { email: body.email, password: body.password });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ user: { email: "wan@example.com" } });
  });

  it("returns 401 for a bad password", async () => {
    await post("/api/auth/register", body);
    const res = await post("/api/auth/login", { email: body.email, password: "nope" });
    expect(res.status).toBe(401);
  });

  it("clears the cookie on logout", async () => {
    const res = await post("/api/auth/logout", {});
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
