import { getEventTypeById, getPublicEventType } from "../db/eventTypes";
import {
  cancelBooking,
  cancelBookingById,
  getBookingById,
  getBookingOwned,
  getConfirmedSlotBooking,
  insertBookingIfFree,
  rescheduleBookingIfFree,
} from "../db/bookings";
import {
  cancelAllAttendees,
  cancelAttendee,
  countConfirmedAttendees,
  getAttendeeForBooking,
  insertAttendee,
  joinBookingIfSeatsFree,
  listAttendees,
} from "../db/attendees";
import { findUserById, findUserBySlug } from "../db/users";
import { addMinutes, isoUtc, nowIso, parseIsoUtc } from "../lib/time";
import { isValidTimeZone, zonedDateString, zonedToUtc } from "../lib/timezone";
import type { FetchGoogleBusy } from "../lib/googleCalendar";
import { isEmail, isYmd } from "../lib/validate";
import {
  signCancelToken,
  verifyAttendeeToken,
  verifyCancelToken,
} from "../lib/cancelToken";
import { getDaySlots } from "./availability";
import type { BookingAttendeeRow, BookingRow, EventTypeRow, PublicUser } from "../types";

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
  /**
   * Fetches Google busy intervals for `userId` over `timeMinMs..timeMaxMs`.
   * Absent (or a route without the feature) = no Google busy check.
   */
  fetchGoogleBusy?: FetchGoogleBusy;
}

export interface CreatedBooking {
  booking: BookingRow;
  /** Set for group events: the seat this guest now holds. */
  attendee: BookingAttendeeRow | null;
}

export async function createBooking(
  db: D1Database,
  input: CreateBookingInput,
): Promise<CreatedBooking> {
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

  // A Google-busy slot can never be booked even if the page was stale.
  const dayStart = zonedToUtc(hostDate, "00:00", host.timezone);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60_000);
  const extraBusy = input.fetchGoogleBusy
    ? await input.fetchGoogleBusy(
        host.id,
        dayStart.getTime() - 3_600_000,
        dayEnd.getTime() + 3_600_000,
      )
    : [];

  const { grid, free } = await getDaySlots(db, {
    hostId: host.id,
    hostTimezone: host.timezone,
    eventTypeId: eventType.id,
    durationMinutes: eventType.duration_minutes,
    bufferMinutes: eventType.buffer_minutes,
    seatsTotal: eventType.seats_total,
    dateYmd: hostDate,
    nowMs,
    extraBusy,
  });
  // Off the grid entirely (outside availability, or not on a duration boundary).
  if (!grid.some((s) => s.startAt === startIso)) {
    throw new BookingError("That time is not available", 422);
  }
  // A real slot, but someone already took it.
  if (!free.some((s) => s.startAt === startIso)) {
    if (eventType.seats_total > 1) {
      const full = await getConfirmedSlotBooking(db, host.id, eventType.id, startIso);
      if (full) throw new BookingError("This event is fully booked.", 409);
    }
    throw new BookingError("This time slot is no longer available.", 409);
  }

  const attendeeInput = {
    bookingId: 0,
    guestName,
    guestEmail,
    notes: input.notes,
    timezone: input.guestTimezone,
    now: nowIso(),
  };

  if (eventType.seats_total > 1) {
    // Group slot: try to create it; if we lost that race the slot exists and we
    // join it instead — so two simultaneous first guests both get a seat.
    const fresh = await insertBookingIfFree(db, {
      userId: host.id,
      eventTypeId: eventType.id,
      guestName,
      guestEmail,
      startAt: startIso,
      endAt: endIso,
      timezone: input.guestTimezone,
      notes: input.notes,
      bufferMinutes: eventType.buffer_minutes,
      now: nowIso(),
    });
    if (fresh) {
      const attendee = await insertAttendee(db, { ...attendeeInput, bookingId: fresh.id });
      if (!attendee) {
        // Never leave a slot booked without its first guest.
        await cancelBookingById(db, fresh.id, nowIso());
        throw new BookingError("This time slot is no longer available.", 409);
      }
      return { booking: fresh, attendee };
    }

    const existing = await getConfirmedSlotBooking(db, host.id, eventType.id, startIso);
    if (!existing) throw new BookingError("This time slot is no longer available.", 409);
    const attendees = await listAttendees(db, existing.id);
    if (attendees.some((a) => a.status === "confirmed" && a.guest_email === guestEmail)) {
      throw new BookingError("You have already booked this appointment.", 409);
    }
    const attendee = await joinBookingIfSeatsFree(db, { ...attendeeInput, bookingId: existing.id });
    if (!attendee) throw new BookingError("This event is fully booked.", 409);
    return { booking: existing, attendee };
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
    bufferMinutes: eventType.buffer_minutes,
    now: nowIso(),
  });
  if (!booking) throw new BookingError("This time slot is no longer available.", 409);
  return { booking, attendee: null };
}

