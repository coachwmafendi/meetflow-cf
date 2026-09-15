import { listRules, listRulesForDay } from "../db/availability";
import { listConfirmedBetween, type BusyInterval } from "../db/bookings";
import {
  generateSlotStarts,
  removeBusy,
  removePast,
  toHhmm,
  toMinutes,
  type Interval,
  type MinuteWindow,
} from "../lib/slots";
import { addMinutes, isoUtc } from "../lib/time";
import { dayOfWeek, zonedDateString, zonedToUtc } from "../lib/timezone";

/**
 * Busy windows for the host, with same-type bookings widened by the buffer on
 * BOTH sides. Symmetric with the insert guard: a candidate meeting must not
 * start inside a prior meeting's trailing buffer, and must not end inside a
 * later meeting's leading buffer — so the grid never shows a slot the guard
 * would reject.
 */
function busyIntervals(
  rows: BusyInterval[],
  eventTypeId: number,
  bufferMinutes: number,
): Interval[] {
  return rows.map((b) => ({
    startMs:
      Date.parse(b.start_at) - (b.event_type_id === eventTypeId ? bufferMinutes * 60_000 : 0),
    endMs: Date.parse(b.end_at) + (b.event_type_id === eventTypeId ? bufferMinutes * 60_000 : 0),
  }));
}

export interface SlotQuery {
  hostId: number;
  hostTimezone: string;
  eventTypeId: number;
  durationMinutes: number;
  bufferMinutes: number;
  dateYmd: string;
  nowMs: number;
  /** Google Calendar busy intervals supplied by the caller (feature off = absent). */
  extraBusy?: Interval[];
}

export interface MonthQuery {
  hostId: number;
  hostTimezone: string;
  eventTypeId: number;
  durationMinutes: number;
  bufferMinutes: number;
  /** 1-12 */
  month: number;
  year: number;
  nowMs: number;
  /** Google Calendar busy intervals supplied by the caller (feature off = absent). */
  extraBusy?: Interval[];
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
  const busy = [...busyIntervals(busyRows, q.eventTypeId, q.bufferMinutes), ...(q.extraBusy ?? [])];

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

const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * Host-local dates in one calendar month that have at least one free slot.
 * Two D1 queries: all active rules, then confirmed bookings overlapping the
 * month's candidate range. Everything else is plain JS.
 */
export async function getMonthFreeDays(db: D1Database, q: MonthQuery): Promise<string[]> {
  const daysInMonth = new Date(Date.UTC(q.year, q.month, 0)).getUTCDate();
  const lastDayYmd = `${q.year}-${pad2(q.month)}-${pad2(daysInMonth)}`;
  const todayYmd = zonedDateString(new Date(q.nowMs), q.hostTimezone);
  if (lastDayYmd < todayYmd) return [];

  const rules = await listRules(db, q.hostId);
  if (rules.length === 0) return [];

  const windowsByDow = new Map<number, MinuteWindow[]>();
  for (const r of rules) {
    const list = windowsByDow.get(r.day_of_week) ?? [];
    list.push({ start: toMinutes(r.start_time), end: toMinutes(r.end_time) });
    windowsByDow.set(r.day_of_week, list);
  }

  const byDate = new Map<string, Interval[]>();
  let minMs = Infinity;
  let maxMs = -Infinity;
  for (let day = 1; day <= daysInMonth; day++) {
    const ymd = `${q.year}-${pad2(q.month)}-${pad2(day)}`;
    const windows = windowsByDow.get(dayOfWeek(ymd));
    if (!windows || windows.length === 0) continue;
    const starts = generateSlotStarts(windows, q.durationMinutes);
    if (starts.length === 0) continue;
    const slots: Interval[] = starts.map((minutes) => {
      const start = zonedToUtc(ymd, toHhmm(minutes), q.hostTimezone);
      return { startMs: start.getTime(), endMs: start.getTime() + q.durationMinutes * 60_000 };
    });
    minMs = Math.min(minMs, slots[0]!.startMs);
    maxMs = Math.max(maxMs, slots[slots.length - 1]!.endMs);
    byDate.set(ymd, slots);
  }
  if (byDate.size === 0) return [];

  const busyRows = await listConfirmedBetween(
    db,
    q.hostId,
    isoUtc(new Date(minMs)),
    isoUtc(new Date(maxMs)),
  );
  const busy = [...busyIntervals(busyRows, q.eventTypeId, q.bufferMinutes), ...(q.extraBusy ?? [])];

  const freeDays: string[] = [];
  for (const [ymd, slots] of byDate) {
    if (ymd < todayYmd) continue;
    if (removeBusy(removePast(slots, q.nowMs), busy).length > 0) freeDays.push(ymd);
  }
  return freeDays;
}
