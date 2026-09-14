# Design: Google Calendar connection (read-only conflict check)

Date: 2026-09-14 · Status: approved by user

Hosts can link their Google Calendar so MeetFlow hides slots that overlap
events already in their Google Calendar. Read-only: MeetFlow never writes
bookings back to Google.

## Data model

Migration `0007_google_connections.sql`:

```sql
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

One connection per host; reconnecting upserts. Tokens are stored encrypted
(AES-GCM, `src/lib/encrypt.ts`, key derived from the `GOOGLE_TOKEN_KEY`
secret).

## Secrets

`GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (OAuth app), `GOOGLE_TOKEN_KEY`
(token encryption). All optional: absent = feature silently off, availability
behaves exactly as today.

## OAuth flow

- `GET /oauth/google/authorize` (host-only): builds the Google auth URL —
  `scope=calendar.readonly`, `access_type=offline`, `prompt=consent`,
  `redirect_uri={APP_URL}/oauth/google/callback`, and a `state` value that is
  the host's user id signed under a dedicated purpose (reuses
  `src/lib/hmac.ts`).
- `GET /oauth/google/callback`: verifies `state` (must decode to the signed-in
  host's id — CSRF guard), exchanges the code at
  `https://oauth2.googleapis.com/token`, encrypts `refresh_token`,
  `access_token` and `expires_in` and upserts the row. Redirects to
  `/dashboard/settings?toast=Google Calendar connected`.
- `POST /dashboard/settings/calendar/disconnect`: deletes the row, toast
  "Google Calendar disconnected".

## Busy lookup

`src/lib/googleCalendar.ts`:

- `getGoogleBusy(env, userId, timeMin, timeMax, fetchImpl): Promise<Interval[]>`
  — returns `[]` when the host has no connection or on any error (fail-open).
- Access token: stored token when unexpired, otherwise a refresh-token
  exchange (`grant_type=refresh_token`) that re-encrypts and persists the
  rotated tokens.
- Busy: `POST https://www.googleapis.com/calendar/v3/freeBusy` with
  `{ timeMin, timeMax, items: [{ id: google_email }] }` (primary calendar).
  Parsed to `{ startMs, endMs }` intervals.
- Best-effort in-isolate cache (Map keyed by user+range, 60s TTL) to avoid
  hammering Google on every calendar click. No persistence — correctness never
  depends on the cache.

## Availability integration

`getDaySlots` / `getMonthFreeDays` gain `extraBusy?: Interval[]` appended to
the local busy list before `removeBusy`. Callers fetch Google busy for the
relevant window and pass it: the public slots route, the month route, and
`createBooking` / `rescheduleBooking` (so a Google-busy slot can never be
booked even if the page was stale).

## Settings UI

Settings gains a "Calendar" card:

- Not connected: explanation + **Connect Google Calendar** (link to
  `/oauth/google/authorize`).
- Connected: the Google email + **Disconnect** (POST form).
- `settingsPage` gains a `googleEmail?: string | null` param.

## Out of scope

- Writing MeetFlow bookings into Google Calendar.
- Multiple calendars / per-calendar selection (primary only).
- Outlook/iCloud connections.
- Auto-generated Google Meet links (separate feature).

## Files

- `migrations/0007_google_connections.sql` (new)
- `src/lib/encrypt.ts` (new), `src/lib/googleCalendar.ts` (new)
- `src/db/googleConnections.ts` (new)
- `src/types.ts` (GoogleConnectionRow), `src/env.d.ts` (3 secrets)
- `src/services/availability.ts` (`extraBusy`), `src/services/booking.ts`
  (fetch + pass), `src/routes/api.public.ts` (fetch + pass)
- `src/routes/pages.ts` (authorize/callback/disconnect, settings data)
- `src/views/dashboard.ts` (settings calendar card)
- tests: `encrypt.test.ts`, `googleCalendar.test.ts`,
  `googleConnection.test.ts` (routes), availability extraBusy test

## Testing

- encrypt: roundtrip, tamper detection.
- googleCalendar: token refresh on expiry (mocked fetch), freeBusy parsing,
  error → `[]`, no connection → `[]`.
- availability: extraBusy blocks a slot; empty extraBusy changes nothing.
- routes: settings shows connect vs disconnect state; disconnect deletes row;
  authorize redirects to Google with state; callback rejects bad state.
- booking: a Google-busy slot cannot be booked when extraBusy covers it
  (service-level test with injected fetch).
