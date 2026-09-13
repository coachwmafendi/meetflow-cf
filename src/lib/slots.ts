export interface MinuteWindow {
  /** Minutes from local midnight, inclusive. */
  start: number;
  /** Minutes from local midnight, exclusive. */
  end: number;
}

export interface Interval {
  startMs: number;
  endMs: number;
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function toMinutes(hhmm: string): number {
  const m = HHMM.exec(hhmm);
  if (!m) throw new Error(`Invalid HH:MM: ${hhmm}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export function toHhmm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Start times (minutes from local midnight) for every event that fits entirely
 * inside one of `windows`. Step size equals the event duration (PRD §11).
 */
export function generateSlotStarts(windows: MinuteWindow[], durationMinutes: number): number[] {
  if (durationMinutes <= 0) throw new Error("durationMinutes must be positive");
  const starts = new Set<number>();
  for (const w of windows) {
    for (let t = w.start; t + durationMinutes <= w.end; t += durationMinutes) {
      starts.add(t);
    }
  }
  return [...starts].sort((a, b) => a - b);
}

/** Half-open overlap: [aStart,aEnd) intersects [bStart,bEnd). */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.startMs < b.endMs && a.endMs > b.startMs;
}

export function removeBusy(slots: Interval[], busy: Interval[]): Interval[] {
  return slots.filter((slot) => !busy.some((b) => overlaps(slot, b)));
}

export function removePast(slots: Interval[], nowMs: number): Interval[] {
  return slots.filter((slot) => slot.startMs >= nowMs);
}
