import { describe, expect, it } from "vitest";
import { buildIcs } from "./ics";

describe("buildIcs", () => {
  it("emits a minimal valid VCALENDAR with UTC instants", () => {
    const ics = buildIcs({
      uid: "booking-42@meetflow",
      startAt: "2026-12-05T01:00:00Z",
      endAt: "2026-12-05T02:00:00Z",
      summary: "Booking: Test",
    });
    expect(ics).toContain("BEGIN:VCALENDAR");
    expect(ics).toContain("UID:booking-42@meetflow");
    expect(ics).toContain("DTSTART:20261205T010000Z");
    expect(ics).toContain("DTEND:20261205T020000Z");
    expect(ics).toContain("SUMMARY:Booking: Test");
    expect(ics.endsWith("\r\n")).toBe(true);
  });

  it("escapes semicolons, commas and newlines in text", () => {
    const ics = buildIcs({
      uid: "u@meetflow",
      startAt: "2026-12-05T01:00:00Z",
      endAt: "2026-12-05T02:00:00Z",
      summary: "Booking; A,B\nC",
    });
    expect(ics).toContain("SUMMARY:Booking\\; A\\,B\\nC");
  });

  it("folds content lines longer than 75 octets", () => {
    const ics = buildIcs({
      uid: "u@meetflow",
      startAt: "2026-12-05T01:00:00Z",
      endAt: "2026-12-05T02:00:00Z",
      summary: "L".repeat(120),
    });
    const summaryLines = ics
      .split("\r\n")
      .filter((l) => l.startsWith("SUMMARY:") || l.startsWith(" L"));
    expect(summaryLines.length).toBeGreaterThanOrEqual(2);
  });
});
