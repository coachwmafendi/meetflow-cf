import { addMinutes, isoUtc } from "../lib/time";
import type { BookingAttendeeRow, BookingRow } from "../types";

export interface BusyInterval {
  id: number;
  start_at: string;
  end_at: string;
  event_type_id: number;
  /** Confirmed attendees on this slot (0 for private appointments). */
  seats_taken: number;
}

export async function listConfirmedBetween(
  db: D1Database,
  userId: number,
  fromIso: string,
  toIso: string,
): Promise<BusyInterval[]> {
  const { results } = await db
    .prepare(
      `SELECT b.id, b.start_at, b.end_at, b.event_type_id,
              (SELECT COUNT(*) FROM booking_attendees a
               WHERE a.booking_id = b.id AND a.status = 'confirmed') AS seats_taken
       FROM bookings b
       WHERE b.user_id = ?
         AND b.status = 'confirmed'
         AND b.start_at < ?
         AND b.end_at > ?`,
    )
    .bind(userId, toIso, fromIso)
    .all<BusyInterval>();
  return results;
}

export interface InsertBookingInput {  userId: number;
  eventTypeId: number;
  guestName: string;
  guestEmail: string;
  startAt: string;
  endAt: string;
  timezone: string;
  notes: string | null;
  bufferMinutes: number;
  now: string;
}

/**
 * Atomic conditional insert (ERD.md §9). Returns null when an overlapping
 * confirmed booking already exists — no interactive transaction required.
 * A second guard rejects starts that land inside another confirmed booking's
 * buffer window for the same event type.
 */
export async function insertBookingIfFree(
  db: D1Database,
  input: InsertBookingInput,
): Promise<BookingRow | null> {
  const bufferedEnd = isoUtc(addMinutes(new Date(input.endAt), input.bufferMinutes));
  const bufferedStart = isoUtc(addMinutes(new Date(input.startAt), -input.bufferMinutes));

  try {
    return await db
      .prepare(
        `INSERT INTO bookings (
           user_id, event_type_id, guest_name, guest_email,
           start_at, end_at, timezone, status, notes, created_at, updated_at
         )
         SELECT ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?
         WHERE NOT EXISTS (
           SELECT 1 FROM bookings
           WHERE user_id = ?
             AND status = 'confirmed'
             AND start_at < ?
             AND end_at > ?
         )
         AND NOT EXISTS (
           SELECT 1 FROM bookings
           WHERE user_id = ?
             AND status = 'confirmed'
             AND event_type_id = ?
             AND start_at < ?
             AND end_at > ?
         )
         RETURNING *`,
      )
      .bind(
        input.userId,
        input.eventTypeId,
        input.guestName,
        input.guestEmail,
        input.startAt,
        input.endAt,
        input.timezone,
        input.notes,
        input.now,
        input.now,
        input.userId,
        input.endAt,
        input.startAt,
        input.userId,
        input.eventTypeId,
        bufferedEnd,
        bufferedStart,
      )
      .first<BookingRow>();
  } catch (err) {
    // Partial unique index fired — same host, same start, already confirmed.
    if (String(err).includes("UNIQUE")) return null;
    throw err;
  }
}

export interface RescheduleInput {
  oldBookingId: number;
  userId: number;
  eventTypeId: number;
  guestName: string;
  guestEmail: string;
  startAt: string;
  endAt: string;
  timezone: string;
  notes: string | null;
  now: string;
  bufferMinutes: number;
}

/**
 * Reschedule: conditionally insert the new booking, then cancel the old one.
 * D1 has no interactive transactions, so the two statements run sequentially —
 * the insert happens first, and only a successful insert is followed by the
 * cancel, which means a taken slot never touches the old booking. If the old
 * booking was cancelled in a race, the freshly inserted row is rolled back so
 * the guest is never left with two confirmed bookings. (A crash between the
 * two statements could leave both confirmed; the window is one statement.)
 */
export async function rescheduleBookingIfFree(
  db: D1Database,
  input: RescheduleInput,
): Promise<BookingRow | null> {
  const bufferedEnd = isoUtc(addMinutes(new Date(input.endAt), input.bufferMinutes));
  const bufferedStart = isoUtc(addMinutes(new Date(input.startAt), -input.bufferMinutes));

  let newBooking: BookingRow | null;
  try {
    newBooking = await db
      .prepare(
        `INSERT INTO bookings (
         user_id, event_type_id, guest_name, guest_email,
         start_at, end_at, timezone, status, notes, created_at, updated_at
       )
       SELECT ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM bookings
         WHERE user_id = ?
           AND status = 'confirmed'
           AND start_at < ?
           AND end_at > ?
       )
       AND NOT EXISTS (
         SELECT 1 FROM bookings
         WHERE user_id = ?
           AND status = 'confirmed'
           AND event_type_id = ?
           AND start_at < ?
           AND end_at > ?
       )
       RETURNING *`,
      )
      .bind(
        input.userId,
        input.eventTypeId,
        input.guestName,
        input.guestEmail,
        input.startAt,
        input.endAt,
        input.timezone,
        input.notes,
        input.now,
        input.now,
        input.userId,
        input.endAt,
        input.startAt,
        input.userId,
        input.eventTypeId,
        bufferedEnd,
        bufferedStart,
      )
      .first<BookingRow>();
  } catch (err) {
    // Partial unique index fired — same host, same start, already confirmed.
    if (String(err).includes("UNIQUE")) return null;
    throw err;
  }
  if (!newBooking) return null;

  const cancelled = await db
    .prepare(
      `UPDATE bookings SET status = 'cancelled', updated_at = ?
       WHERE id = ? AND user_id = ? AND status = 'confirmed'
       RETURNING id`,
    )
    .bind(input.now, input.oldBookingId, input.userId)
    .first<{ id: number }>();
  if (!cancelled) {
    // Old booking was already cancelled — undo the insert we just made.
    await db
      .prepare("UPDATE bookings SET status = 'cancelled', updated_at = ? WHERE id = ?")
      .bind(input.now, newBooking.id)
      .run();
    return null;
  }

  return newBooking;
}

