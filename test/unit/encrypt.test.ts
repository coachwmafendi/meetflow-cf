import { describe, expect, it } from "vitest";
import { decryptFromBase64, encryptToBase64 } from "../../src/lib/encrypt";

/** base64 of exactly 32 raw bytes, as `openssl rand -base64 32` produces. */
const KEY = btoa("0123456789abcdef0123456789abcdef");
const KEY2 = btoa("ffffffffffffffffffffffffffffffff");

describe("encrypt", () => {
  it("roundtrips a plaintext", async () => {
    const blob = await encryptToBase64(KEY, "1///refresh-token-值");
    expect(await decryptFromBase64(KEY, blob)).toBe("1///refresh-token-值");
  });

  it("produces a different blob each time (random nonce)", async () => {
    const a = await encryptToBase64(KEY, "same");
    const b = await encryptToBase64(KEY, "same");
    expect(a).not.toBe(b);
  });

  it("rejects a tampered blob", async () => {
    const blob = await encryptToBase64(KEY, "secret");
    const bytes = Uint8Array.from(atob(blob), (c) => c.charCodeAt(0));
    bytes[bytes.length - 1]! ^= 1;
    const tampered = btoa(String.fromCharCode(...bytes));
    await expect(decryptFromBase64(KEY, tampered)).rejects.toThrow();
  });

  it("rejects a blob encrypted with a different key", async () => {
    const blob = await encryptToBase64(KEY, "secret");
    await expect(decryptFromBase64(KEY2, blob)).rejects.toThrow();
  });

  it("rejects a truncated blob and a bad key length", async () => {
    await expect(decryptFromBase64(KEY, btoa("short"))).rejects.toThrow();
    await expect(encryptToBase64(btoa("too-short"), "x")).rejects.toThrow();
  });
});