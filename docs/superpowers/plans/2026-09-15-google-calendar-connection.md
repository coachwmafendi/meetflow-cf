# Google Calendar Connection (read-only conflict check) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Hosts link their Google Calendar (read-only) so MeetFlow hides booking slots that overlap Google Calendar events, per `docs/superpowers/specs/2026-09-14-google-calendar-connection-design.md`.

**Architecture:** One `google_connections` row per host stores AES-GCM-encrypted OAuth tokens (refresh + access). `getGoogleBusy` resolves/refreshes the access token, calls Google `freeBusy`, and returns busy intervals — `[]` on anything missing or any error (fail-open). Availability accepts `extraBusy` intervals; the booking path injects a `fetchGoogleBusy` closure so a Google-busy slot can never be booked. OAuth authorize/callback/disconnect routes live alongside the page routes; settings gains a Calendar card.

**Tech Stack:** Cloudflare Workers + Hono, D1, Web Crypto (AES-GCM + HMAC), Vitest + `@cloudflare/vitest-pool-workers` (real workerd + real local D1; fetch is injected at the service layer, never stubbed globally).

**Secrets:** `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`, `GOOGLE_TOKEN_KEY` are already set in production (`wrangler secret list` confirms) and in `.dev.vars`. `src/env.d.ts` already declares them as optional. All three absent = feature silently off.

---

### Task 1: Migration, row type and db module

**Files:**
- Create: `migrations/0007_google_connections.sql`
- Modify: `src/types.ts` (add `GoogleConnectionRow`)
- Create: `src/db/googleConnections.ts`
- Modify: `test/helpers.ts` (`resetDb` clears the new table)

- [ ] **Step 1: Create the migration**

`migrations/0007_google_connections.sql`:

```sql
-- One read-only Google Calendar connection per host. Tokens are stored encrypted
-- (AES-GCM, key from the GOOGLE_TOKEN_KEY secret) and refreshed on use.
-- Reconnecting upserts, so there is exactly one row per host.
CREATE TABLE google_connections (
    user_id INTEGER PRIMARY KEY,
    google_email TEXT NOT NULL,
    enc_refresh TEXT NOT NULL,
    enc_access TEXT NOT NULL,
    access_expires_at INTEGER NOT NULL,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);
```

- [ ] **Step 2: Add the row type to `src/types.ts`**

Append after `BookingRow` (before `Variables`):

```ts
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
```

- [ ] **Step 3: Create `src/db/googleConnections.ts`**

```ts
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
```

- [ ] **Step 4: Clear the table in `test/helpers.ts` `resetDb`**

Replace the `resetDb` body's `batch` list (new table first, users last as today):

```ts
export async function resetDb(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM google_connections"),
    env.DB.prepare("DELETE FROM bookings"),
    env.DB.prepare("DELETE FROM availability_rules"),
    env.DB.prepare("DELETE FROM event_types"),
    env.DB.prepare("DELETE FROM users"),
  ]);
}
```

- [ ] **Step 5: Apply locally and verify**

Run: `npm run db:migrate:local`
Expected: migration applied. Then `npx vitest run test/integration/schema.test.ts`
Expected: PASS (schema test uses `arrayContaining`, so the extra table is fine).

- [ ] **Step 6: Commit**

```bash
git add migrations/0007_google_connections.sql src/types.ts src/db/googleConnections.ts test/helpers.ts
git commit -m "feat(gcal): google_connections migration and db module"
```

---

### Task 2: AES-GCM token encryption (`src/lib/encrypt.ts`)

**Files:**
- Create: `src/lib/encrypt.ts`
- Test: `test/unit/encrypt.test.ts`

- [ ] **Step 1: Write the failing tests**

`test/unit/encrypt.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { decryptFromBase64, encryptToBase64 } from "../../src/lib/encrypt";

/** base64 of exactly 32 raw bytes, as `openssl rand -base64 32` produces. */
const KEY = btoa("0123456789abcdef0123456789abcdef");
const KEY2 = btoa("ffffffffffffffffffffffffffffffff");

describe("encrypt", () => {
  it("roundtrips a plaintext", async () => {
    const blob = await encryptToBase64(KEY, "1///refresh-token-值");
    expect(await decryptFromBase64(KEY, blob)).toBe("1///refresh-token-值");
  });

  it("produces a different blob each time (random nonce)", async () => {
    const a = await encryptToBase64(KEY, "same");
    const b = await encryptToBase64(KEY, "same");
    expect(a).not.toBe(b);
  });

  it("rejects a tampered blob", async () => {
    const blob = await encryptToBase64(KEY, "secret");
    const bytes = Uint8Array.from(atob(blob), (c) => c.charCodeAt(0));
    bytes[bytes.length - 1]! ^= 1;
    const tampered = btoa(String.fromCharCode(...bytes));
    await expect(decryptFromBase64(KEY, tampered)).rejects.toThrow();
  });

  it("rejects a blob encrypted with a different key", async () => {
    const blob = await encryptToBase64(KEY, "secret");
    await expect(decryptFromBase64(KEY2, blob)).rejects.toThrow();
  });

  it("rejects a truncated blob and a bad key length", async () => {
    await expect(decryptFromBase64(KEY, btoa("short"))).rejects.toThrow();
    await expect(encryptToBase64(btoa("too-short"), "x")).rejects.toThrow();
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/unit/encrypt.test.ts`
Expected: FAIL — cannot resolve `../../src/lib/encrypt`.

- [ ] **Step 3: Implement `src/lib/encrypt.ts`**

