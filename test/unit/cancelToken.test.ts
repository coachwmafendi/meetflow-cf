import { describe, expect, it } from "vitest";
import {
  cancelPath,
  cancelUrl,
  signCancelToken,
  verifyCancelToken,
} from "../../src/lib/cancelToken";
import { signSession } from "../../src/lib/session";

const SECRET = "unit-test-secret";

describe("cancel tokens", () => {
  it("round-trips a booking id", async () => {
    const token = await signCancelToken(42, SECRET);
    expect(await verifyCancelToken(token, SECRET)).toBe(42);
  });

  it("is deterministic, so the same link keeps working", async () => {
    expect(await signCancelToken(42, SECRET)).toBe(await signCancelToken(42, SECRET));
  });

  it("issues a different token per booking", async () => {
    expect(await signCancelToken(42, SECRET)).not.toBe(await signCancelToken(43, SECRET));
  });

  it("rejects another secret", async () => {
    const token = await signCancelToken(42, "other-secret");
    expect(await verifyCancelToken(token, SECRET)).toBeNull();
  });

  it("rejects a tampered payload", async () => {
    const token = await signCancelToken(42, SECRET);
    const signature = token.slice(token.lastIndexOf(".") + 1);
    const forged = `${btoa("999").replace(/=+$/, "")}.${signature}`;
    expect(await verifyCancelToken(forged, SECRET)).toBeNull();
  });

  it("rejects garbage without throwing", async () => {
    for (const bad of ["", "garbage", ".", "a.b", "....."]) {
      expect(await verifyCancelToken(bad, SECRET)).toBeNull();
    }
  });

  // The purpose string is what stops one signed artefact standing in for another.
  it("will not accept a session token", async () => {
    const session = await signSession(42, SECRET);
    expect(await verifyCancelToken(session, SECRET)).toBeNull();
  });

  it("builds a url with the token percent-encoded", async () => {
    const url = await cancelUrl("https://meetflow.example", 7, SECRET);
    expect(url.startsWith("https://meetflow.example/booking/7/cancel?token=")).toBe(true);
    const token = decodeURIComponent(new URL(url).searchParams.get("token")!);
    expect(await verifyCancelToken(token, SECRET)).toBe(7);
  });
});

describe("cancelPath", () => {
  it("is relative, so an in-app link never leaves the current origin", async () => {
    const path = await cancelPath(7, SECRET);
    expect(path.startsWith("/booking/7/cancel?token=")).toBe(true);
    expect(path).not.toContain("://");
  });

  it("agrees with the absolute form used in email", async () => {
    const path = await cancelPath(7, SECRET);
    expect(await cancelUrl("https://meetflow.example", 7, SECRET)).toBe(
      `https://meetflow.example${path}`,
    );
  });
});
