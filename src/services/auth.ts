import { findUserByEmail, insertUser } from "../db/users";
import { hashPassword, verifyPassword } from "../lib/password";
import { nowIso } from "../lib/time";
import { isValidTimeZone } from "../lib/timezone";
import { isAvailableSlug, isEmail } from "../lib/validate";
import type { PublicUser } from "../types";

/** A hash of a value nobody can supply, used to equalise login timing. */
const DUMMY_HASH =
  "pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=";

export class AuthError extends Error {
  constructor(
    message: string,
    public readonly status: 400 | 409 = 400,
  ) {
    super(message);
    this.name = "AuthError";
  }
}

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  slug: string;
  timezone: string;
}

export async function register(db: D1Database, input: RegisterInput): Promise<PublicUser> {
  const email = input.email.trim().toLowerCase();
  const slug = input.slug.trim().toLowerCase();

  if (!isEmail(email)) throw new AuthError("Invalid email");
  if (!isAvailableSlug(slug)) throw new AuthError("Username already taken", 409);
  if (input.password.length < 8) throw new AuthError("Password must be at least 8 characters");
  if (!isValidTimeZone(input.timezone)) throw new AuthError("Invalid timezone");

  const name = input.name.trim();
  if (!name || name.length > 100) throw new AuthError("Name is required");

  const passwordHash = await hashPassword(input.password);

  try {
    return await insertUser(db, {
      name,
      email,
      passwordHash,
      slug,
      timezone: input.timezone,
      now: nowIso(),
    });
  } catch (err) {
    const message = String(err);
    if (message.includes("users.email")) throw new AuthError("Email already registered", 409);
    if (message.includes("users.slug")) throw new AuthError("Username already taken", 409);
    throw err;
  }
}

export async function login(
  db: D1Database,
  email: string,
  password: string,
): Promise<PublicUser | null> {
  const row = await findUserByEmail(db, email.trim().toLowerCase());
  if (!row) {
    // Equalise timing so a missing account is not distinguishable from a bad password.
    await verifyPassword(password, DUMMY_HASH);
    return null;
  }
  if (!(await verifyPassword(password, row.password_hash))) return null;

  const { password_hash: _ignored, ...publicUser } = row;
  return publicUser;
}

/* ------------------------- Password reset -------------------------------- */

/** One hour to use a reset link. */
const RESET_TTL_MS = 3_600_000;

async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Creates a single-use reset token for the account. Always succeeds silently —
 * the caller must not reveal whether the address exists. Any previous unused
 * tokens for the account are voided.
 */
export async function createPasswordReset(db: D1Database, email: string): Promise<string | null> {
  const user = await findUserByEmail(db, email.trim().toLowerCase());
  if (!user) return null;

  const tokenBytes = new Uint8Array(32);
  crypto.getRandomValues(tokenBytes);
  const token = [...tokenBytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  const now = nowIso();

  await db.batch([
    db.prepare("DELETE FROM password_resets WHERE user_id = ? AND used_at IS NULL").bind(user.id),
    db
      .prepare(
        `INSERT INTO password_resets (user_id, token_hash, expires_at, created_at)
         VALUES (?, ?, ?, ?)`,
      )
      .bind(
        user.id,
        await sha256Hex(token),
        new Date(Date.now() + RESET_TTL_MS).toISOString(),
        now,
      ),
  ]);
  return token;
}

/** Consumes the token and swaps the password. One use, time-boxed. */
export async function resetPassword(
  db: D1Database,
  token: string,
  newPassword: string,
): Promise<void> {
  if (newPassword.length < 8) throw new AuthError("Password must be at least 8 characters");
  const row = await db
    .prepare(
      `SELECT r.id, r.user_id FROM password_resets r
        WHERE r.token_hash = ? AND r.used_at IS NULL AND r.expires_at > ?`,
    )
    .bind(await sha256Hex(token), nowIso())
    .first<{ id: number; user_id: number }>();
  if (!row) throw new AuthError("This reset link is invalid or has expired", 400);

  const passwordHash = await hashPassword(newPassword);
  await db.batch([
    db
      .prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?")
      .bind(passwordHash, nowIso(), row.user_id),
    db.prepare("UPDATE password_resets SET used_at = ? WHERE id = ?").bind(nowIso(), row.id),
  ]);
}
