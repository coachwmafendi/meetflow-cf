import type { EventTypeRow } from "../types";

export async function listEventTypes(db: D1Database, userId: number): Promise<EventTypeRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM event_types WHERE user_id = ? ORDER BY created_at DESC, id DESC")
    .bind(userId)
    .all<EventTypeRow>();
  return results;
}

export async function getEventTypeOwned(
  db: D1Database,
  id: number,
  userId: number,
): Promise<EventTypeRow | null> {
  return db
    .prepare("SELECT * FROM event_types WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .first<EventTypeRow>();
}

export async function getEventTypeById(
  db: D1Database,
  id: number,
): Promise<EventTypeRow | null> {
  return db.prepare("SELECT * FROM event_types WHERE id = ?").bind(id).first<EventTypeRow>();
}

export async function getPublicEventType(
  db: D1Database,
  userId: number,
  slug: string,
): Promise<EventTypeRow | null> {
  return db
    .prepare("SELECT * FROM event_types WHERE user_id = ? AND slug = ? AND is_active = 1")
    .bind(userId, slug)
    .first<EventTypeRow>();
}

export async function listPublicEventTypes(
  db: D1Database,
  userId: number,
): Promise<EventTypeRow[]> {
  const { results } = await db
    .prepare(
      "SELECT * FROM event_types WHERE user_id = ? AND is_active = 1 ORDER BY duration_minutes",
    )
    .bind(userId)
    .all<EventTypeRow>();
  return results;
}

export interface InsertEventTypeInput {
  userId: number;
  name: string;
  slug: string;
  description: string | null;
  durationMinutes: number;
  now: string;
}

export async function insertEventType(
  db: D1Database,
  input: InsertEventTypeInput,
): Promise<EventTypeRow> {
  const row = await db
    .prepare(
      `INSERT INTO event_types (user_id, name, slug, description, duration_minutes, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)
       RETURNING *`,
    )
    .bind(
      input.userId,
      input.name,
      input.slug,
      input.description,
      input.durationMinutes,
      input.now,
      input.now,
    )
    .first<EventTypeRow>();
  if (!row) throw new Error("Failed to insert event type");
  return row;
}

export interface UpdateEventTypeInput {
  name: string;
  slug: string;
  description: string | null;
  durationMinutes: number;
  isActive: number;
  now: string;
}

export async function updateEventType(
  db: D1Database,
  id: number,
  userId: number,
  input: UpdateEventTypeInput,
): Promise<EventTypeRow | null> {
  return db
    .prepare(
      `UPDATE event_types
       SET name = ?, slug = ?, description = ?, duration_minutes = ?, is_active = ?, updated_at = ?
       WHERE id = ? AND user_id = ?
       RETURNING *`,
    )
    .bind(
      input.name,
      input.slug,
      input.description,
      input.durationMinutes,
      input.isActive,
      input.now,
      id,
      userId,
    )
    .first<EventTypeRow>();
}

export async function deleteEventType(
  db: D1Database,
  id: number,
  userId: number,
): Promise<boolean> {
  const res = await db
    .prepare("DELETE FROM event_types WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export async function countBookingsForEventType(db: D1Database, id: number): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM bookings WHERE event_type_id = ?")
    .bind(id)
    .first<{ n: number }>();
  return row?.n ?? 0;
}
