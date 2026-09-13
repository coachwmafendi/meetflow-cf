import type { BookingRow } from "../types";

export interface BusyInterval {
  start_at: string;
  end_at: string;
}

export async function listConfirmedBetween(
  db: D1Database,
  userId: number,
  fromIso: string,
  toIso: string,
): Promise<BusyInterval[]> {
  const { results } = await db
    .prepare(
      `SELECT start_at, end_at FROM bookings
       WHERE user_id = ?
         AND status = 'confirmed'
         AND start_at < ?
         AND end_at > ?`,
    )
    .bind(userId, toIso, fromIso)
    .all<BusyInterval>();
  return results;
}

export interface InsertBookingInput {
  userId: number;
  eventTypeId: number;
  guestName: string;
  guestEmail: string;
  startAt: string;
  endAt: string;
  timezone: string;
  notes: string | null;
  now: string;
}

/**
 * Atomic conditional insert (ERD.md §9). Returns null when an overlapping
 * confirmed booking already exists — no interactive transaction required.
 */
export async function insertBookingIfFree(
  db: D1Database,
  input: InsertBookingInput,
): Promise<BookingRow | null> {
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
      )
      .first<BookingRow>();
  } catch (err) {
    // Partial unique index fired — same host, same start, already confirmed.
    if (String(err).includes("UNIQUE")) return null;
    throw err;
  }
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

export interface BookingWithEvent extends BookingRow {
  event_name: string;
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
    `SELECT b.*, e.name AS event_name
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
    upcoming: upcoming.results[0]?.n ?? 0,
    today: today.results[0]?.n ?? 0,
    total: total.results[0]?.n ?? 0,
    activeEventTypes: active.results[0]?.n ?? 0,
  };
}
