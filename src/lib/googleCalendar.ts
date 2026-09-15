import { getGoogleConnection, updateGoogleAccessTokens } from "../db/googleConnections";
import { decryptFromBase64, encryptToBase64 } from "./encrypt";
import { b64urlDecode, signPayload, verifyPayload } from "./hmac";
import { nowIso } from "./time";
import type { Interval } from "./slots";
import type { GoogleConnectionRow } from "../types";

export type FetchImpl = typeof fetch;

/** Fetches the host's Google busy intervals for `timeMinMs..timeMaxMs`. */
export type FetchGoogleBusy = (
  userId: number,
  timeMinMs: number,
  timeMaxMs: number,
) => Promise<Interval[]>;

/**
 * Signed OAuth `state`: the host's user id under a dedicated purpose, so the
 * callback can verify the response belongs to the host who started the flow
 * (CSRF guard) and can never be replayed as another token type.
 */
const STATE_PURPOSE = "google-oauth-state";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const FREEBUSY_URL = "https://www.googleapis.com/calendar/v3/freeBusy";
/** Refresh 60s before expiry so in-flight requests never send a stale token. */
const TOKEN_REFRESH_MARGIN_MS = 60_000;
/**
 * Best-effort in-isolate cache so calendar clicks do not hammer Google.
 * Correctness never depends on it: a miss just means one more freeBusy call.
 */
const CACHE_TTL_MS = 60_000;

const cache = new Map<string, { expiresAt: number; busy: Interval[] }>();

type SecretEnv = Pick<
  Cloudflare.Env,
  "APP_URL" | "GOOGLE_CLIENT_ID" | "GOOGLE_CLIENT_SECRET" | "GOOGLE_TOKEN_KEY"
>;

/** All three secrets present = feature on. Absent = silently off. */
export function hasGoogleSecrets(env: SecretEnv): boolean {
  return Boolean(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET && env.GOOGLE_TOKEN_KEY);
}

export async function signOauthState(userId: number, secret: string): Promise<string> {
  return signPayload(STATE_PURPOSE, String(userId), secret);
}

/** Returns the user id the state was signed for, or null. */
export async function verifyOauthState(state: string, secret: string): Promise<number | null> {
  const payload = await verifyPayload(STATE_PURPOSE, state, secret);
  if (payload === null) return null;
  const userId = Number(payload);
  return Number.isInteger(userId) && userId > 0 ? userId : null;
}

export async function googleAuthUrl(
  env: SecretEnv,
  userId: number,
  secret: string,
): Promise<string> {
  const params = new URLSearchParams({
    client_id: env.GOOGLE_CLIENT_ID!,
    redirect_uri: `${env.APP_URL}/oauth/google/callback`,
    response_type: "code",
    // openid + email let the callback read the account email from the id_token.
    scope: "openid email https://www.googleapis.com/auth/calendar.readonly",
    access_type: "offline",
    prompt: "consent",
    state: await signOauthState(userId, secret),
  });
  return `https://accounts.google.com/o/oauth2/v2/auth?${params}`;
}

export interface GoogleTokenResponse {
  access_token: string;
  refresh_token?: string;
  id_token?: string;
  expires_in: number;
}

export async function exchangeGoogleCode(
  env: SecretEnv,
  code: string,
  fetchImpl: FetchImpl = fetch,
): Promise<GoogleTokenResponse> {
  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      code,
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      redirect_uri: `${env.APP_URL}/oauth/google/callback`,
      grant_type: "authorization_code",
    }),
  });
  if (!res.ok) throw new Error(`google token exchange failed: ${res.status}`);
  return res.json<GoogleTokenResponse>();
}

/** The account email claimed on the id_token; null when absent or malformed. */
export function emailFromIdToken(idToken: string): string | null {
  const parts = idToken.split(".");
  if (parts.length !== 3) return null;
  try {
    const claims = JSON.parse(new TextDecoder().decode(b64urlDecode(parts[1]!)));
    return typeof claims.email === "string" ? claims.email : null;
  } catch {
    return null;
  }
}

