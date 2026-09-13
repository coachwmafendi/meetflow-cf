import { describe, expect, it } from "vitest";
import {
  isValidTimeZone,
  tzOffsetMinutes,
  utcToZonedParts,
  zonedToUtc,
} from "../../src/lib/timezone";
import { isoUtc } from "../../src/lib/time";

describe("timezone", () => {
  it("computes a fixed offset zone", () => {
    const d = new Date("2026-09-21T00:00:00Z");
    expect(tzOffsetMinutes(d, "Asia/Kuala_Lumpur")).toBe(480);
  });

  it("computes DST offsets for London", () => {
    expect(tzOffsetMinutes(new Date("2026-07-01T12:00:00Z"), "Europe/London")).toBe(60);
    expect(tzOffsetMinutes(new Date("2026-01-01T12:00:00Z"), "Europe/London")).toBe(0);
  });

  it("converts a local wall time to UTC", () => {
    // 09:00 in Kuala Lumpur (UTC+8) == 01:00Z
    expect(isoUtc(zonedToUtc("2026-09-21", "09:00", "Asia/Kuala_Lumpur"))).toBe(
      "2026-09-21T01:00:00Z",
    );
  });

  it("converts across a DST boundary in New York", () => {
    // 2026-03-08 is the US spring-forward date; 09:00 EDT == 13:00Z
    expect(isoUtc(zonedToUtc("2026-03-08", "09:00", "America/New_York"))).toBe(
      "2026-03-08T13:00:00Z",
    );
    // the day before is still EST; 09:00 EST == 14:00Z
    expect(isoUtc(zonedToUtc("2026-03-07", "09:00", "America/New_York"))).toBe(
      "2026-03-07T14:00:00Z",
    );
  });

  it("renders a UTC instant back into zoned parts", () => {
    expect(utcToZonedParts(new Date("2026-09-21T01:00:00Z"), "Asia/Kuala_Lumpur")).toEqual({
      year: 2026,
      month: 9,
      day: 21,
      hour: 9,
      minute: 0,
      second: 0,
    });
  });

  it("validates IANA identifiers", () => {
    expect(isValidTimeZone("Asia/Kuala_Lumpur")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("UTC+8")).toBe(false);
  });
});
