import { describe, expect, it } from "vitest";
import { generateSlotStarts, removeBusy, toMinutes } from "../../src/lib/slots";

describe("generateSlotStarts", () => {
  it("fits whole events only (PRD §11)", () => {
    expect(
      generateSlotStarts([{ start: toMinutes("09:00"), end: toMinutes("11:00") }], 30),
    ).toEqual([540, 570, 600, 630]); // 09:00 09:30 10:00 10:30
  });

  it("drops a trailing partial window", () => {
    expect(
      generateSlotStarts([{ start: toMinutes("09:00"), end: toMinutes("10:20") }], 30),
    ).toEqual([540, 570]); // 09:00 09:30 — 10:00 would end 10:30 > 10:20
  });

  it("handles two windows on one day", () => {
    const windows = [
      { start: toMinutes("09:00"), end: toMinutes("10:00") },
      { start: toMinutes("14:00"), end: toMinutes("15:00") },
    ];
    expect(generateSlotStarts(windows, 30)).toEqual([540, 570, 840, 870]);
  });

  it("merges duplicates and sorts", () => {
    const windows = [
      { start: toMinutes("14:00"), end: toMinutes("15:00") },
      { start: toMinutes("14:00"), end: toMinutes("15:00") },
    ];
    expect(generateSlotStarts(windows, 60)).toEqual([840]);
  });

  it("returns nothing when the window is shorter than the event", () => {
    expect(generateSlotStarts([{ start: 540, end: 560 }], 30)).toEqual([]);
  });
});

describe("removeBusy", () => {
  const slot = (startMs: number) => ({ startMs, endMs: startMs + 30 * 60_000 });

  it("removes a slot overlapping a booking", () => {
    const slots = [slot(0), slot(1_800_000), slot(3_600_000)];
    const busy = [{ startMs: 1_800_000, endMs: 3_600_000 }];
    expect(removeBusy(slots, busy)).toEqual([slot(0), slot(3_600_000)]);
  });

  it("keeps slots that only touch at the boundary", () => {
    const slots = [slot(0)];
    const busy = [{ startMs: 1_800_000, endMs: 3_600_000 }];
    expect(removeBusy(slots, busy)).toEqual([slot(0)]);
  });

  it("removes a slot straddled by a longer booking", () => {
    const slots = [slot(1_800_000)];
    const busy = [{ startMs: 0, endMs: 5_400_000 }];
    expect(removeBusy(slots, busy)).toEqual([]);
  });
});