```ts
/**
 * AES-GCM encryption for Google OAuth tokens at rest in D1.
 *
 * Key: the GOOGLE_TOKEN_KEY secret — base64 of 32 random bytes
 * (`openssl rand -base64 32`). Blob format: plain base64 of
 * <12-byte nonce><ciphertext+GCM tag>, stored in one TEXT column.
 */

const NONCE_BYTES = 12;
const KEY_BYTES = 32;

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

async function importKey(keyBase64: string): Promise<CryptoKey> {
  const raw = fromBase64(keyBase64);
  if (raw.byteLength !== KEY_BYTES) {
    throw new Error("GOOGLE_TOKEN_KEY must be base64 of 32 bytes");
  }
  return crypto.subtle.importKey("raw", raw, { name: "AES-GCM" }, false, [
    "encrypt",
    "decrypt",
  ]);
}

export async function encryptToBase64(keyBase64: string, plaintext: string): Promise<string> {
  const key = await importKey(keyBase64);
  const nonce = crypto.getRandomValues(new Uint8Array(NONCE_BYTES));
  const ciphertext = new Uint8Array(
    await crypto.subtle.encrypt(
      { name: "AES-GCM", iv: nonce },
      key,
      new TextEncoder().encode(plaintext),
    ),
  );
  const blob = new Uint8Array(NONCE_BYTES + ciphertext.byteLength);
  blob.set(nonce);
  blob.set(ciphertext, NONCE_BYTES);
  return toBase64(blob);
}

export async function decryptFromBase64(keyBase64: string, blobBase64: string): Promise<string> {
  const blob = fromBase64(blobBase64);
  if (blob.byteLength <= NONCE_BYTES) throw new Error("Encrypted blob is too short");
  const key = await importKey(keyBase64);
  const plaintext = await crypto.subtle.decrypt(
    { name: "AES-GCM", iv: blob.slice(0, NONCE_BYTES) },
    key,
    blob.slice(NONCE_BYTES),
  );
  return new TextDecoder().decode(plaintext);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/unit/encrypt.test.ts`