async function refreshAccessToken(
  env: SecretEnv,
  refreshToken: string,
  fetchImpl: FetchImpl,
): Promise<{ access: string; expiresAt: number }> {
  const res = await fetchImpl(TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      refresh_token: refreshToken,
      client_id: env.GOOGLE_CLIENT_ID!,
      client_secret: env.GOOGLE_CLIENT_SECRET!,
      grant_type: "refresh_token",
    }),
  });
  if (!res.ok) throw new Error(`google token refresh failed: ${res.status}`);
  const tokens = await res.json<{ access_token: string; expires_in: number }>();
  return { access: tokens.access_token, expiresAt: Date.now() + tokens.expires_in * 1000 };
}

/**
 * Returns a working access token: the stored one while unexpired, otherwise a
 * refresh exchange whose rotated token is re-encrypted and persisted.
 */
export async function ensureAccessToken(
  db: D1Database,
  env: SecretEnv,
  row: GoogleConnectionRow,
  fetchImpl: FetchImpl = fetch,
): Promise<string> {
  if (row.access_expires_at > Date.now() + TOKEN_REFRESH_MARGIN_MS) {
    return decryptFromBase64(env.GOOGLE_TOKEN_KEY!, row.enc_access);
  }
  const refreshToken = await decryptFromBase64(env.GOOGLE_TOKEN_KEY!, row.enc_refresh);
  const { access, expiresAt } = await refreshAccessToken(env, refreshToken, fetchImpl);
  await updateGoogleAccessTokens(
    db,
    row.user_id,
    await encryptToBase64(env.GOOGLE_TOKEN_KEY!, access),
    expiresAt,
    nowIso(),
  );
  return access;
}

export async function fetchFreeBusy(
  fetchImpl: FetchImpl,
  accessToken: string,
  googleEmail: string,
  timeMinMs: number,
  timeMaxMs: number,
): Promise<Interval[]> {
  const res = await fetchImpl(FREEBUSY_URL, {
    method: "POST",
    headers: { authorization: `Bearer ${accessToken}`, "content-type": "application/json" },
    body: JSON.stringify({
      timeMin: new Date(timeMinMs).toISOString(),
      timeMax: new Date(timeMaxMs).toISOString(),
      items: [{ id: googleEmail }],
    }),
  });
  if (!res.ok) throw new Error(`google freeBusy failed: ${res.status}`);
  const body = await res.json<{
    calendars: Record<string, { busy: Array<{ start: string; end: string }> }>;
  }>();
  return (body.calendars[googleEmail]?.busy ?? []).map((b) => ({
    startMs: Date.parse(b.start),
    endMs: Date.parse(b.end),
  }));
}

/**
 * The host's Google busy intervals. `[]` when the feature is off, the host has
 * no connection, or anything goes wrong — availability must never break because
 * Google did.
 */
export async function getGoogleBusy(
  db: D1Database,
  env: SecretEnv,
  userId: number,
  timeMinMs: number,
  timeMaxMs: number,
  fetchImpl: FetchImpl = fetch,
): Promise<Interval[]> {
  if (!hasGoogleSecrets(env)) return [];

  const cacheKey = `${userId}:${timeMinMs}:${timeMaxMs}`;
  const hit = cache.get(cacheKey);
  if (hit && hit.expiresAt > Date.now()) return hit.busy;

  try {
    const row = await getGoogleConnection(db, userId);
    if (!row) return [];
    const accessToken = await ensureAccessToken(db, env, row, fetchImpl);
    const busy = await fetchFreeBusy(
      fetchImpl,
      accessToken,
      row.google_email,
      timeMinMs,
      timeMaxMs,
    );
    cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, busy });
    return busy;
  } catch (err) {
    console.warn("googleCalendar: busy lookup failed, ignoring Google busy", err);
    return [];
  }
}

/** Closure the booking service calls with a candidate day window. */
export function fetchGoogleBusyClosure(db: D1Database, env: SecretEnv): FetchGoogleBusy {
  return (userId, timeMinMs, timeMaxMs) => getGoogleBusy(db, env, userId, timeMinMs, timeMaxMs);
}
