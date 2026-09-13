import { describe, expect, it } from "vitest";
import { isoUtc, parseIsoUtc } from "../../src/lib/time";

describe("isoUtc", () => {
  it("formats without milliseconds", () => {
    expect(isoUtc(new Date(Date.UTC(2026, 8, 21, 1, 0, 0, 456)))).toBe("2026-09-21T01:00:00Z");
  });

  it("round-trips", () => {
    const s = "2026-09-21T01:30:00Z";
    expect(isoUtc(parseIsoUtc(s))).toBe(s);
  });

  it("sorts lexicographically in chronological order", () => {
    const a = isoUtc(new Date(Date.UTC(2026, 8, 21, 9, 0)));
    const b = isoUtc(new Date(Date.UTC(2026, 8, 21, 10, 0)));
    expect(a < b).toBe(true);
  });

  it("rejects malformed input", () => {
    expect(() => parseIsoUtc("2026-09-21 01:00")).toThrow("Invalid UTC timestamp");
  });
});
