import { getPublicEventType } from "../db/eventTypes";
import { cancelBooking, getBookingOwned, insertBookingIfFree } from "../db/bookings";
import { findUserBySlug } from "../db/users";
import { addMinutes, isoUtc, nowIso, parseIsoUtc } from "../lib/time";
import { isValidTimeZone, zonedDateString } from "../lib/timezone";
import { isEmail, isYmd } from "../lib/validate";
import { getDaySlots } from "./availability";
import type { BookingRow, EventTypeRow, PublicUser } from "../types";

export class BookingError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 404 | 409 | 422,
  ) {
    super(message);
    this.name = "BookingError";
  }
}

export interface PublicTarget {
  host: PublicUser;
  eventType: EventTypeRow;
}

export async function resolvePublicTarget(
  db: D1Database,
  hostSlug: string,
  eventSlug: string,
): Promise<PublicTarget> {
  const host = await findUserBySlug(db, hostSlug.toLowerCase());
  if (!host) throw new BookingError("Not found", 404);
  const eventType = await getPublicEventType(db, host.id, eventSlug.toLowerCase());
  if (!eventType) throw new BookingError("Not found", 404);
  return { host, eventType };
}

export interface CreateBookingInput {
  hostSlug: string;
  eventSlug: string;
  startAt: string;
  guestName: string;
  guestEmail: string;
  guestTimezone: string;
  notes: string | null;
  nowMs?: number;
}

export async function createBooking(
  db: D1Database,
  input: CreateBookingInput,
): Promise<BookingRow> {
  const { host, eventType } = await resolvePublicTarget(db, input.hostSlug, input.eventSlug);

  const guestName = input.guestName.trim();
  const guestEmail = input.guestEmail.trim().toLowerCase();
  if (guestName.length < 1 || guestName.length > 100) {
    throw new BookingError("Name is required", 400);
  }
  if (!isEmail(guestEmail)) throw new BookingError("A valid email is required", 400);
  if (!isValidTimeZone(input.guestTimezone)) throw new BookingError("Invalid timezone", 400);
  if (input.notes && input.notes.length > 2000) throw new BookingError("Notes are too long", 400);

  let start: Date;
  try {
    start = parseIsoUtc(input.startAt);
  } catch {
    throw new BookingError("Invalid start time", 400);
  }

  const nowMs = input.nowMs ?? Date.now();
  if (start.getTime() < nowMs) throw new BookingError("That time is in the past", 422);

  const end = addMinutes(start, eventType.duration_minutes);
  const startIso = isoUtc(start);
  const endIso = isoUtc(end);

  // Re-derive the host-local date from the instant so the client cannot lie about it.
  const hostDate = zonedDateString(start, host.timezone);
  if (!isYmd(hostDate)) throw new BookingError("Invalid start time", 400);

  const { grid, free } = await getDaySlots(db, {
    hostId: host.id,
    hostTimezone: host.timezone,
    eventTypeId: eventType.id,
    durationMinutes: eventType.duration_minutes,
    dateYmd: hostDate,
    nowMs,
  });
  // Off the grid entirely (outside availability, or not on a duration boundary).
  if (!grid.some((s) => s.startAt === startIso)) {
    throw new BookingError("That time is not available", 422);
  }
  // A real slot, but someone already took it.
  if (!free.some((s) => s.startAt === startIso)) {
    throw new BookingError("This time slot is no longer available.", 409);
  }

  const booking = await insertBookingIfFree(db, {
    userId: host.id,
    eventTypeId: eventType.id,
    guestName,
    guestEmail,
    startAt: startIso,
    endAt: endIso,
    timezone: input.guestTimezone,
    notes: input.notes,
    now: nowIso(),
  });
  if (!booking) throw new BookingError("This time slot is no longer available.", 409);
  return booking;
}

export async function cancelOwnedBooking(
  db: D1Database,
  bookingId: number,
  userId: number,
): Promise<BookingRow> {
  const existing = await getBookingOwned(db, bookingId, userId);
  if (!existing) throw new BookingError("Not found", 404);
  if (existing.status === "cancelled") return existing;

  const cancelled = await cancelBooking(db, bookingId, userId, nowIso());
  if (!cancelled) throw new BookingError("Not found", 404);
  return cancelled;
}
