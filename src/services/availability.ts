import { listRulesForDay } from "../db/availability";
import { listConfirmedBetween } from "../db/bookings";
import {
  generateSlotStarts,
  removeBusy,
  removePast,
  toHhmm,
  toMinutes,
  type Interval,
} from "../lib/slots";
import { addMinutes, isoUtc } from "../lib/time";
import { dayOfWeek, zonedToUtc } from "../lib/timezone";

export interface SlotQuery {
  hostId: number;
  hostTimezone: string;
  eventTypeId: number;
  durationMinutes: number;
  dateYmd: string;
  nowMs: number;
}

export interface Slot {
  /** UTC instant, fixed-width ISO. */
  startAt: string;
  endAt: string;
}

export interface DaySlots {
  /** Slots that exist on the availability grid and are not in the past. */
  grid: Slot[];
  /** `grid` minus slots overlapping a confirmed booking. */
  free: Slot[];
}

/**
 * Bookable slots for one calendar date in the HOST's timezone.
 * Availability rules are host-local; results are UTC instants.
 */
export async function getSlotsForDate(db: D1Database, q: SlotQuery): Promise<Slot[]> {
  return (await getDaySlots(db, q)).free;
}

/**
 * Both views of a date's slots. Callers that must tell "never a valid slot" (422)
 * apart from "valid slot, already taken" (409) need `grid` as well as `free`.
 */
export async function getDaySlots(db: D1Database, q: SlotQuery): Promise<DaySlots> {
  const empty: DaySlots = { grid: [], free: [] };

  const rules = await listRulesForDay(db, q.hostId, dayOfWeek(q.dateYmd));
  if (rules.length === 0) return empty;

  const windows = rules.map((r) => ({
    start: toMinutes(r.start_time),
    end: toMinutes(r.end_time),
  }));
  const startMinutes = generateSlotStarts(windows, q.durationMinutes);
  if (startMinutes.length === 0) return empty;

  const candidates: Interval[] = startMinutes.map((minutes) => {
    const start = zonedToUtc(q.dateYmd, toHhmm(minutes), q.hostTimezone);
    return { startMs: start.getTime(), endMs: start.getTime() + q.durationMinutes * 60_000 };
  });

  const dayStart = candidates[0]!.startMs;
  const dayEnd = candidates[candidates.length - 1]!.endMs;
  const busyRows = await listConfirmedBetween(
    db,
    q.hostId,
    isoUtc(new Date(dayStart)),
    isoUtc(new Date(dayEnd)),
  );
  const busy: Interval[] = busyRows.map((b) => ({
    startMs: Date.parse(b.start_at),
    endMs: Date.parse(b.end_at),
  }));

  const toSlot = (slot: Interval): Slot => ({
    startAt: isoUtc(new Date(slot.startMs)),
    endAt: isoUtc(addMinutes(new Date(slot.startMs), q.durationMinutes)),
  });

  const upcoming = removePast(candidates, q.nowMs);
  return {
    grid: upcoming.map(toSlot),
    free: removeBusy(upcoming, busy).map(toSlot),
  };
}
