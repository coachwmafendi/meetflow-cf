import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createPasswordReset, login, register, resetPassword } from "../../src/services/auth";
import { resetDb } from "../helpers";

describe("password reset", () => {
  beforeEach(resetDb);

  it("creates a single-use token, swaps the password, rejects reuse", async () => {
    await register(env.DB, {
      name: "Wan",
      email: "wan@example.com",
      password: "oldpassword1",
      slug: "wan",
      timezone: "UTC",
    });

    // Unknown addresses stay silent, but get no token.
    await expect(createPasswordReset(env.DB, "ghost@example.com")).resolves.toBeNull();

    const token = await createPasswordReset(env.DB, "wan@example.com");
    expect(token).toMatch(/^[0-9a-f]{64}$/);

    await resetPassword(env.DB, token!, "newpassword2");

    // One use only.
    await expect(resetPassword(env.DB, token!, "anotherpass3")).rejects.toThrow(
      "invalid or has expired",
    );
    // Garbage tokens too.
    await expect(resetPassword(env.DB, "nope", "whatever99")).rejects.toThrow();

    // The new password signs in; the old one is dead.
    expect(await login(env.DB, "wan@example.com", "newpassword2")).not.toBeNull();
    expect(await login(env.DB, "wan@example.com", "oldpassword1")).toBeNull();
  });

  it("enforces the 8-character minimum", async () => {
    await register(env.DB, {
      name: "Wan",
      email: "wan@example.com",
      password: "oldpassword1",
      slug: "wan",
      timezone: "UTC",
    });
    const token = await createPasswordReset(env.DB, "wan@example.com");
    await expect(resetPassword(env.DB, token!, "short")).rejects.toThrow("at least 8 characters");
  });
});
