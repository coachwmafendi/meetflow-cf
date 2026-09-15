import type { BookingAttendeeRow } from "../types";

/**
 * Ticket codes: "MF-XXXX-XXXX" from an unambiguous 31-char alphabet (no
 * 0/O/1/I/L), so a guest can read one out over the phone without mistakes.
 */
const TICKET_ALPHABET = "23456789ABCDEFGHJKMNPQRSTUVWXYZ";

function randomChunk(): string {
  const bytes = new Uint8Array(4);
  crypto.getRandomValues(bytes);
  return Array.from(bytes, (b) => TICKET_ALPHABET[b % TICKET_ALPHABET.length]).join("");
}

export function generateTicketCode(): string {
  return `MF-${randomChunk()}-${randomChunk()}`;
}

export interface InsertAttendeeInput {
  bookingId: number;
  guestName: string;
  guestEmail: string;
  notes: string | null;
  timezone: string;
  now: string;
  /** Generated when absent; the UNIQUE index makes a collision a retry. */
  ticketCode?: string;
}

/**
 * One confirmed seat per email per slot; a cancelled guest may rejoin later.
 * The UNIQUE partial index fires on duplicates — callers catch and map.
 */
export async function insertAttendee(
  db: D1Database,
  input: InsertAttendeeInput,
): Promise<BookingAttendeeRow | null> {
  // Callers pre-check the (booking, email) duplicate, so a UNIQUE failure here
  // is a ticket-code collision — retry with a fresh code, then give up.
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = input.ticketCode ?? generateTicketCode();
    try {
      return await db
        .prepare(
          `INSERT INTO booking_attendees (
             booking_id, guest_name, guest_email, notes, timezone, status,
             ticket_code, created_at, updated_at
           )
           VALUES (?, ?, ?, ?, ?, 'confirmed', ?, ?, ?)
           RETURNING *`,
        )
        .bind(
          input.bookingId,
          input.guestName,
          input.guestEmail,
          input.notes,
          input.timezone,
          code,
          input.now,
          input.now,
        )
        .first<BookingAttendeeRow>();
    } catch (err) {
      if (String(err).includes("UNIQUE")) {
        if (input.ticketCode) return null;
        continue;
      }
      throw err;
    }
  }
  return null;
}

/**
 * Atomically takes one seat on a booked slot: the insert only lands while the
 * slot's confirmed-attendee count is below the event type's seats_total, so
 * two concurrent guests can never take the last seat twice.
 */
export async function joinBookingIfSeatsFree(
  db: D1Database,
  input: InsertAttendeeInput,
): Promise<BookingAttendeeRow | null> {
  for (let attempt = 0; attempt < 3; attempt++) {
    const code = input.ticketCode ?? generateTicketCode();
    try {
      return await db
        .prepare(
          `INSERT INTO booking_attendees (
             booking_id, guest_name, guest_email, notes, timezone, status,
             ticket_code, created_at, updated_at
           )
           SELECT ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?
           WHERE EXISTS (
             SELECT 1 FROM bookings b
             JOIN event_types e ON e.id = b.event_type_id
             WHERE b.id = ?
               AND b.status = 'confirmed'
               AND e.seats_total > (
                 SELECT COUNT(*) FROM booking_attendees a
                 WHERE a.booking_id = b.id AND a.status = 'confirmed'
               )
           )
           RETURNING *`,
        )
        .bind(
          input.bookingId,
          input.guestName,
          input.guestEmail,
          input.notes,
          input.timezone,
          code,
          input.now,
          input.now,
          input.bookingId,
        )
        .first<BookingAttendeeRow>();
    } catch (err) {
      if (String(err).includes("UNIQUE")) {
        // Either a duplicate email (pre-checked by callers) or a code
        // collision — one retry covers the collision.
        if (input.ticketCode) return null;
        continue;
      }
      throw err;
    }
  }
  return null;
}

export async function listAttendees(
  db: D1Database,
  bookingId: number,
): Promise<BookingAttendeeRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM booking_attendees WHERE booking_id = ? ORDER BY created_at, id`,
    )
    .bind(bookingId)
    .all<BookingAttendeeRow>();
  return results;
}

export function listConfirmedAttendees(
  db: D1Database,
  bookingId: number,
): Promise<BookingAttendeeRow[]> {
  return listAttendees(db, bookingId).then((rows) =>
    rows.filter((r) => r.status === "confirmed"),
  );
}

export async function getAttendeeById(
  db: D1Database,
  attendeeId: number,
): Promise<BookingAttendeeRow | null> {
  return db
    .prepare("SELECT * FROM booking_attendees WHERE id = ?")
    .bind(attendeeId)
    .first<BookingAttendeeRow>();
}

export async function getAttendeeForBooking(
  db: D1Database,
  attendeeId: number,
  bookingId: number,
): Promise<BookingAttendeeRow | null> {
  return db
    .prepare("SELECT * FROM booking_attendees WHERE id = ? AND booking_id = ?")
    .bind(attendeeId, bookingId)
    .first<BookingAttendeeRow>();
}

export async function cancelAttendee(
  db: D1Database,
  attendeeId: number,
  now: string,
): Promise<boolean> {
  const res = await db
    .prepare(
      `UPDATE booking_attendees SET status = 'cancelled', updated_at = ?
       WHERE id = ? AND status = 'confirmed'`,
    )
    .bind(now, attendeeId)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export async function countConfirmedAttendees(
  db: D1Database,
  bookingId: number,
): Promise<number> {
  const row = await db
    .prepare(
      `SELECT COUNT(*) AS n FROM booking_attendees WHERE booking_id = ? AND status = 'confirmed'`,
    )
    .bind(bookingId)
    .first<{ n: number }>();
  return row?.n ?? 0;
}

/** Host cancelled the whole slot: every seat goes with it. */
export async function cancelAllAttendees(
  db: D1Database,
  bookingId: number,
  now: string,
): Promise<void> {
  await db
    .prepare(
      `UPDATE booking_attendees SET status = 'cancelled', updated_at = ?
       WHERE booking_id = ? AND status = 'confirmed'`,
    )
    .bind(now, bookingId)
    .run();
}
