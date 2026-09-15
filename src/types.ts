/**
 * Worker bindings. Generated from wrangler.jsonc by `wrangler types` into
 * worker-configuration.d.ts, plus the secrets declared in src/env.d.ts.
 * Re-run `npx wrangler types` after changing bindings.
 */
export type Env = Cloudflare.Env;

export interface UserRow {
  id: number;
  name: string;
  email: string;
  password_hash: string;
  slug: string;
  timezone: string;
  /** R2 object key, or null while the host still uses their monogram. */
  avatar_key: string | null;
  created_at: string;
  updated_at: string;
}

export type PublicUser = Omit<UserRow, "password_hash">;

export interface EventTypeRow {
  id: number;
  user_id: number;
  name: string;
  slug: string;
  description: string | null;
  duration_minutes: number;
  /** Minutes of gap left after each booking of this type (0 = none). */
  buffer_minutes: number;
  /** Guests a single slot can hold. 1 = private appointment; N > 1 = group. */
  seats_total: number;
  is_active: number;
  /** "none" | "google_meet" | "zoom" | "in_person" | "phone" */
  location_type: string;
  /** Meet/Zoom URL, street address, or phone number; null when unset. */
  location_value: string | null;
  created_at: string;
  updated_at: string;
}

export interface AvailabilityRuleRow {
  id: number;
  user_id: number;
  day_of_week: number;
  start_time: string;
  end_time: string;
  is_active: number;
  created_at: string;
  updated_at: string;
}

export type BookingStatus = "confirmed" | "cancelled" | "completed";

export interface BookingRow {
  id: number;
  user_id: number;
  event_type_id: number;
  guest_name: string;
  guest_email: string;
  start_at: string;
  end_at: string;
  timezone: string;
  status: BookingStatus;
  notes: string | null;
  created_at: string;
  updated_at: string;
}

export type AttendeeStatus = "confirmed" | "cancelled";

/** A guest occupying one of a slot's seats. */
export interface BookingAttendeeRow {
  id: number;
  booking_id: number;
  guest_name: string;
  guest_email: string;
  notes: string | null;
  timezone: string;
  status: AttendeeStatus;
  /** Human-presentable ticket code (MF-XXXX-XXXX), null for legacy rows. */
  ticket_code: string | null;
  created_at: string;
  updated_at: string;
}

export interface GoogleConnectionRow {
  user_id: number;
  google_email: string;
  /** AES-GCM base64 blobs, encrypted with the GOOGLE_TOKEN_KEY secret. */
  enc_refresh: string;
  enc_access: string;
  /** Epoch ms when the stored access token stops working. */
  access_expires_at: number;
  created_at: string;
  updated_at: string;
}

export interface Variables {
  user: PublicUser;
}

export type AppEnv = { Bindings: Env; Variables: Variables };
