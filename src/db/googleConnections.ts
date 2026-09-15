import type { GoogleConnectionRow } from "../types";

export async function getGoogleConnection(
  db: D1Database,
  userId: number,
): Promise<GoogleConnectionRow | null> {
  return db
    .prepare("SELECT * FROM google_connections WHERE user_id = ?")
    .bind(userId)
    .first<GoogleConnectionRow>();
}

/** The connected Google account email, for display on the settings page. */
export async function getConnectedGoogleEmail(
  db: D1Database,
  userId: number,
): Promise<string | null> {
  const row = await db
    .prepare("SELECT google_email FROM google_connections WHERE user_id = ?")
    .bind(userId)
    .first<{ google_email: string }>();
  return row?.google_email ?? null;
}

export async function upsertGoogleConnection(
  db: D1Database,
  input: {
    userId: number;
    googleEmail: string;
    encRefresh: string;
    encAccess: string;
    accessExpiresAt: number;
    now: string;
  },
): Promise<void> {
  await db
    .prepare(
      `INSERT INTO google_connections (
         user_id, google_email, enc_refresh, enc_access, access_expires_at, created_at, updated_at
       )
       VALUES (?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         google_email = excluded.google_email,
         enc_refresh = excluded.enc_refresh,
         enc_access = excluded.enc_access,
         access_expires_at = excluded.access_expires_at,
         updated_at = excluded.updated_at`,
    )
    .bind(
      input.userId,
      input.googleEmail,
      input.encRefresh,
      input.encAccess,
      input.accessExpiresAt,
      input.now,
      input.now,
    )
    .run();
}

/** Persists a rotated access token without touching the stored refresh token. */
export async function updateGoogleAccessTokens(
  db: D1Database,
  userId: number,
  encAccess: string,
  accessExpiresAt: number,
  now: string,
): Promise<void> {
  await db
    .prepare(
      "UPDATE google_connections SET enc_access = ?, access_expires_at = ?, updated_at = ? WHERE user_id = ?",
    )
    .bind(encAccess, accessExpiresAt, now, userId)
    .run();
}

export async function deleteGoogleConnection(db: D1Database, userId: number): Promise<void> {
  await db.prepare("DELETE FROM google_connections WHERE user_id = ?").bind(userId).run();
}
