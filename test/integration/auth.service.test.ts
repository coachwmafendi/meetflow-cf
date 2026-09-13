import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { login, register } from "../../src/services/auth";
import { resetDb } from "../helpers";

const input = {
  name: "Wan",
  email: "Wan@Example.com",
  password: "hunter2hunter2",
  slug: "wan",
  timezone: "Asia/Kuala_Lumpur",
};

describe("auth service", () => {
  beforeEach(resetDb);

  it("registers a host and lowercases the email", async () => {
    const user = await register(env.DB, input);
    expect(user.email).toBe("wan@example.com");
    expect(user.slug).toBe("wan");
    expect(user).not.toHaveProperty("password_hash");
  });

  it("rejects a duplicate email", async () => {
    await register(env.DB, input);
    await expect(register(env.DB, { ...input, slug: "wan2" })).rejects.toThrow(
      "Email already registered",
    );
  });

  it("rejects a duplicate slug", async () => {
    await register(env.DB, input);
    await expect(register(env.DB, { ...input, email: "other@example.com" })).rejects.toThrow(
      "Username already taken",
    );
  });

  it("rejects a reserved slug", async () => {
    await expect(register(env.DB, { ...input, slug: "dashboard" })).rejects.toThrow(
      "Username already taken",
    );
  });

  it("rejects an invalid timezone", async () => {
    await expect(register(env.DB, { ...input, timezone: "Mars/Olympus" })).rejects.toThrow(
      "Invalid timezone",
    );
  });

  it("logs in with the right password", async () => {
    await register(env.DB, input);
    const user = await login(env.DB, "wan@example.com", "hunter2hunter2");
    expect(user?.slug).toBe("wan");
  });

  it("returns null for a wrong password", async () => {
    await register(env.DB, input);
    expect(await login(env.DB, "wan@example.com", "wrong")).toBeNull();
  });

  it("returns null for an unknown email", async () => {
    expect(await login(env.DB, "nobody@example.com", "hunter2hunter2")).toBeNull();
  });
});
