export interface SearchResultBooking {
  id: number;
  guest_name: string;
  guest_email: string;
  start_at: string;
  status: string;
  event_name: string;
}

export interface SearchResultEventType {
  id: number;
  name: string;
  slug: string;
  is_active: number;
}

export interface SearchResultAttendee {
  booking_id: number;
  guest_name: string;
  guest_email: string;
}

/**
 * Escapes LIKE wildcards so the guest's text matches literally: a query of
 * "%ahmad%" must not be read as a pattern.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

const ESCAPE_CLAUSE = `ESCAPE '\\'`;

export async function searchBookings(
  db: D1Database,
  userId: number,
  q: string,
  limit = 5,
): Promise<SearchResultBooking[]> {
  const pattern = `%${escapeLike(q)}%`;
  const { results } = await db
    .prepare(
      `SELECT b.id, b.guest_name, b.guest_email, b.start_at, b.status, e.name AS event_name
       FROM bookings b
       JOIN event_types e ON e.id = b.event_type_id
       WHERE b.user_id = ?
         AND (b.guest_name LIKE ? ${ESCAPE_CLAUSE}
           OR b.guest_email LIKE ? ${ESCAPE_CLAUSE}
           OR b.notes LIKE ? ${ESCAPE_CLAUSE})
       ORDER BY b.start_at DESC
       LIMIT ?`,
    )
    .bind(userId, pattern, pattern, pattern, limit)
    .all<SearchResultBooking>();
  return results;
}

export async function searchEventTypes(
  db: D1Database,
  userId: number,
  q: string,
  limit = 5,
): Promise<SearchResultEventType[]> {
  const pattern = `%${escapeLike(q)}%`;
  const { results } = await db
    .prepare(
      `SELECT id, name, slug, is_active
       FROM event_types
       WHERE user_id = ?
         AND (name LIKE ? ${ESCAPE_CLAUSE}
           OR slug LIKE ? ${ESCAPE_CLAUSE}
           OR description LIKE ? ${ESCAPE_CLAUSE})
       ORDER BY name
       LIMIT ?`,
    )
    .bind(userId, pattern, pattern, pattern, limit)
    .all<SearchResultEventType>();
  return results;
}

export async function searchAttendees(
  db: D1Database,
  userId: number,
  q: string,
  limit = 5,
): Promise<SearchResultAttendee[]> {
  const pattern = `%${escapeLike(q)}%`;
  const { results } = await db
    .prepare(
      `SELECT a.booking_id, a.guest_name, a.guest_email
       FROM booking_attendees a
       JOIN bookings b ON b.id = a.booking_id
       WHERE b.user_id = ?
         AND (a.guest_name LIKE ? ${ESCAPE_CLAUSE} OR a.guest_email LIKE ? ${ESCAPE_CLAUSE})
       ORDER BY a.created_at DESC
       LIMIT ?`,
    )
    .bind(userId, pattern, pattern, limit)
    .all<SearchResultAttendee>();
  return results;
}

/** The 3 latest bookings, shown as "Recent" when the palette opens empty. */
export async function recentBookings(
  db: D1Database,
  userId: number,
  limit = 3,
): Promise<SearchResultBooking[]> {
  const { results } = await db
    .prepare(
      `SELECT b.id, b.guest_name, b.guest_email, b.start_at, b.status, e.name AS event_name
       FROM bookings b
       JOIN event_types e ON e.id = b.event_type_id
       WHERE b.user_id = ?
       ORDER BY b.created_at DESC
       LIMIT ?`,
    )
    .bind(userId, limit)
    .all<SearchResultBooking>();
  return results;
}
