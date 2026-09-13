import { describe, expect, it } from "vitest";
import { SESSION_COOKIE, signSession, verifySession } from "../../src/lib/session";

const SECRET = "unit-test-secret";

describe("session", () => {
  it("names the cookie", () => {
    expect(SESSION_COOKIE).toBe("mf_session");
  });

  it("round-trips a user id", async () => {
    const token = await signSession(7, SECRET, 3600, 1_000_000);
    expect(await verifySession(token, SECRET, 1_000_100)).toBe(7);
  });

  it("rejects an expired token", async () => {
    const token = await signSession(7, SECRET, 60, 1_000_000);
    expect(await verifySession(token, SECRET, 1_000_000 + 61_000)).toBeNull();
  });

  it("rejects a tampered payload", async () => {
    const token = await signSession(7, SECRET, 3600, 1_000_000);
    const [payload, sig] = token.split(".");
    const forged = `${btoa("9999.99999999999").replace(/=+$/, "")}.${sig}`;
    expect(forged).not.toBe(token);
    expect(await verifySession(forged, SECRET, 1_000_100)).toBeNull();
    expect(payload).toBeTruthy();
  });

  it("rejects a token signed with another secret", async () => {
    const token = await signSession(7, "other-secret", 3600, 1_000_000);
    expect(await verifySession(token, SECRET, 1_000_100)).toBeNull();
  });

  it("rejects garbage", async () => {
    expect(await verifySession("garbage", SECRET, 1_000_100)).toBeNull();
  });
});
