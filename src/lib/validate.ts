export const RESERVED_SLUGS = new Set([
  "api",
  "dashboard",
  "login",
  "logout",
  "register",
  "booking",
  "bookings",
  "public",
  "assets",
  "static",
  "admin",
  "settings",
  "healthz",
  "app",
  "privacy",
  "terms",
]);

/** Public usernames: 3-32 chars, so the /:username namespace stays readable. */
const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/;
/** Event slugs live under a username, so 1-60 chars is fine ("c", "30", "1-1"). */
const EVENT_SLUG = /^[a-z0-9](?:[a-z0-9-]{0,58}[a-z0-9])?$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function isSlug(value: string): boolean {
  return SLUG.test(value);
}

export function isEventSlug(value: string): boolean {
  return EVENT_SLUG.test(value);
}

export function isAvailableSlug(value: string): boolean {
  return isSlug(value) && !RESERVED_SLUGS.has(value);
}

export function isEmail(value: string): boolean {
  return EMAIL.test(value) && value.length <= 254;
}

export function isHhmm(value: string): boolean {
  return HHMM.test(value);
}

export function isYmd(value: string): boolean {
  if (!YMD.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export const LOCATION_TYPES = ["none", "google_meet", "zoom", "in_person", "phone"] as const;

export type LocationType = (typeof LOCATION_TYPES)[number];

export function isLocationType(value: string): value is LocationType {
  return (LOCATION_TYPES as readonly string[]).includes(value);
}

/**
 * Normalizes a location value: link types get an https:// prefix when the host
 * pasted a bare domain. Empty values collapse to null.
 */
export function normalizeLocationValue(type: string, value: string): string | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if ((type === "google_meet" || type === "zoom") && !/^https?:\/\//i.test(trimmed)) {
    return `https://${trimmed}`;
  }
  return trimmed;
}

export class ValidationError extends Error {
  constructor(
    public readonly field: string,
    message: string,
  ) {
    super(message);
    this.name = "ValidationError";
  }
}

export function requireString(
  body: Record<string, unknown>,
  field: string,
  { min = 1, max = 255 }: { min?: number; max?: number } = {},
): string {
  const raw = body[field];
  if (typeof raw !== "string") throw new ValidationError(field, `${field} is required`);
  const value = raw.trim();
  if (value.length < min) throw new ValidationError(field, `${field} is too short`);
  if (value.length > max) throw new ValidationError(field, `${field} is too long`);
  return value;
}

export function optionalString(
  body: Record<string, unknown>,
  field: string,
  max = 2000,
): string | null {
  const raw = body[field];
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string") throw new ValidationError(field, `${field} must be text`);
  const value = raw.trim();
  if (value.length > max) throw new ValidationError(field, `${field} is too long`);
  return value || null;
}

export function requireInt(
  body: Record<string, unknown>,
  field: string,
  { min, max }: { min: number; max: number },
): number {
  const value = Number(body[field]);
  if (!Number.isInteger(value)) throw new ValidationError(field, `${field} must be a whole number`);
  if (value < min || value > max) throw new ValidationError(field, `${field} is out of range`);
  return value;
}