export interface RescheduleInput {
  bookingId: number;
  token: string;
  secret: string;
  newStartAt: string;
  guestTimezone: string;
  nowMs?: number;
  /**
   * Fetches Google busy intervals for `userId` over `timeMinMs..timeMaxMs`.
   * Absent (or a route without the feature) = no Google busy check.
   */
  fetchGoogleBusy?: FetchGoogleBusy;
}

/**
 * Moves a booking to a new slot of the same event type. The token is the
 * authorisation; guest details are copied from the existing booking.
 */
export async function rescheduleBooking(
  db: D1Database,
  input: RescheduleInput,
): Promise<GuestCancellable & { booking: BookingRow }> {
  const resolved = await resolveCancelToken(db, input.bookingId, input.token, input.secret);

  if (resolved.booking.status !== "confirmed") {
    throw new BookingError("This booking can no longer be rescheduled.", 409);
  }
  const nowMs = input.nowMs ?? Date.now();
  if (Date.parse(resolved.booking.end_at) <= nowMs) {
    throw new BookingError("This meeting has already taken place.", 409);
  }
  if (!isValidTimeZone(input.guestTimezone)) {
    throw new BookingError("Invalid timezone", 400);
  }

  let start: Date;
  try {
    start = parseIsoUtc(input.newStartAt);
  } catch {
    throw new BookingError("Invalid start time", 400);
  }
  if (start.getTime() < nowMs) throw new BookingError("That time is in the past", 422);

  const { host, eventType } = resolved;
  const end = addMinutes(start, eventType.duration_minutes);
  const startIso = isoUtc(start);
  const endIso = isoUtc(end);

  const hostDate = zonedDateString(start, host.timezone);
  if (!isYmd(hostDate)) throw new BookingError("Invalid start time", 400);

  // A Google-busy slot can never be rescheduled into even if the page was stale.
  const dayStart = zonedToUtc(hostDate, "00:00", host.timezone);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60_000);
  const extraBusy = input.fetchGoogleBusy
    ? await input.fetchGoogleBusy(
        host.id,
        dayStart.getTime() - 3_600_000,
        dayEnd.getTime() + 3_600_000,
      )
    : [];

  const { grid, free } = await getDaySlots(db, {
    hostId: host.id,
    hostTimezone: host.timezone,
    eventTypeId: eventType.id,
    durationMinutes: eventType.duration_minutes,
    bufferMinutes: eventType.buffer_minutes,
    seatsTotal: eventType.seats_total,
    dateYmd: hostDate,
    nowMs,
    extraBusy,
  });
  if (!grid.some((s) => s.startAt === startIso)) {
    throw new BookingError("That time is not available", 422);
  }
  if (!free.some((s) => s.startAt === startIso)) {
    throw new BookingError("This time slot is no longer available.", 409);
  }

  const booking = await rescheduleBookingIfFree(db, {
    oldBookingId: resolved.booking.id,
    userId: host.id,
    eventTypeId: eventType.id,
    guestName: resolved.booking.guest_name,
    guestEmail: resolved.booking.guest_email,
    startAt: startIso,
    endAt: endIso,
    timezone: input.guestTimezone,
    notes: resolved.booking.notes,
    now: nowIso(),
    bufferMinutes: eventType.buffer_minutes,
  });
  if (!booking) throw new BookingError("This booking can no longer be rescheduled.", 409);

  return { ...resolved, booking };
}

export interface GuestCancellable {
  booking: BookingRow;
  host: PublicUser;
  eventType: EventTypeRow;
}

/**
 * Resolves a signed guest cancellation link to the booking it authorises.
 *
 * Used by both the confirmation page and the cancel action, so an invalid token
 * is rejected identically whether it is being viewed or acted on.
 */
