import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../../src/lib/password";

describe("password", () => {
  it("produces a self-describing hash string", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash.startsWith("pbkdf2$100000$")).toBe(true);
    expect(hash.split("$")).toHaveLength(4);
  });

  it("uses a fresh salt each time", async () => {
    const a = await hashPassword("same");
    const b = await hashPassword("same");
    expect(a).not.toBe(b);
  });

  it("verifies the right password", async () => {
    const hash = await hashPassword("s3cret-pass");
    expect(await verifyPassword("s3cret-pass", hash)).toBe(true);
  });

  it("rejects the wrong password", async () => {
    const hash = await hashPassword("s3cret-pass");
    expect(await verifyPassword("s3cret-pas", hash)).toBe(false);
  });

  it("rejects a malformed hash instead of throwing", async () => {
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
  });
});