Expected: PASS (5 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/encrypt.ts test/unit/encrypt.test.ts
git commit -m "feat(gcal): AES-GCM token encryption"
```

---

### Task 3: Google busy lookup (`src/lib/googleCalendar.ts`)

**Files:**
- Create: `src/lib/googleCalendar.ts`
- Test: `test/unit/googleCalendar.test.ts`

- [ ] **Step 1: Write the failing tests**

`test/unit/googleCalendar.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import type { GoogleConnectionRow } from "../../src/types";
import {
  emailFromIdToken,
  ensureAccessToken,
  exchangeGoogleCode,
  fetchFreeBusy,
  getGoogleBusy,
  verifyOauthState,
} from "../../src/lib/googleCalendar";
import { encryptToBase64 } from "../../src/lib/encrypt";

const KEY = btoa("0123456789abcdef0123456789abcdef");
const env = {
  APP_URL: "https://example.com",
  GOOGLE_CLIENT_ID: "test-client-id",
  GOOGLE_CLIENT_SECRET: "test-client-secret",
  GOOGLE_TOKEN_KEY: KEY,
} as never;

const now = Date.now();
const connectedRow = async (accessExpiresAt: number): Promise<GoogleConnectionRow> => ({
  user_id: 1,
  google_email: "wan@gmail.com",
  enc_refresh: await encryptToBase64(KEY, "refresh-token"),
  enc_access: await encryptToBase64(KEY, "access-token"),
  access_expires_at: accessExpiresAt,
  created_at: "2026-09-15T00:00:00Z",
  updated_at: "2026-09-15T00:00:00Z",
});

/** D1 stub: `first` returns the seeded row, `run` records executed SQL. */
function fakeDb(row: GoogleConnectionRow | null) {
  const sql: string[] = [];
  return {
    db: {
      prepare: (statement: string) => ({
        bind: () => ({
          first: async () => row,
          run: async () => {
            sql.push(statement);
            return { meta: {} };
          },
        }),
      }),
    } as unknown as D1Database,
    sql,
  };
}

function stubFetch(responses: Array<{ status: number; body: unknown }>) {
  const calls: Array<{ url: string; init: RequestInit }> = [];
  const impl = (async (url: unknown, init: unknown) => {
    calls.push({ url: String(url), init: init as RequestInit });
    const next = responses.shift() ?? { status: 500, body: {} };
    return new Response(JSON.stringify(next.body), { status: next.status });
  }) as unknown as typeof fetch;
  return { impl, calls };
}

const FREEBUSY_BODY = {
  calendars: { "wan@gmail.com": { busy: [{ start: "2026-09-21T01:00:00Z", end: "2026-09-21T02:00:00Z" }] } },
};

describe("getGoogleBusy", () => {
  it("returns [] without secrets and never fetches", async () => {
    const { impl, calls } = stubFetch([]);
    const { db } = fakeDb(await connectedRow(now + 3_600_000));
    const busy = await getGoogleBusy(db, { GOOGLE_CLIENT_ID: undefined } as never, 1, 0, 1, impl);
    expect(busy).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("returns [] when the host has no connection and never fetches", async () => {
    const { impl, calls } = stubFetch([]);
    const { db } = fakeDb(null);
    expect(await getGoogleBusy(db, env, 1, 0, 1, impl)).toEqual([]);
    expect(calls).toHaveLength(0);
  });

  it("uses the stored access token when unexpired and parses busy", async () => {
    const { impl, calls } = stubFetch([{ status: 200, body: FREEBUSY_BODY }]);
    const { db } = fakeDb(await connectedRow(now + 3_600_000));
    const busy = await getGoogleBusy(db, env, 1, now, now + 3_600_000, impl);
    expect(busy).toEqual([
      { startMs: Date.parse("2026-09-21T01:00:00Z"), endMs: Date.parse("2026-09-21T02:00:00Z") },
    ]);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.url).toBe("https://www.googleapis.com/calendar/v3/freeBusy");
    const headers = calls[0]!.init.headers as Record<string, string>;
    expect(headers.authorization).toBe("Bearer access-token");
    expect(JSON.parse(String(calls[0]!.init.body))).toMatchObject({
      items: [{ id: "wan@gmail.com" }],
    });
  });

  it("refreshes an expired access token and persists the rotation", async () => {
    const { impl, calls } = stubFetch([
      { status: 200, body: { access_token: "fresh-access", expires_in: 3600 } },
      { status: 200, body: FREEBUSY_BODY },
    ]);
    const { db, sql } = fakeDb(await connectedRow(now - 1));
    const busy = await getGoogleBusy(db, env, 1, now, now + 3_600_000, impl);
    expect(busy).toHaveLength(1);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toBe("https://oauth2.googleapis.com/token");
    const refreshBody = calls[0]!.init.body as URLSearchParams;
    expect(refreshBody.get("grant_type")).toBe("refresh_token");
    expect(refreshBody.get("refresh_token")).toBe("refresh-token");
    expect(refreshBody.get("client_id")).toBe("test-client-id");
    expect(sql.some((statement) => statement.startsWith("UPDATE google_connections"))).toBe(true);
  });

  it("fails open to [] on a freeBusy error", async () => {
    const { impl } = stubFetch([{ status: 500, body: {} }]);
    const { db } = fakeDb(await connectedRow(now + 3_600_000));
    expect(await getGoogleBusy(db, env, 1, now, now + 3_600_000, impl)).toEqual([]);
  });
});

describe("exchangeGoogleCode", () => {
  it("posts the authorization code with the matching redirect_uri", async () => {
    const { impl, calls } = stubFetch([
      { status: 200, body: { access_token: "a", refresh_token: "r", id_token: "x.y.z", expires_in: 3600 } },
    ]);
    const tokens = await exchangeGoogleCode(env, "auth-code", impl);
    expect(tokens.refresh_token).toBe("r");
    expect(calls).toHaveLength(1);
    const body = calls[0]!.init.body as URLSearchParams;
    expect(body.get("grant_type")).toBe("authorization_code");
    expect(body.get("code")).toBe("auth-code");
    expect(body.get("redirect_uri")).toBe("https://example.com/oauth/google/callback");
  });

  it("throws on a non-2xx exchange", async () => {
    const { impl } = stubFetch([{ status: 400, body: { error: "bad_code" } }]);
    await expect(exchangeGoogleCode(env, "auth-code", impl)).rejects.toThrow("400");
  });
});

describe("helpers", () => {
  it("roundtrips the signed state to the user id and rejects tampering", async () => {
    const secret = "test-session-secret";
    const state = await (await import("../../src/lib/googleCalendar")).signOauthState(42, secret);
    expect(await verifyOauthState(state, secret)).toBe(42);
    expect(await verifyOauthState(state, "other-secret")).toBe(null);
    expect(await verifyOauthState("garbage", secret)).toBe(null);
  });

  it("extracts the email from an id_token", () => {
    const claims = btoa(JSON.stringify({ email: "wan@gmail.com" }))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
    expect(emailFromIdToken(`h.${claims}.sig`)).toBe("wan@gmail.com");
    expect(emailFromIdToken("not-a-jwt")).toBe(null);
  });

  it("parses freeBusy into millisecond intervals", async () => {
    const { impl } = stubFetch([{ status: 200, body: FREEBUSY_BODY }]);
    const busy = await fetchFreeBusy(impl, "token", "wan@gmail.com", 0, 1);
    expect(busy).toEqual([
      { startMs: Date.parse("2026-09-21T01:00:00Z"), endMs: Date.parse("2026-09-21T02:00:00Z") },
    ]);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/unit/googleCalendar.test.ts`
Expected: FAIL — module does not exist.

- [ ] **Step 3: Implement `src/lib/googleCalendar.ts`**

```ts
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

export async function googleAuthUrl(env: SecretEnv, userId: number, secret: string): Promise<string> {
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
    const busy = await fetchFreeBusy(fetchImpl, accessToken, row.google_email, timeMinMs, timeMaxMs);
    cache.set(cacheKey, { expiresAt: Date.now() + CACHE_TTL_MS, busy });
    return busy;
  } catch (err) {
    console.warn("googleCalendar: busy lookup failed, ignoring Google busy", err);
    return [];
  }
}

/** Closure the booking service calls with a candidate day window. */
export function fetchGoogleBusyClosure(db: D1Database, env: SecretEnv): FetchGoogleBusy {
  return (userId, timeMinMs, timeMaxMs) =>
    getGoogleBusy(db, env, userId, timeMinMs, timeMaxMs);
}
```

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/unit/googleCalendar.test.ts`
Expected: PASS (10 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/googleCalendar.ts test/unit/googleCalendar.test.ts
git commit -m "feat(gcal): google calendar busy lookup (token refresh + freeBusy)"
```

---

### Task 4: Availability accepts `extraBusy`

**Files:**
- Modify: `src/services/availability.ts` (`SlotQuery`, `MonthQuery`, both functions)
- Test: `test/integration/availability.test.ts`

- [ ] **Step 1: Write the failing tests**

Append to `test/integration/availability.test.ts` (reuses the file's existing `createHost`/`api` helpers and its seed pattern — a host with Monday 09:00-17:00 availability and a 60-minute event type `consultation`; adapt names to the helpers actually present in the file):

```ts
describe("extraBusy", () => {
  it("removes slots that overlap Google busy intervals", async () => {
    const host = await createHost("wan");
    await api("/api/availability", {
      method: "PUT",
      cookie: host.cookie,
      body: JSON.stringify({ rules: [{ day_of_week: 1, start_time: "09:00", end_time: "17:00" }] }),
    });
    await api("/api/event-types", {
      method: "POST",
      cookie: host.cookie,
      body: JSON.stringify({ name: "Consultation", slug: "consultation", duration_minutes: 60 }),
    });

    // 2026-09-21 is a Monday. 13:00-15:00 host-local is free by availability.
    const slots = await getSlotsForDate(env.DB, {
      hostId: host.id,
      hostTimezone: "Asia/Kuala_Lumpur",
      eventTypeId: 1,
      durationMinutes: 60,
      bufferMinutes: 0,
      dateYmd: "2026-09-21",
      nowMs: Date.parse("2026-09-15T00:00:00Z"),
      extraBusy: [
        {
          startMs: Date.parse("2026-09-21T05:00:00Z"),
          endMs: Date.parse("2026-09-21T07:00:00Z"),
        },
      ],
    });
    expect(slots.some((s) => s.startAt === "2026-09-21T05:00:00Z")).toBe(false);
    expect(slots.some((s) => s.startAt === "2026-09-21T03:00:00Z")).toBe(true);
  });

  it("leaves slots untouched when extraBusy is empty", async () => {
    const host = await createHost("wan");
    await api("/api/availability", {
      method: "PUT",
      cookie: host.cookie,
      body: JSON.stringify({ rules: [{ day_of_week: 1, start_time: "09:00", end_time: "17:00" }] }),
    });
    await api("/api/event-types", {
      method: "POST",
      cookie: host.cookie,
      body: JSON.stringify({ name: "Consultation", slug: "consultation", duration_minutes: 60 }),
    });
    const slots = await getSlotsForDate(env.DB, {
      hostId: host.id,
      hostTimezone: "Asia/Kuala_Lumpur",
      eventTypeId: 1,
      durationMinutes: 60,
      bufferMinutes: 0,
      dateYmd: "2026-09-21",
      nowMs: Date.parse("2026-09-15T00:00:00Z"),
      extraBusy: [],
    });
    expect(slots.some((s) => s.startAt === "2026-09-21T05:00:00Z")).toBe(true);
  });
});
```

Adjust the imports at the top of the file: `import { env } from "cloudflare:test";` and `import { getSlotsForDate } from "../../src/services/availability";` if not already imported, and drop the `eventTypeId: 1` assumption if the file's seed helper returns the real event type id (preferred: capture `const { eventType } = await res.json()` from the create call and use `eventType.id`).

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/integration/availability.test.ts`
Expected: FAIL — TypeScript error: `extraBusy` does not exist on `SlotQuery`.

- [ ] **Step 3: Implement in `src/services/availability.ts`**

Add to `SlotQuery` and `MonthQuery`:

```ts
  /** Google Calendar busy intervals supplied by the caller (feature off = absent). */
  extraBusy?: Interval[];
```

In `getDaySlots`, replace:

```ts
  const busy = busyIntervals(busyRows, q.eventTypeId, q.bufferMinutes);
```

with:

```ts
  const busy = [...busyIntervals(busyRows, q.eventTypeId, q.bufferMinutes), ...(q.extraBusy ?? [])];
```

Make the identical replacement in `getMonthFreeDays`.

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/integration/availability.test.ts test/integration/monthAvailability.test.ts`
Expected: PASS (both files).

- [ ] **Step 5: Commit**

```bash
git add src/services/availability.ts test/integration/availability.test.ts
git commit -m "feat(gcal): availability accepts extra busy intervals"
```

---

### Task 5: Booking path blocks Google-busy slots

**Files:**
- Modify: `src/services/booking.ts` (`CreateBookingInput`, `RescheduleInput`, `createBooking`, `rescheduleBooking`)
- Modify: `src/routes/api.public.ts` (slots route, month route, book route)
- Modify: `src/routes/pages.ts:569` (rescheduleBooking call site)
- Test: `test/integration/booking.test.ts`

- [ ] **Step 1: Write the failing test**

Append to `test/integration/booking.test.ts`:

```ts
describe("google busy", () => {
  it("rejects a booking inside a Google-busy interval even though the grid is free", async () => {
    const host = await createHost("wan");
    await api("/api/availability", {
      method: "PUT",
      cookie: host.cookie,
      body: JSON.stringify({ rules: [{ day_of_week: 1, start_time: "09:00", end_time: "17:00" }] }),
    });
    await api("/api/event-types", {
      method: "POST",
      cookie: host.cookie,
      body: JSON.stringify({ name: "Consultation", slug: "consultation", duration_minutes: 30 }),
    });

    // The page said this slot was free; Google says the host is busy then.
    const res = await SELF.fetch("https://example.com/api/public/wan/consultation/book", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        start_at: "2026-09-21T05:00:00Z",
        guest_name: "Ahmad",
        guest_email: "ahmad@example.com",
        timezone: "Asia/Kuala_Lumpur",
      }),
    });
    expect(res.status).toBe(409);
    const body = await res.json<{ error: string }>();
    expect(body.error).toContain("no longer available");
  });
});
```

This test only compiles once the route accepts a test seam, so Step 1 is completed together with Steps 2-3: the route wires the closure through `env`, and THIS test injects nothing — it passes because `fetchGoogleBusy` is read from a **request-level override**. To keep the test honest, the injection point is a test-only header? No — do not add test-only code to production routes. Instead the service signature gains the closure (below) and the integration test injects via a *service-level* call, while the route keeps using the env-backed closure.

Replace the test above with a service-level test (put it in `test/integration/booking.test.ts`, importing `createBooking` from `../../src/services/booking`):

```ts
describe("google busy (service level)", () => {
  it("rejects a booking inside a Google-busy interval even though the grid is free", async () => {
    const host = await createHost("wan");
    await api("/api/availability", {
      method: "PUT",
      cookie: host.cookie,
      body: JSON.stringify({ rules: [{ day_of_week: 1, start_time: "09:00", end_time: "17:00" }] }),
    });
    await api("/api/event-types", {
      method: "POST",
      cookie: host.cookie,
      body: JSON.stringify({ name: "Consultation", slug: "consultation", duration_minutes: 30 }),
    });

    await expect(
      createBooking(env.DB, {
        hostSlug: "wan",
        eventSlug: "consultation",
        startAt: "2026-09-21T05:00:00Z",
        guestName: "Ahmad",
        guestEmail: "ahmad@example.com",
        guestTimezone: "Asia/Kuala_Lumpur",
        notes: null,
        fetchGoogleBusy: async () => [
          {
            startMs: Date.parse("2026-09-21T05:00:00Z"),
            endMs: Date.parse("2026-09-21T06:00:00Z"),
          },
        ],
      }),
    ).rejects.toThrow("no longer available");
  });

  it("still books when fetchGoogleBusy returns nothing", async () => {
    const host = await createHost("wan");
    await api("/api/availability", {
      method: "PUT",
      cookie: host.cookie,
      body: JSON.stringify({ rules: [{ day_of_week: 1, start_time: "09:00", end_time: "17:00" }] }),
    });
    await api("/api/event-types", {
      method: "POST",
      cookie: host.cookie,
      body: JSON.stringify({ name: "Consultation", slug: "consultation", duration_minutes: 30 }),
    });

    const booking = await createBooking(env.DB, {
      hostSlug: "wan",
      eventSlug: "consultation",
      startAt: "2026-09-21T05:00:00Z",
      guestName: "Ahmad",
      guestEmail: "ahmad@example.com",
      guestTimezone: "Asia/Kuala_Lumpur",
      notes: null,
      fetchGoogleBusy: async () => [],
    });
    expect(booking.status).toBe("confirmed");
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/integration/booking.test.ts`
Expected: FAIL — TypeScript error: `fetchGoogleBusy` does not exist on `CreateBookingInput`.

- [ ] **Step 3: Implement in `src/services/booking.ts`**

Imports: add `zonedToUtc` to the existing timezone import, add `import type { FetchGoogleBusy } from "../lib/googleCalendar";`.

`CreateBookingInput` gains:

```ts
  /**
   * Fetches Google busy intervals for `userId` over `timeMinMs..timeMaxMs`.
   * Absent (or a route without the feature) = no Google busy check.
   */
  fetchGoogleBusy?: FetchGoogleBusy;
```

`RescheduleInput` gains the identical field.

In `createBooking`, after the `hostDate` check and before `getDaySlots`, insert:

```ts
  // A Google-busy slot can never be booked even if the page was stale.
  const dayStart = zonedToUtc(hostDate, "00:00", host.timezone);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60_000);
  const extraBusy = input.fetchGoogleBusy
    ? await input.fetchGoogleBusy(host.id, dayStart.getTime() - 3_600_000, dayEnd.getTime() + 3_600_000)
    : [];
```

and pass `extraBusy` into the existing `getDaySlots` query object. Make the same change in `rescheduleBooking` (it already has `hostDate`, `host`, and its own `getDaySlots` call).

- [ ] **Step 4: Run to verify pass**

Run: `npx vitest run test/integration/booking.test.ts`
Expected: PASS (existing tests plus the 2 new ones).

- [ ] **Step 5: Wire the routes**

`src/routes/api.public.ts`:

- Imports: add `zonedToUtc` from `../lib/timezone` (only `isYmd` etc. imported from validate today), `getGoogleBusy`, `fetchGoogleBusyClosure` from `../lib/googleCalendar`, and `const pad2 = (n: number) => String(n).padStart(2, "0");` near the top.

- Slots route: before `getSlotsForDate`, fetch Google busy for the day (±1h pad):

```ts
    const dayStart = zonedToUtc(date, "00:00", host.timezone);
    const extraBusy = await getGoogleBusy(
      c.env.DB,
      c.env,
      host.id,
      dayStart.getTime() - 3_600_000,
      dayStart.getTime() + 25 * 3_600_000,
    );
```

and pass `extraBusy` into the `SlotQuery` object.

- Month route: before `getMonthFreeDays`:

```ts
    const monthStart = zonedToUtc(`${year}-${pad2(month)}-01`, "00:00", host.timezone);
    const extraBusy = await getGoogleBusy(
      c.env.DB,
      c.env,
      host.id,
      monthStart.getTime() - 24 * 3_600_000,
      monthStart.getTime() + 32 * 24 * 3_600_000,
    );
```

and pass `extraBusy` into the `MonthQuery` object.

- Book route: pass the env-backed closure into `createBooking`:

```ts
      fetchGoogleBusy: fetchGoogleBusyClosure(c.env.DB, c.env),
```

`src/routes/pages.ts:569` (guest reschedule call): pass the same closure into `rescheduleBooking`:

```ts
      fetchGoogleBusy: fetchGoogleBusyClosure(c.env.DB, c.env),
```

with `import { fetchGoogleBusyClosure } from "../lib/googleCalendar";` added to pages.ts imports.

- [ ] **Step 6: Run the full suite**

Run: `npm test`
Expected: PASS — no existing behavior changes when the feature is off (`fetchGoogleBusy` absent; test env has no google_connections rows so `getGoogleBusy` returns `[]` with zero fetches).

- [ ] **Step 7: Commit**

```bash
git add src/services/booking.ts src/routes/api.public.ts src/routes/pages.ts test/integration/booking.test.ts
git commit -m "feat(gcal): booking path blocks google-busy slots"
```

---

### Task 6: OAuth routes, settings card, disconnect

**Files:**
- Modify: `src/routes/pages.ts` (authorize, callback, disconnect, settings data)
- Modify: `src/views/dashboard.ts` (`settingsPage` calendar card)
- Modify: `vitest.config.ts` (test secrets so integration tests exercise the on state)
- Test: `test/integration/googleConnection.test.ts`

- [ ] **Step 1: Add test secrets to the test environment**

In `vitest.config.ts`, extend `miniflare.bindings`:

```ts
          SESSION_SECRET: "test-secret-do-not-use-in-prod",
          GOOGLE_CLIENT_ID: "test-client-id",
          GOOGLE_CLIENT_SECRET: "test-client-secret",
          GOOGLE_TOKEN_KEY: btoa("0123456789abcdef0123456789abcdef"),
```

Run: `npx vitest run test/integration/smoke.test.ts`
Expected: PASS (nothing reads the secrets yet).

- [ ] **Step 2: Write the failing integration tests**

`test/integration/googleConnection.test.ts`:

```ts
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { encryptToBase64 } from "../../src/lib/encrypt";
import { upsertGoogleConnection } from "../../src/db/googleConnections";
import { api, createHost, resetDb } from "../helpers";

const TEST_KEY = btoa("0123456789abcdef0123456789abcdef");

describe("google calendar connection", () => {
  beforeEach(resetDb);

  it("redirects anonymous visitors from authorize to login", async () => {
    const res = await SELF.fetch("https://example.com/oauth/google/authorize", {
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
  });

  it("sends the host to Google with the client id and a signed state", async () => {
    const host = await createHost("wan");
    const res = await SELF.fetch("https://example.com/oauth/google/authorize", {
      headers: { cookie: host.cookie },
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    const location = new URL(res.headers.get("location")!);
    expect(location.origin + location.pathname).toBe("https://accounts.google.com/o/oauth2/v2/auth");
    expect(location.searchParams.get("client_id")).toBe("test-client-id");
    expect(location.searchParams.get("redirect_uri")).toBe(
      "https://example.com/oauth/google/callback",
    );
    expect(location.searchParams.get("scope")).toContain("calendar.readonly");
    expect(location.searchParams.get("state")).toBeTruthy();
  });

  it("rejects a callback whose state does not verify", async () => {
    const host = await createHost("wan");
    const res = await SELF.fetch(
      "https://example.com/oauth/google/callback?code=auth-code&state=garbage",
      { headers: { cookie: host.cookie }, redirect: "manual" },
    );
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toContain("/dashboard/settings");
    expect(decodeURIComponent(res.headers.get("location")!)).toContain("could not be verified");
  });

  it("shows the connect card before and the connected card after seeding", async () => {
    const host = await createHost("wan");
    const before = await SELF.fetch("https://example.com/dashboard/settings", {
      headers: { cookie: host.cookie },
    });
    const beforeHtml = await before.text();
    expect(beforeHtml).toContain("Connect Google Calendar");

    await upsertGoogleConnection(env.DB, {
      userId: host.id,
      googleEmail: "wan@gmail.com",
      encRefresh: await encryptToBase64(TEST_KEY, "refresh"),
      encAccess: await encryptToBase64(TEST_KEY, "access"),
      accessExpiresAt: Date.now() + 3_600_000,
      now: "2026-09-15T00:00:00Z",
    });

    const after = await SELF.fetch("https://example.com/dashboard/settings", {
      headers: { cookie: host.cookie },
    });
    const afterHtml = await after.text();
    expect(afterHtml).toContain("Connected as");
    expect(afterHtml).toContain("wan@gmail.com");
    expect(afterHtml).toContain("Disconnect");
    expect(afterHtml).not.toContain("Connect Google Calendar");
  });

  it("disconnects and returns to the connect card", async () => {
    const host = await createHost("wan");
    await upsertGoogleConnection(env.DB, {
      userId: host.id,
      googleEmail: "wan@gmail.com",
      encRefresh: await encryptToBase64(TEST_KEY, "refresh"),
      encAccess: await encryptToBase64(TEST_KEY, "access"),
      accessExpiresAt: Date.now() + 3_600_000,
      now: "2026-09-15T00:00:00Z",
    });

    const res = await api("/dashboard/settings/calendar/disconnect", {
      method: "POST",
      cookie: host.cookie,
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(decodeURIComponent(res.headers.get("location")!)).toContain("disconnected");

    const row = await env.DB.prepare("SELECT user_id FROM google_connections").first();
    expect(row).toBe(null);

    const page = await SELF.fetch("https://example.com/dashboard/settings", {
      headers: { cookie: host.cookie },
    });
    expect(await page.text()).toContain("Connect Google Calendar");
  });
});
```

Notes:
- `SELF` needs importing: `import { SELF } from "cloudflare:test";` — merge with the existing `env` import line.
- `api()` passes a JSON content-type; the disconnect POST route reads no body, so that is fine.
- If the toast query encoding makes `decodeURIComponent` assertions brittle, assert on the raw location containing `/dashboard/settings` and on the toast text appearing when followed once more (fetch the location and assert the toast text in that page's HTML — `readToast` renders it).

- [ ] **Step 3: Run to verify failure**

Run: `npx vitest run test/integration/googleConnection.test.ts`
Expected: FAIL — `/oauth/google/authorize` 404s and the settings page has no connect card.

- [ ] **Step 4: Implement the routes in `src/routes/pages.ts`**

Imports:

```ts
import {
  emailFromIdToken,
  exchangeGoogleCode,
  fetchGoogleBusyClosure,
  googleAuthUrl,
  hasGoogleSecrets,
  verifyOauthState,
} from "../lib/googleCalendar";
import { encryptToBase64 } from "../lib/encrypt";
import {
  deleteGoogleConnection,
  getConnectedGoogleEmail,
  upsertGoogleConnection,
} from "../db/googleConnections";
import type { CalendarSettings } from "../views/dashboard";
```

Add a helper near `readToast`:

```ts
/** Feature-off renders no card at all; on renders connect or connected. */
async function calendarSettings(env: Cloudflare.Env, userId: number): Promise<CalendarSettings> {
  if (!hasGoogleSecrets(env)) return { configured: false, googleEmail: null };
  return { configured: true, googleEmail: await getConnectedGoogleEmail(env.DB, userId) };
}
```

Replace the settings page route (`dashboard.get("/settings", ...)` at line ~413 — it is currently a sync arrow, so make it async):

```ts
dashboard.get("/settings", async (c) => {
  const user = c.get("user");
  return html(settingsPage(user, undefined, readToast(c), await calendarSettings(c.env, user.id)));
});
```

Update the avatar error path inside `dashboard.post("/settings/avatar", ...)` (line ~435):

```ts
    if (err instanceof ImageError) {
      return html(settingsPage(user, err.message, "", await calendarSettings(c.env, user.id)), 400);
    }
```

Add the authorize route on `pageRoutes` (before the catch-all `pageRoutes.get("/:username", ...)`):

```ts
pageRoutes.get("/oauth/google/authorize", async (c) => {
  const user = c.get("user");
  if (!user) return c.redirect("/login");
  if (!hasGoogleSecrets(c.env)) {
    return toastRedirect(c, "/dashboard/settings", "Google Calendar is not configured");
  }
  return c.redirect(await googleAuthUrl(c.env, user.id, c.env.SESSION_SECRET));
});
```

Add the callback route next to it:

```ts
pageRoutes.get("/oauth/google/callback", async (c) => {
  const user = c.get("user");
  if (!user) return c.redirect("/login");
  if (!hasGoogleSecrets(c.env)) {
    return toastRedirect(c, "/dashboard/settings", "Google Calendar is not configured");
  }
  if (c.req.query("error")) {
    return toastRedirect(c, "/dashboard/settings", "Google Calendar connection was cancelled");
  }
  const code = c.req.query("code");
  const state = c.req.query("state") ?? "";
  const stateUserId = await verifyOauthState(state, c.env.SESSION_SECRET);
  if (!code || stateUserId !== user.id) {
    return toastRedirect(c, "/dashboard/settings", "Google Calendar connection could not be verified");
  }

  try {
    const tokens = await exchangeGoogleCode(c.env, code);
    if (!tokens.refresh_token) {
      return toastRedirect(c, "/dashboard/settings", "Google did not return a refresh token; reconnect");
    }
    await upsertGoogleConnection(c.env.DB, {
      userId: user.id,
      // "primary" still works as the freeBusy calendar id if the email is unreadable.
      googleEmail: (tokens.id_token ? emailFromIdToken(tokens.id_token) : null) ?? "primary",
      encRefresh: await encryptToBase64(c.env.GOOGLE_TOKEN_KEY!, tokens.refresh_token),
      encAccess: await encryptToBase64(c.env.GOOGLE_TOKEN_KEY!, tokens.access_token),
      accessExpiresAt: Date.now() + tokens.expires_in * 1000,
      now: nowIso(),
    });
  } catch (err) {
    console.error("google oauth: callback failed", err);
    return toastRedirect(c, "/dashboard/settings", "Google Calendar connection failed");
  }
  return toastRedirect(c, "/dashboard/settings", "Google Calendar connected");
});
```

Check that `nowIso` is already imported in pages.ts (it is used elsewhere); add it if not.

Add the disconnect route on `dashboard` (next to the other settings POSTs):

```ts
dashboard.post("/settings/calendar/disconnect", async (c) => {
  await deleteGoogleConnection(c.env.DB, c.get("user").id);
  return toastRedirect(c, "/dashboard/settings", "Google Calendar disconnected");
});
```

- [ ] **Step 5: Implement the settings card in `src/views/dashboard.ts`**

Export above `settingsPage`:

```ts
export interface CalendarSettings {
  configured: boolean;
  googleEmail: string | null;
}
```

Change the signature:

```ts
export function settingsPage(
  user: PublicUser,
  error?: string,
  toast = "",
  calendar: CalendarSettings = { configured: false, googleEmail: null },
): string {
```

Inside the left column (`<div class="space-y-4">`), directly after the Profile photo `</section>`, add:

```ts
        ${
          calendar.configured
            ? `<section class="ui-card ui-card-pad">
                <p class="ui-eyebrow mb-3">Calendar</p>
                <div class="flex flex-wrap items-center gap-4">
                  <div class="min-w-0 flex-1">
                    ${
                      calendar.googleEmail
                        ? `<p class="text-sm font-medium text-ink">Connected as
                             <span class="font-mono text-[0.8125rem]">${escapeHtml(calendar.googleEmail)}</span></p>
                           <p class="ui-hint">Slots overlapping Google Calendar events are hidden from your booking page.</p>`
                        : `<p class="ui-hint">Connect Google Calendar (read-only) to hide slots that overlap events already in your Google Calendar.</p>`
                    }
                  </div>
                  ${
                    calendar.googleEmail
                      ? `<form method="post" action="/dashboard/settings/calendar/disconnect">
                           ${button({ label: "Disconnect", variant: "ghost", size: "sm" })}
                         </form>`
                      : `<a class="ui-btn ui-btn-secondary ui-btn-sm" href="/oauth/google/authorize">
                           ${icon("calendar", "size-4")}<span>Connect Google Calendar</span>
                         </a>`
                  }
                </div>
              </section>`
            : ""
        }
```

- [ ] **Step 6: Run to verify pass**

Run: `npx vitest run test/integration/googleConnection.test.ts test/integration/pages.test.ts test/unit/googleCalendar.test.ts`
Expected: PASS.

- [ ] **Step 7: Full check**

Run: `npm run check`
Expected: format clean, typecheck clean, all tests green.

- [ ] **Step 8: Commit**

```bash
git add src/routes/pages.ts src/views/dashboard.ts vitest.config.ts test/integration/googleConnection.test.ts
git commit -m "feat(gcal): oauth connect, settings card and disconnect"
```

---

### Task 7: Docs, remote migration and deploy

**Files:**
- Modify: `ERD.md` (six tables, mermaid, sections, schema)
- Modify: `PRD.md` (out-of-scope wording, core tables, D1 store list)

- [ ] **Step 1: Update `ERD.md`**

- §1 Overview: list `google_connections` as a sixth table; relationship tree gains `+----< google_connections` under `users`.
- §2 Mermaid: add `USERS ||--o| GOOGLE_CONNECTIONS : "links (read-only)"` plus the entity (fields as in migration 0007, `user_id PK/FK`, `google_email`, `enc_refresh`, `enc_access`, `access_expires_at`, `created_at`, `updated_at`).
- New section after `saved_locations` (renumber later sections): column table + note that tokens are AES-GCM encrypted with `GOOGLE_TOKEN_KEY` and that `google_email` doubles as the freeBusy calendar id (`primary` fallback).
- §8/§9 SQL Schema: append migration `0007_google_connections.sql` verbatim.
- §15 Future Tables: remove `calendar_connections` / `calendar_events` (superseded by `google_connections`).
- §16 Cloudflare Service Mapping → D1 store list: add "Google connections (read-only busy)".

- [ ] **Step 2: Update `PRD.md`**

- §21 Database core tables: add `google_connections`.
- §22 D1 store list: add google connections.
- §24 Out of Scope: replace the Google Calendar entry with the precise scope — keep "Google Calendar sync (writing MeetFlow bookings into Google)", "Microsoft Outlook", "Apple Calendar"; read-only Google busy conflict check is now implemented (see the design doc).

- [ ] **Step 3: Format and verify docs**

Run: `npx prettier --write ERD.md PRD.md && npm run check`
Expected: clean.

- [ ] **Step 4: Commit docs**

```bash
git add ERD.md PRD.md
git commit -m "docs(gcal): prd and erd describe google calendar connection"
```

- [ ] **Step 5: Apply the remote migration and deploy**

```bash
npm run db:migrate:remote
npm run deploy
```

Expected: migration applied to `meetflow-db`, worker deployed. Verify `https://meetflow.wmafendi.workers.dev/dashboard/settings` shows the Calendar card (signed-in host).

---

## Self-Review

- **Spec coverage:** Data model (Task 1), encryption (Task 2), OAuth flow incl. disconnect (Tasks 3+6), busy lookup with refresh + cache (Task 3), availability `extraBusy` (Task 4), booking reschedule integration (Task 5), settings UI (Task 6), docs (Task 7). Testing list from the spec: encrypt roundtrip/tamper ✓ (Task 2), refresh/parse/error/no-connection ✓ (Task 3), extraBusy ✓ (Task 4), settings/disconnect/authorize/bad-state ✓ (Task 6), service-level google-busy booking ✓ (Task 5).
- **Deliberate gaps (fail-safe by design):** the callback happy path's token exchange is covered at the unit level (Task 3 `exchangeGoogleCode`) — the route glue around it is not integration-tested; freeBusy against Google is never called from routes in tests (real D1 row absent → `getGoogleBusy` returns `[]` with zero fetches, so existing suites are unaffected).
- **Type consistency:** `FetchGoogleBusy = (userId, timeMinMs, timeMaxMs) => Interval[]` — used by `createBooking`/`rescheduleBooking` (Task 5), produced by `fetchGoogleBusyClosure` (Tasks 3+5); `Interval` from `src/lib/slots.ts`; `CalendarSettings` defined in Task 6 and consumed by `calendarSettings` in pages.ts.
