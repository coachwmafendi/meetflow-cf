import { upsertSavedLocation } from "./savedLocations";
import type { EventTypeRow } from "../types";

const LINK_TYPES = ["google_meet", "zoom"];

/** Meeting links are remembered so later forms can offer them as choices. */
async function rememberLocation(
  db: D1Database,
  userId: number,
  locationType: string,
  locationValue: string | null,
  now: string,
): Promise<void> {
  if (LINK_TYPES.includes(locationType) && locationValue) {
    await upsertSavedLocation(db, userId, locationType, locationValue, now);
  }
}

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

export async function getEventTypeById(db: D1Database, id: number): Promise<EventTypeRow | null> {
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
  bufferMinutes: number;
  /** Guests a single slot can hold (1 = private). */
  seatsTotal: number;
  locationType: string;
  locationValue: string | null;
  now: string;
}

export async function insertEventType(
  db: D1Database,
  input: InsertEventTypeInput,
): Promise<EventTypeRow> {
  const row = await db
    .prepare(
      `INSERT INTO event_types (user_id, name, slug, description, duration_minutes, buffer_minutes, seats_total, location_type, location_value, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
       RETURNING *`,
    )
    .bind(
      input.userId,
      input.name,
      input.slug,
      input.description,
      input.durationMinutes,
      input.bufferMinutes,
      input.seatsTotal,
      input.locationType,
      input.locationValue,
      input.now,
      input.now,
    )
    .first<EventTypeRow>();
  if (!row) throw new Error("Failed to insert event type");
  await rememberLocation(db, input.userId, input.locationType, input.locationValue, input.now);
  return row;
}

export interface UpdateEventTypeInput {
  name: string;
  slug: string;
  description: string | null;
  durationMinutes: number;
  bufferMinutes: number;
  /** Guests a single slot can hold (1 = private). */
  seatsTotal: number;
  locationType: string;
  locationValue: string | null;
  isActive: number;
  now: string;
}

export async function updateEventType(
  db: D1Database,
  id: number,
  userId: number,
  input: UpdateEventTypeInput,
): Promise<EventTypeRow | null> {
  const row = await db
    .prepare(
      `UPDATE event_types
       SET name = ?, slug = ?, description = ?, duration_minutes = ?, buffer_minutes = ?,
           location_type = ?, location_value = ?, is_active = ?, updated_at = ?
       WHERE id = ? AND user_id = ?
       RETURNING *`,
    )
    .bind(
      input.name,
      input.slug,
      input.description,
      input.durationMinutes,
      input.bufferMinutes,
      input.seatsTotal,
      input.locationType,
      input.locationValue,
      input.isActive,
      input.now,
      id,
      userId,
    )
    .first<EventTypeRow>();
  if (row) await rememberLocation(db, userId, input.locationType, input.locationValue, input.now);
  return row;
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
