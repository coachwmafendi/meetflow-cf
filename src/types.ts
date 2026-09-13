export interface Env {
  DB: D1Database;
  ASSETS: Fetcher;
  SESSION_SECRET: string;
}

export interface UserRow {
  id: number;
  name: string;
  email: string;
  password_hash: string;
  slug: string;
  timezone: string;
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
  is_active: number;
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

export interface Variables {
  user: PublicUser;
}

export type AppEnv = { Bindings: Env; Variables: Variables };
