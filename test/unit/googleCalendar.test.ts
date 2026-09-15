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
    const busy = await getGoogleBusy(db, env, 1, now + 1, now + 3_600_001, impl);
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
    expect(await getGoogleBusy(db, env, 1, now + 2, now + 3_600_002, impl)).toEqual([]);
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