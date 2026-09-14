export interface SavedLocationRow {
  id: number;
  user_id: number;
  location_type: string;
  location_value: string;
  created_at: string;
}

export async function listSavedLocations(
  db: D1Database,
  userId: number,
  locationType: string,
): Promise<SavedLocationRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM saved_locations
       WHERE user_id = ? AND location_type = ?
       ORDER BY created_at DESC, id DESC
       LIMIT 20`,
    )
    .bind(userId, locationType)
    .all<SavedLocationRow>();
  return results;
}

/**
 * Remembers a link the host used; reusing one bumps it to the top of the list
 * rather than duplicating it.
 */
export async function upsertSavedLocation(
  db: D1Database,
  userId: number,
  locationType: string,
  locationValue: string,
  now: string,
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO saved_locations (user_id, location_type, location_value, created_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id, location_type, location_value)
       DO UPDATE SET created_at = excluded.created_at`,
    )
    .bind(userId, locationType, locationValue, now)
    .run();
}
