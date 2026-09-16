import type { EventDateRow } from "../types";

export interface EventDateInput {
  /** YYYY-MM-DD in the host's timezone. */
  date: string;
  /** HH:MM in the host's timezone; end must be after start. */
  startTime: string;
  endTime: string;
}

export async function listEventDates(db: D1Database, eventTypeId: number): Promise<EventDateRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM event_dates
       WHERE event_type_id = ?
       ORDER BY date, start_time, id`,
    )
    .bind(eventTypeId)
    .all<EventDateRow>();
  return results;
}

export async function listEventDatesForDay(
  db: D1Database,
  eventTypeId: number,
  dateYmd: string,
): Promise<EventDateRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM event_dates
       WHERE event_type_id = ? AND date = ?
       ORDER BY start_time, id`,
    )
    .bind(eventTypeId, dateYmd)
    .all<EventDateRow>();
  return results;
}

export async function listEventDatesBetween(
  db: D1Database,
  eventTypeId: number,
  fromYmd: string,
  toYmd: string,
): Promise<EventDateRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM event_dates
       WHERE event_type_id = ? AND date >= ? AND date <= ?
       ORDER BY date, start_time, id`,
    )
    .bind(eventTypeId, fromYmd, toYmd)
    .all<EventDateRow>();
  return results;
}

/**
 * Replaces the event type's entire date set atomically. An empty list is the
 * normal way to clear dates when the host switches back to the weekly grid.
 */
export async function replaceEventDates(
  db: D1Database,
  eventTypeId: number,
  dates: EventDateInput[],
  now: string,
): Promise<void> {
  const statements: D1PreparedStatement[] = [
    db.prepare("DELETE FROM event_dates WHERE event_type_id = ?").bind(eventTypeId),
  ];
  for (const d of dates) {
    statements.push(
      db
        .prepare(
          `INSERT INTO event_dates (event_type_id, date, start_time, end_time, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        )
        .bind(eventTypeId, d.date, d.startTime, d.endTime, now, now),
    );
  }
  await db.batch(statements);
}
