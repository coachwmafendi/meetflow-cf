import { describe, expect, it } from "vitest";
import { formatUtcOffset, zoneCity, zoneLabel } from "../../src/lib/timezoneList";

describe("formatUtcOffset", () => {
  it("pads and signs", () => {
    expect(formatUtcOffset(480)).toBe("+08:00");
    expect(formatUtcOffset(0)).toBe("+00:00");
    expect(formatUtcOffset(-300)).toBe("-05:00");
  });

  it("handles half- and quarter-hour zones", () => {
    expect(formatUtcOffset(330)).toBe("+05:30");
    expect(formatUtcOffset(345)).toBe("+05:45");
    expect(formatUtcOffset(-210)).toBe("-03:30");
  });
});

describe("zoneCity", () => {
  it("drops the region and the underscores", () => {
    expect(zoneCity("Asia/Kuala_Lumpur")).toBe("Kuala Lumpur");
    expect(zoneCity("America/New_York")).toBe("New York");
    expect(zoneCity("Europe/London")).toBe("London");
  });

  it("uses the final segment of a three-part zone", () => {
    expect(zoneCity("America/Argentina/Buenos_Aires")).toBe("Buenos Aires");
  });

  it("passes through a bare identifier", () => {
    expect(zoneCity("UTC")).toBe("UTC");
  });
});

describe("zoneLabel", () => {
  it("renders offset then city", () => {
    expect(zoneLabel("Asia/Kuala_Lumpur", new Date("2026-09-14T00:00:00Z"))).toBe(
      "+08:00 Kuala Lumpur",
    );
    expect(zoneLabel("UTC", new Date("2026-09-14T00:00:00Z"))).toBe("+00:00 UTC");
  });

  it("reflects DST at the given instant", () => {
    expect(zoneLabel("Europe/London", new Date("2026-07-01T12:00:00Z"))).toBe("+01:00 London");
    expect(zoneLabel("Europe/London", new Date("2026-01-01T12:00:00Z"))).toBe("+00:00 London");
  });

  it("falls back to the bare city for an unknown zone", () => {
    expect(zoneLabel("Mars/Olympus_Mons")).toBe("Olympus Mons");
  });
});

describe("zone list assumptions", () => {
  const zones = (
    Intl as unknown as { supportedValuesOf: (k: string) => string[] }
  ).supportedValuesOf("timeZone");

  it("has no duplicate city labels, so the region can be omitted", () => {
    const seen = new Map<string, number>();
    for (const zone of zones) {
      const city = zoneCity(zone);
      seen.set(city, (seen.get(city) ?? 0) + 1);
    }
    expect([...seen.entries()].filter(([, count]) => count > 1)).toEqual([]);
  });

  it("does not include UTC, which is why the client script adds it", () => {
    expect(zones).not.toContain("UTC");
  });
});