export async function getBookingOwned(
  db: D1Database,
  id: number,
  userId: number,
): Promise<BookingRow | null> {
  return db
    .prepare("SELECT * FROM bookings WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .first<BookingRow>();
}

export async function getBookingById(db: D1Database, id: number): Promise<BookingRow | null> {
  return db.prepare("SELECT * FROM bookings WHERE id = ?").bind(id).first<BookingRow>();
}

/** The confirmed booking holding a given slot, when one exists. */
export async function getConfirmedSlotBooking(
  db: D1Database,
  userId: number,
  eventTypeId: number,
  startAt: string,
): Promise<BookingRow | null> {
  return db
    .prepare(
      `SELECT * FROM bookings
       WHERE user_id = ? AND event_type_id = ? AND start_at = ? AND status = 'confirmed'
       LIMIT 1`,
    )
    .bind(userId, eventTypeId, startAt)
    .first<BookingRow>();
}

export async function cancelBooking(
  db: D1Database,
  id: number,
  userId: number,
  now: string,
): Promise<BookingRow | null> {
  return db
    .prepare(
      `UPDATE bookings SET status = 'cancelled', updated_at = ?
       WHERE id = ? AND user_id = ? AND status = 'confirmed'
       RETURNING *`,
    )
    .bind(now, id, userId)
    .first<BookingRow>();
}

/**
 * Cancels by id alone, for signed guest links. Ownership is proven by the token
 * before this is called; the status guard keeps it idempotent.
 */
export async function cancelBookingById(
  db: D1Database,
  id: number,
  now: string,
): Promise<BookingRow | null> {
  return db
    .prepare(
      `UPDATE bookings SET status = 'cancelled', updated_at = ?
       WHERE id = ? AND status = 'confirmed'
       RETURNING *`,
    )
    .bind(now, id)
    .first<BookingRow>();
}

export interface BookingWithEvent extends BookingRow {
  event_name: string;
  seats_total: number;
  seats_taken: number;
}

export async function listBookings(
  db: D1Database,
  userId: number,
  scope: "upcoming" | "past" | "cancelled",
  nowIsoString: string,
): Promise<BookingWithEvent[]> {
  const where =
    scope === "cancelled"
      ? "b.status = 'cancelled'"
      : scope === "past"
        ? "b.status != 'cancelled' AND b.end_at <= ?"
        : "b.status = 'confirmed' AND b.end_at > ?";
  const order = scope === "upcoming" ? "ASC" : "DESC";

  const stmt = db.prepare(
    `SELECT b.*, e.name AS event_name, e.seats_total,
            (SELECT COUNT(*) FROM booking_attendees a
             WHERE a.booking_id = b.id AND a.status = 'confirmed') AS seats_taken
     FROM bookings b
     JOIN event_types e ON e.id = b.event_type_id
     WHERE b.user_id = ? AND ${where}
     ORDER BY b.start_at ${order}
     LIMIT 200`,
  );
  const bound = scope === "cancelled" ? stmt.bind(userId) : stmt.bind(userId, nowIsoString);
  const { results } = await bound.all<BookingWithEvent>();
  return results;
}

export interface DashboardStats {
  upcoming: number;
  today: number;
  total: number;
  activeEventTypes: number;
}

export async function dashboardStats(
  db: D1Database,
  userId: number,
  nowIsoString: string,
  dayStartIso: string,
  dayEndIso: string,
): Promise<DashboardStats> {
  const [upcoming, today, total, active] = await db.batch<{ n: number }>([
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM bookings WHERE user_id = ? AND status = 'confirmed' AND end_at > ?",
      )
      .bind(userId, nowIsoString),
    db
      .prepare(
        "SELECT COUNT(*) AS n FROM bookings WHERE user_id = ? AND status = 'confirmed' AND start_at >= ? AND start_at < ?",
      )
      .bind(userId, dayStartIso, dayEndIso),
    db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE user_id = ?").bind(userId),
    db
      .prepare("SELECT COUNT(*) AS n FROM event_types WHERE user_id = ? AND is_active = 1")
      .bind(userId),
  ]);
  return {
    upcoming: upcoming?.results[0]?.n ?? 0,
    today: today?.results[0]?.n ?? 0,
    total: total?.results[0]?.n ?? 0,
    activeEventTypes: active?.results[0]?.n ?? 0,
  };
}
