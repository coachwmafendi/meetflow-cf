import type { PublicUser, UserRow } from "../types";

const PUBLIC_COLUMNS = "id, name, email, slug, timezone, created_at, updated_at";

export async function findUserByEmail(db: D1Database, email: string): Promise<UserRow | null> {
  return db.prepare("SELECT * FROM users WHERE email = ?").bind(email).first<UserRow>();
}

export async function findUserById(db: D1Database, id: number): Promise<PublicUser | null> {
  return db
    .prepare(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = ?`)
    .bind(id)
    .first<PublicUser>();
}

export async function findUserBySlug(db: D1Database, slug: string): Promise<PublicUser | null> {
  return db
    .prepare(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE slug = ?`)
    .bind(slug)
    .first<PublicUser>();
}

export interface InsertUserInput {
  name: string;
  email: string;
  passwordHash: string;
  slug: string;
  timezone: string;
  now: string;
}

export async function insertUser(db: D1Database, input: InsertUserInput): Promise<PublicUser> {
  const row = await db
    .prepare(
      `INSERT INTO users (name, email, password_hash, slug, timezone, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING ${PUBLIC_COLUMNS}`,
    )
    .bind(
      input.name,
      input.email,
      input.passwordHash,
      input.slug,
      input.timezone,
      input.now,
      input.now,
    )
    .first<PublicUser>();
  if (!row) throw new Error("Failed to insert user");
  return row;
}

export async function updateUserSettings(
  db: D1Database,
  userId: number,
  fields: { name: string; timezone: string; now: string },
): Promise<PublicUser | null> {
  return db
    .prepare(
      `UPDATE users SET name = ?, timezone = ?, updated_at = ?
       WHERE id = ?
       RETURNING ${PUBLIC_COLUMNS}`,
    )
    .bind(fields.name, fields.timezone, fields.now, userId)
    .first<PublicUser>();
}
