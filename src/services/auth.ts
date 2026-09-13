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