export async function resolveCancelToken(
  db: D1Database,
  bookingId: number,
  token: string,
  secret: string,
): Promise<GuestCancellable> {
  const signedFor = await verifyCancelToken(token, secret);
  // The id in the path must match the one inside the signature, so a valid
  // token for one booking cannot be pointed at another.
  if (signedFor === null || signedFor !== bookingId) {
    throw new BookingError("This cancellation link is not valid.", 404);
  }

  const booking = await getBookingById(db, bookingId);
  if (!booking) throw new BookingError("This cancellation link is not valid.", 404);

  const [host, eventType] = await Promise.all([
    findUserById(db, booking.user_id),
    getEventTypeById(db, booking.event_type_id),
  ]);
  if (!host || !eventType) throw new BookingError("This cancellation link is not valid.", 404);

  return { booking, host, eventType };
}

/** Cancels via a signed link. Idempotent, and refuses meetings already past. */
export async function cancelBookingByToken(
  db: D1Database,
  bookingId: number,
  token: string,
  secret: string,
  nowMs: number = Date.now(),
): Promise<GuestCancellable> {
  const resolved = await resolveCancelToken(db, bookingId, token, secret);

  if (resolved.booking.status === "cancelled") return resolved;
  if (resolved.booking.status !== "confirmed") {
    throw new BookingError("This booking can no longer be cancelled.", 409);
  }
  if (Date.parse(resolved.booking.end_at) <= nowMs) {
    throw new BookingError("This meeting has already taken place.", 409);
  }

  const cancelled = await cancelBookingById(db, bookingId, nowIso());
  // Lost a race with the host cancelling: the end state is the same either way.
  return { ...resolved, booking: cancelled ?? resolved.booking };
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
  await cancelAllAttendees(db, bookingId, nowIso());
  return cancelled;
}

export interface SeatResolution {
  booking: BookingRow;
  attendee: BookingAttendeeRow;
  eventType: EventTypeRow;
  host: PublicUser;
}

/**
 * Verifies a seat token and loads everything the seat pages need. The token
 * authorises exactly one attendee row; the id in the path must match it.
 */
export async function resolveSeatToken(
  db: D1Database,
  bookingId: number,
  attendeeId: number,
  token: string,
  secret: string,
): Promise<SeatResolution> {
  const payloadId = await verifyAttendeeToken(token, secret);
  if (payloadId === null || payloadId !== attendeeId) {
    throw new BookingError("This cancellation link is not valid.", 404);
  }
  const attendee = await getAttendeeForBooking(db, attendeeId, bookingId);
  if (!attendee) throw new BookingError("This cancellation link is not valid.", 404);
  const booking = await getBookingById(db, bookingId);
  if (!booking) throw new BookingError("Not found", 404);
  const host = await findUserById(db, booking.user_id);
  const eventType = await getEventTypeById(db, booking.event_type_id);
  if (!host || !eventType) throw new BookingError("Not found", 404);
  return { booking, attendee, eventType, host };
}

export interface CancelledSeat {
  booking: BookingRow;
  attendee: BookingAttendeeRow;
  /** Confirmed seats remaining after this cancellation. */
  seatsLeft: number;
}

/**
 * A guest releases one seat of a group slot. When the last seat goes, the slot
 * itself is released so the time becomes fully bookable again.
 */
export async function cancelAttendeeSeat(
  db: D1Database,
  bookingId: number,
  attendeeId: number,
  token: string,
  secret: string,
  nowMs?: number,
): Promise<CancelledSeat> {
  const { attendee, booking } = await resolveSeatToken(db, bookingId, attendeeId, token, secret);

  if (booking.status !== "confirmed") {
    throw new BookingError("This appointment has already been cancelled.", 409);
  }
  const now = nowMs ?? Date.now();
  if (Date.parse(booking.end_at) <= now) {
    throw new BookingError("This meeting has already taken place.", 409);
  }
  if (attendee.status !== "confirmed") {
    throw new BookingError("This seat was already cancelled.", 409);
  }

  const cancelled = await cancelAttendee(db, attendee.id, nowIso());
  if (!cancelled) throw new BookingError("This seat was already cancelled.", 409);

  const seatsLeft = await countConfirmedAttendees(db, booking.id);
  if (seatsLeft === 0) await cancelBookingById(db, booking.id, nowIso());

  return { booking, attendee, seatsLeft };
}
