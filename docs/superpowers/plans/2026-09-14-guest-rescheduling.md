# Guest Rescheduling — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Guests can move a booking to a new slot of the same event type via a signed link.

**Architecture:** Reuse the existing HMAC booking token (cancel purpose) and the booking page widget in a "reschedule mode". A new `rescheduleBookingIfFree` runs a D1 batch (conditional insert of the new booking + conditional cancel of the old) so the swap is atomic, with compensation if the old booking was cancelled in a race.

**Tech Stack:** TypeScript, Hono (Cloudflare Worker), D1, Tailwind v4, Alpine.js, Vitest (`cloudflare:test`).

**Spec:** `docs/superpowers/specs/2026-09-14-guest-rescheduling-design.md`

---

### Task 1: Token helpers + confirmation page button

**Files:**
- Modify: `src/lib/cancelToken.ts`, `src/routes/pages.ts`, `src/views/publicBooking.ts`
- Test: `test/integration/pages.test.ts`

- [ ] **Step 1: Token helpers in `src/lib/cancelToken.ts`**

Append after `cancelUrl`:

```ts
/** Same-origin path for the reschedule page, alongside the cancel path. */
export async function reschedulePath(bookingId: number, secret: string): Promise<string> {
  const token = await signCancelToken(bookingId, secret);
  return `/booking/${bookingId}/reschedule?token=${encodeURIComponent(token)}`;
}

/** Absolute URL, for emails. */
export async function rescheduleUrl(
  appUrl: string,
  bookingId: number,
  secret: string,
): Promise<string> {
  return `${appUrl}${await reschedulePath(bookingId, secret)}`;
}
```

(The same signed token authorises managing the booking — cancelling or rescheduling.)

- [ ] **Step 2: Confirmation page button**

`confirmationPage(host, eventType, booking, cancelHref?, rescheduleHref?)` — add the `rescheduleHref` param and, in the buttons row next to the cancel button, render when present:

```ts
${
  rescheduleHref
    ? button({ label: "Reschedule", href: rescheduleHref, variant: "secondary", size: "sm" })
    : ""
}
```

Place it BEFORE the cancel button in the row.

- [ ] **Step 3: Route wiring in `src/routes/pages.ts`**

The `GET /booking/:id/confirmed` handler currently computes `cancelHref`. Extend:

```ts
const href =
  booking.status === "confirmed"
    ? await cancelPath(booking.id, c.env.SESSION_SECRET)
    : undefined;
const reschedule =
  booking.status === "confirmed"
    ? await reschedulePath(booking.id, c.env.SESSION_SECRET)
    : undefined;
return html(confirmationPage(host, eventType, booking, href, reschedule));
```

Import `reschedulePath` alongside `cancelPath`.

- [ ] **Step 4: Test**

In `test/integration/pages.test.ts`, extend "renders a public booking page" flow or add a new test — simplest: in the existing guest-cancel coverage if present; otherwise add:

```ts
it("shows a reschedule button on the confirmation page", async () => {
  const host = await createHost("wan");
  await SELF.fetch("https://example.com/api/availability", {
    method: "PUT",
    headers: { "content-type": "application/json", cookie: host.cookie },
    body: JSON.stringify({ rules: [{ day_of_week: 1, start_time: "09:00", end_time: "11:00" }] }),
  });
  await SELF.fetch("https://example.com/api/event-types", {
    method: "POST",
    headers: { "content-type": "application/json", cookie: host.cookie },
    body: JSON.stringify({ name: "Consultation", slug: "consultation", duration_minutes: 30 }),
  });
  const booked = await SELF.fetch("https://example.com/api/public/wan/consultation/book", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      start_at: "2026-10-05T01:00:00Z",
      guest_name: "Ahmad",
      guest_email: "ahmad@example.com",
      timezone: "Asia/Kuala_Lumpur",
    }),
  });
  expect(booked.status).toBe(201);
  const { booking } = await booked.json<{ booking: { id: number } }>();
  const res = await SELF.fetch(`https://example.com/booking/${booking.id}/confirmed`);
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain("Reschedule");
});
```

- [ ] **Step 5: Verify + commit**

```bash
npx vitest run test/integration/pages.test.ts
npm run typecheck && npm test
npx prettier --write src/lib/cancelToken.ts src/routes/pages.ts src/views/publicBooking.ts test/integration/pages.test.ts
npm run format:check
git add src/lib/cancelToken.ts src/routes/pages.ts src/views/publicBooking.ts test/integration/pages.test.ts
git commit -m "feat(reschedule): signed reschedule links and confirmation page button"
```

---

### Task 2: `rescheduleBookingIfFree` (D1 batch)

**Files:**
- Modify: `src/db/bookings.ts`
- Test: `test/integration/reschedule.test.ts` (create new)

- [ ] **Step 1: Write failing tests — create `test/integration/reschedule.test.ts`**

```ts
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { insertBookingIfFree, rescheduleBookingIfFree } from "../../src/db/bookings";
import { createHost, resetDb } from "../helpers";

describe("rescheduleBookingIfFree", () => {
  beforeEach(resetDb);

  const base = {
    eventTypeId: 1,
    guestName: "Ahmad",
    guestEmail: "ahmad@example.com",
    timezone: "UTC",
    notes: "keep me",
    now: "2026-09-01T00:00:00Z",
  };

  it("creates the new booking and cancels the old one", async () => {
    const host = await createHost("wan");
    const old = await insertBookingIfFree(env.DB, {
      ...base,
      userId: host.id,
      startAt: "2026-09-21T01:00:00Z",
      endAt: "2026-09-21T01:30:00Z",
      bufferMinutes: 0,
    });
    expect(old).not.toBeNull();

    const result = await rescheduleBookingIfFree(env.DB, {
      oldBookingId: old!.id,
      userId: host.id,
      ...base,
      startAt: "2026-09-21T02:00:00Z",
      endAt: "2026-09-21T02:30:00Z",
      bufferMinutes: 0,
    });
    expect(result).not.toBeNull();
    expect(result!.start_at).toBe("2026-09-21T02:00:00Z");

    const rows = await env.DB.prepare(
      "SELECT id, status, start_at FROM bookings WHERE user_id = ? ORDER BY id",
    )
      .bind(host.id)
      .all<{ id: number; status: string; start_at: string }>();
    expect(rows.results).toHaveLength(2);
    const oldRow = rows.results.find((r) => r.id === old!.id)!;
    expect(oldRow.status).toBe("cancelled");
    const newRow = rows.results.find((r) => r.id !== old!.id)!;
    expect(newRow.status).toBe("confirmed");
  });

  it("leaves the old booking alone when the new slot is taken", async () => {
    const host = await createHost("wan");
    const old = await insertBookingIfFree(env.DB, {
      ...base,
      userId: host.id,
      startAt: "2026-09-21T01:00:00Z",
      endAt: "2026-09-21T01:30:00Z",
      bufferMinutes: 0,
    });
    const blocker = await insertBookingIfFree(env.DB, {
      ...base,
      userId: host.id,
      eventTypeId: 1,
      startAt: "2026-09-21T02:00:00Z",
      endAt: "2026-09-21T02:30:00Z",
      bufferMinutes: 0,
    });
    expect(blocker).not.toBeNull();

    const result = await rescheduleBookingIfFree(env.DB, {
      oldBookingId: old!.id,
      userId: host.id,
      ...base,
      startAt: "2026-09-21T02:00:00Z",
      endAt: "2026-09-21T02:30:00Z",
      bufferMinutes: 0,
    });
    expect(result).toBeNull();

    const oldRow = await env.DB.prepare("SELECT status FROM bookings WHERE id = ?")
      .bind(old!.id)
      .first<{ status: string }>();
    expect(oldRow!.status).toBe("confirmed");
  });

  it("rolls the new booking back when the old one was already cancelled", async () => {
    const host = await createHost("wan");
    const old = await insertBookingIfFree(env.DB, {
      ...base,
      userId: host.id,
      startAt: "2026-09-21T01:00:00Z",
      endAt: "2026-09-21T01:30:00Z",
      bufferMinutes: 0,
    });
    await env.DB.prepare("UPDATE bookings SET status='cancelled' WHERE id = ?")
      .bind(old!.id)
      .run();

    const result = await rescheduleBookingIfFree(env.DB, {
      oldBookingId: old!.id,
      userId: host.id,
      ...base,
      startAt: "2026-09-21T02:00:00Z",
      endAt: "2026-09-21T02:30:00Z",
      bufferMinutes: 0,
    });
    expect(result).toBeNull();

    const confirmed = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM bookings WHERE user_id = ? AND status = 'confirmed'",
    )
      .bind(host.id)
      .first<{ n: number }>();
    expect(confirmed!.n).toBe(0);
  });
});
```

(For tests where the old booking's `event_type_id` must exist, seed real event types via `api("/api/event-types", …)` like the repo's other tests and use the returned ids.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/integration/reschedule.test.ts`
Expected: FAIL — `rescheduleBookingIfFree` not exported.

- [ ] **Step 3: Implement in `src/db/bookings.ts`**

Add after `insertBookingIfFree`:

```ts
export interface RescheduleInput {
  oldBookingId: number;
  userId: number;
  eventTypeId: number;
  guestName: string;
  guestEmail: string;
  startAt: string;
  endAt: string;
  timezone: string;
  notes: string | null;
  now: string;
  bufferMinutes: number;
}

/**
 * Atomic reschedule: conditionally insert the new booking and cancel the old
 * one in a single D1 batch. Returns the new row, or null when either side
 * fails (slot taken, or the old booking is no longer confirmed). If the old
 * booking was cancelled in a race, the freshly inserted row is rolled back so
 * the guest is never left with two confirmed bookings.
 */
export async function rescheduleBookingIfFree(
  db: D1Database,
  input: RescheduleInput,
): Promise<BookingRow | null> {
  const bufferedEnd = isoUtc(addMinutes(new Date(input.endAt), input.bufferMinutes));
  const bufferedStart = isoUtc(addMinutes(new Date(input.startAt), -input.bufferMinutes));

  const insert = db
    .prepare(
      `INSERT INTO bookings (
         user_id, event_type_id, guest_name, guest_email,
         start_at, end_at, timezone, status, notes, created_at, updated_at
       )
       SELECT ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?
       WHERE NOT EXISTS (
         SELECT 1 FROM bookings
         WHERE user_id = ?
           AND status = 'confirmed'
           AND start_at < ?
           AND end_at > ?
       )
       AND NOT EXISTS (
         SELECT 1 FROM bookings
         WHERE user_id = ?
           AND status = 'confirmed'
           AND event_type_id = ?
           AND start_at < ?
           AND end_at > ?
       )
       RETURNING *`,
    )
    .bind(
      input.userId,
      input.eventTypeId,
      input.guestName,
      input.guestEmail,
      input.startAt,
      input.endAt,
      input.timezone,
      input.notes,
      input.now,
      input.now,
      input.userId,
      input.endAt,
      input.startAt,
      input.userId,
      input.eventTypeId,
      bufferedEnd,
      bufferedStart,
    );

  const cancel = db
    .prepare(
      `UPDATE bookings SET status = 'cancelled', updated_at = ?
       WHERE id = ? AND user_id = ? AND status = 'confirmed'
       RETURNING id`,
    )
    .bind(input.now, input.oldBookingId, input.userId);

  const [insertResult, cancelResult] = await db.batch([insert, cancel]);

  const newBooking = insertResult.results?.[0] as BookingRow | undefined;
  if (!newBooking) return null;

  if (!cancelResult.results?.[0]) {
    // Old booking was already cancelled — undo the insert we just made.
    await db
      .prepare("UPDATE bookings SET status = 'cancelled', updated_at = ? WHERE id = ?")
      .bind(input.now, newBooking.id)
      .run();
    return null;
  }

  return newBooking;
}
```

Check `db.batch` result typing: `D1Result[]` where each has `results` (array of rows) — verify against existing batch usage in the repo (`db.batch` is used in `db/availability.ts` `replaceRules`). Match that typing style.

- [ ] **Step 4: Run tests + commit**

```bash
npx vitest run test/integration/reschedule.test.ts
npm run typecheck && npm test
npx prettier --write src/db/bookings.ts test/integration/reschedule.test.ts
npm run format:check
git add src/db/bookings.ts test/integration/reschedule.test.ts
git commit -m "feat(reschedule): atomic rescheduleBookingIfFree via D1 batch"
```

---

### Task 3: `rescheduleBooking` service

**Files:**
- Modify: `src/services/booking.ts`
- Test: `test/integration/reschedule.test.ts` (extend)

- [ ] **Step 1: Write failing tests**

Append to `test/integration/reschedule.test.ts` (import `rescheduleBooking`, `signCancelToken`, and the existing `api`/`createHost`/`resetDb` helpers; SESSION_SECRET in tests is `"test-secret-do-not-use-in-prod"`):

```ts
const SECRET = "test-secret-do-not-use-in-prod";

async function seedBookable() {
  const host = await createHost("wan", "Asia/Kuala_Lumpur");
  await api("/api/availability", {
    method: "PUT",
    cookie: host.cookie,
    body: JSON.stringify({ rules: [{ day_of_week: 1, start_time: "09:00", end_time: "11:00" }] }),
  });
  const created = await api("/api/event-types", {
    method: "POST",
    cookie: host.cookie,
    body: JSON.stringify({ name: "Consultation", slug: "consultation", duration_minutes: 30 }),
  });
  const { eventType } = await created.json<{ eventType: { id: number } }>();
  const booked = await api("/api/public/wan/consultation/book", {
    method: "POST",
    body: JSON.stringify({
      start_at: "2026-10-05T01:00:00Z",
      guest_name: "Ahmad",
      guest_email: "ahmad@example.com",
      notes: "keep me",
      timezone: "Asia/Kuala_Lumpur",
    }),
  });
  const { booking } = await booked.json<{ booking: { id: number } }>();
  return { host, eventType, booking };
}

describe("rescheduleBooking", () => {
  beforeEach(resetDb);

  it("moves a booking and copies guest details", async () => {
    const { host, booking } = await seedBookable();
    const token = await signCancelToken(booking.id, SECRET);
    const result = await rescheduleBooking(env.DB, {
      bookingId: booking.id,
      token,
      secret: SECRET,
      newStartAt: "2026-10-05T02:00:00Z",
      guestTimezone: "Asia/Kuala_Lumpur",
      nowMs: Date.parse("2026-10-01T00:00:00Z"),
    });
    expect(result.booking.start_at).toBe("2026-10-05T02:00:00Z");
    expect(result.booking.guest_name).toBe("Ahmad");
    expect(result.booking.notes).toBe("keep me");

    const oldRow = await env.DB.prepare("SELECT status FROM bookings WHERE id = ?")
      .bind(booking.id)
      .first<{ status: string }>();
    expect(oldRow!.status).toBe("cancelled");
  });

  it("rejects an invalid token", async () => {
    const { booking } = await seedBookable();
    await expect(
      rescheduleBooking(env.DB, {
        bookingId: booking.id,
        token: "garbage",
        secret: SECRET,
        newStartAt: "2026-10-05T02:00:00Z",
        guestTimezone: "UTC",
        nowMs: Date.parse("2026-10-01T00:00:00Z"),
      }),
    ).rejects.toMatchObject({ status: 404 });
  });

  it("rejects a slot inside another booking's buffer", async () => {
    const { booking } = await seedBookable();
    await api("/api/public/wan/consultation/book", {
      method: "POST",
      body: JSON.stringify({
        start_at: "2026-10-05T01:30:00Z",
        guest_name: "Bob",
        guest_email: "bob@example.com",
        timezone: "UTC",
      }),
    });
    const token = await signCancelToken(booking.id, SECRET);
    await expect(
      rescheduleBooking(env.DB, {
        bookingId: booking.id,
        token,
        secret: SECRET,
        newStartAt: "2026-10-05T01:30:00Z",
        guestTimezone: "UTC",
        nowMs: Date.parse("2026-10-01T00:00:00Z"),
      }),
    ).rejects.toMatchObject({ status: 409 });
  });

  it("refuses to reschedule a past booking", async () => {
    const { booking } = await seedBookable();
    const token = await signCancelToken(booking.id, SECRET);
    await expect(
      rescheduleBooking(env.DB, {
        bookingId: booking.id,
        token,
        secret: SECRET,
        newStartAt: "2026-10-12T02:00:00Z",
        guestTimezone: "UTC",
        nowMs: Date.parse("2026-10-30T00:00:00Z"),
      }),
    ).rejects.toMatchObject({ status: 409 });
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/integration/reschedule.test.ts`
Expected: FAIL — `rescheduleBooking` not exported.

- [ ] **Step 3: Implement in `src/services/booking.ts`**

Add import `rescheduleBookingIfFree` from `../db/bookings` and `signCancelToken`? No — token verification is `verifyCancelToken`, already imported.

```ts
export interface RescheduleInput {
  bookingId: number;
  token: string;
  secret: string;
  newStartAt: string;
  guestTimezone: string;
  nowMs?: number;
}

/**
 * Moves a booking to a new slot of the same event type. The token is the
 * authorisation; details are copied from the existing booking.
 */
export async function rescheduleBooking(
  db: D1Database,
  input: RescheduleInput,
): Promise<GuestCancellable & { booking: BookingRow }> {
  const resolved = await resolveCancelToken(db, input.bookingId, input.token, input.secret);

  if (resolved.booking.status !== "confirmed") {
    throw new BookingError("This booking can no longer be rescheduled.", 409);
  }
  const nowMs = input.nowMs ?? Date.now();
  if (Date.parse(resolved.booking.end_at) <= nowMs) {
    throw new BookingError("This meeting has already taken place.", 409);
  }
  if (!isValidTimeZone(input.guestTimezone)) {
    throw new BookingError("Invalid timezone", 400);
  }

  let start: Date;
  try {
    start = parseIsoUtc(input.newStartAt);
  } catch {
    throw new BookingError("Invalid start time", 400);
  }
  if (start.getTime() < nowMs) throw new BookingError("That time is in the past", 422);

  const { host, eventType } = resolved;
  const end = addMinutes(start, eventType.duration_minutes);
  const startIso = isoUtc(start);
  const endIso = isoUtc(end);

  const hostDate = zonedDateString(start, host.timezone);
  if (!isYmd(hostDate)) throw new BookingError("Invalid start time", 400);

  const { grid, free } = await getDaySlots(db, {
    hostId: host.id,
    hostTimezone: host.timezone,
    eventTypeId: eventType.id,
    durationMinutes: eventType.duration_minutes,
    bufferMinutes: eventType.buffer_minutes,
    dateYmd: hostDate,
    nowMs,
  });
  if (!grid.some((s) => s.startAt === startIso)) {
    throw new BookingError("That time is not available", 422);
  }
  if (!free.some((s) => s.startAt === startIso)) {
    throw new BookingError("This time slot is no longer available.", 409);
  }

  const booking = await rescheduleBookingIfFree(db, {
    oldBookingId: resolved.booking.id,
    userId: host.id,
    eventTypeId: eventType.id,
    guestName: resolved.booking.guest_name,
    guestEmail: resolved.booking.guest_email,
    startAt: startIso,
    endAt: endIso,
    timezone: input.guestTimezone,
    notes: resolved.booking.notes,
    now: nowIso(),
    bufferMinutes: eventType.buffer_minutes,
  });
  if (!booking) throw new BookingError("This booking can no longer be rescheduled.", 409);

  return { ...resolved, booking };
}
```

Note: `getDaySlots` is already imported in booking.ts; `isValidTimeZone`, `parseIsoUtc`, `isYmd`, `zonedDateString`, `addMinutes`, `isoUtc`, `nowIso` are already imported.

- [ ] **Step 4: Run tests + commit**

```bash
npx vitest run test/integration/reschedule.test.ts
npm run typecheck && npm test
npx prettier --write src/services/booking.ts test/integration/reschedule.test.ts
npm run format:check
git add src/services/booking.ts test/integration/reschedule.test.ts
git commit -m "feat(reschedule): rescheduleBooking service"
```

---

### Task 4: Reschedule routes + booking widget mode

**Files:**
- Modify: `src/routes/pages.ts`, `src/views/publicBooking.ts`
- Test: `test/integration/reschedule.test.ts` (extend), `test/integration/pages.test.ts`

- [ ] **Step 1: Write failing tests**

Append to `test/integration/reschedule.test.ts` (import `SELF` from `cloudflare:test`):

```ts
describe("reschedule pages and API", () => {
  beforeEach(resetDb);

  it("renders the reschedule page for a valid link", async () => {
    const { booking } = await seedBookable();
    const token = await signCancelToken(booking.id, SECRET);
    const res = await SELF.fetch(
      `https://example.com/booking/${booking.id}/reschedule?token=${encodeURIComponent(token)}`,
    );
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Reschedule");
    expect(html).toContain("Confirm new time");
  });

  it("rejects an invalid token with a friendly page", async () => {
    const { booking } = await seedBookable();
    const res = await SELF.fetch(
      `https://example.com/booking/${booking.id}/reschedule?token=garbage`,
    );
    expect(res.status).toBe(404);
  });

  it("reschedules via POST and returns the new booking", async () => {
    const { booking } = await seedBookable();
    const token = await signCancelToken(booking.id, SECRET);
    const res = await SELF.fetch(`https://example.com/booking/${booking.id}/reschedule`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        token,
        start_at: "2026-10-05T02:00:00Z",
        timezone: "Asia/Kuala_Lumpur",
      }),
    });
    expect(res.status).toBe(201);
    const { booking: newBooking } = await res.json<{ booking: { id: number; start_at: string } }>();
    expect(newBooking.start_at).toBe("2026-10-05T02:00:00Z");
    expect(newBooking.id).not.toBe(booking.id);
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/integration/reschedule.test.ts`
Expected: FAIL — 404s (routes missing).

- [ ] **Step 3: Routes in `src/routes/pages.ts`**

Add `rescheduleBooking` to the booking service import. Add after the guest-cancel POST route:

```ts
pageRoutes.get("/booking/:id/reschedule", rateLimit(LIMITS.guestCancel), async (c) => {
  const token = c.req.query("token") ?? "";
  try {
    const { booking, host, eventType } = await resolveCancelToken(
      c.env.DB,
      Number(c.req.param("id")),
      token,
      c.env.SESSION_SECRET,
    );
    if (booking.status !== "confirmed") {
      return html(cancelUnavailablePage("This booking can no longer be rescheduled."), 409);
    }
    if (Date.parse(booking.end_at) <= Date.now()) {
      return html(cancelUnavailablePage("This meeting has already taken place."), 409);
    }
    return html(bookingPage(host, eventType, { bookingId: booking.id, token, oldStartAt: booking.start_at }));
  } catch (err) {
    if (err instanceof BookingError) return html(cancelUnavailablePage(err.message), err.status);
    throw err;
  }
});

pageRoutes.post("/booking/:id/reschedule", rateLimit(LIMITS.guestCancel), async (c) => {
  const body = await c.req
    .json<Record<string, unknown>>()
    .catch(() => ({}) as Record<string, unknown>);
  try {
    const result = await rescheduleBooking(c.env.DB, {
      bookingId: Number(c.req.param("id")),
      token: String(body.token ?? ""),
      secret: c.env.SESSION_SECRET,
      newStartAt: String(body.start_at ?? ""),
      guestTimezone: String(body.timezone ?? "UTC"),
    });
    c.executionCtx.waitUntil(queueBookingCreated(c.env, result.booking.id));
    return c.json({ booking: result.booking }, 201);
  } catch (err) {
    if (err instanceof BookingError) return c.json({ error: err.message }, err.status);
    throw err;
  }
});
```

Imports needed: `rescheduleBooking` (services/booking), `bookingPage` (views/publicBooking — likely already imported), `queueBookingCreated` (services/email — likely already imported), `cancelUnavailablePage` (already imported).

- [ ] **Step 4: Widget reschedule mode in `src/views/publicBooking.ts`**

Change `bookingPage(host, eventType)` to:

```ts
export function bookingPage(
  host: PublicUser,
  eventType: EventTypeRow,
  reschedule?: { bookingId: number; token: string; oldStartAt: string },
): string {
```

In the `data` object add:

```ts
reschedule: reschedule ?? null,
```

In the left rail, after the `x-if="selected"` summary block, add:

```html
<template x-if="reschedule">
  <div class="mt-4 border-t border-line pt-4">
    <p class="flex items-center gap-2 text-[0.8125rem] text-muted">
      ${icon("calendar", "size-4 shrink-0")}
      <span>Currently booked</span>
    </p>
    <p class="ui-time mt-1 text-sm font-medium text-ink" x-text="oldLabel()"></p>
  </div>
</template>
```

Widget script changes:

- In the returned object (near `summary()`), add:

```js
oldLabel() {
  if (!this.reschedule) return '';
  return new Date(this.reschedule.oldStartAt).toLocaleString('en-US', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
    hour12: this.hour12,
    timeZone: this.guestTimezone,
  });
},
```

- Confirm button label: replace

```html
<span x-text="submitting ? 'Booking…' : 'Confirm booking'"></span>
```

with

```html
<span x-text="submitting ? 'Booking…' : (reschedule ? 'Confirm new time' : 'Confirm booking')"></span>
```

- `submit()`: replace the URL/body construction with:

```js
async submit() {
  this.submitting = true;
  this.error = '';
  var isReschedule = !!this.reschedule;
  var url = isReschedule
    ? '/booking/' + this.reschedule.bookingId + '/reschedule'
    : '/api/public/' + this.hostSlug + '/' + this.eventSlug + '/book';
  var payload = isReschedule
    ? { token: this.reschedule.token, start_at: this.selected.startAt, timezone: this.guestTimezone }
    : {
        start_at: this.selected.startAt,
        guest_name: this.guestName,
        guest_email: this.guestEmail,
        notes: this.notes,
        timezone: this.guestTimezone,
      };
  var res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(payload),
  });
  this.submitting = false;
  if (res.status === 201) {
    var created = await res.json();
    window.location.href = '/booking/' + created.booking.id + '/confirmed';
    return;
  }
  var body = await res.json().catch(function () { return {}; });
  this.error = body.error || 'Something went wrong. Please try again.';
  if (res.status === 409 || res.status === 422) {
    this.step = 'slot';
    if (this.selectedDate) this.pickDay(this.selectedDate);
  }
},
```

- The step-2b summary section ("Your booking") keeps working; optionally change the eyebrow to `x-text="reschedule ? 'New time' : 'Your booking'"` — do it:

```html
<p class="ui-eyebrow" x-text="reschedule ? 'New time' : 'Your booking'"></p>
```

- Also in the form step (1b), add the currently-booked line? The left rail already shows it — skip.

- [ ] **Step 5: Run tests + commit**

```bash
npx vitest run test/integration/reschedule.test.ts test/integration/pages.test.ts
npm run typecheck && npm test
npx prettier --write src/routes/pages.ts src/views/publicBooking.ts test/integration/reschedule.test.ts
npm run format:check
git add src/routes/pages.ts src/views/publicBooking.ts test/integration/reschedule.test.ts
git commit -m "feat(reschedule): reschedule page, API and widget mode"
```

---

### Task 5: Email reschedule link

**Files:**
- Modify: `src/lib/emailTemplates.ts`, `src/services/email.ts`
- Test: `test/unit/emailTemplates.test.ts`

- [ ] **Step 1: Write failing tests**

In `test/unit/emailTemplates.test.ts` add (match existing test style — read the file first; it builds a `BookingEmailContext`):

```ts
it("includes a reschedule link in the guest confirmation when present", () => {
  const message = guestConfirmation(
    { ...ctx, rescheduleUrl: "https://meetflow.example/booking/1/reschedule?token=abc" },
    "UTC",
  );
  expect(message.html).toContain("Reschedule this booking");
  expect(message.text).toContain("Reschedule this booking");
});

it("does not add a reschedule link to host mail", () => {
  const message = hostNotification({ ...ctx, rescheduleUrl: "https://x" }, "UTC");
  expect(message.html).not.toContain("Reschedule");
});
```

(Adapt `ctx` to whatever the file's existing context fixture is.)

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/unit/emailTemplates.test.ts`
Expected: FAIL.

- [ ] **Step 3: Templates in `src/lib/emailTemplates.ts`**

- `BookingEmailContext` gains `rescheduleUrl?: string;`
- `Layout` gains `cta2?: { label: string; href: string };`
- In `render()`, after the `layout.cta` block add:

```ts
${
  layout.cta2
    ? `<p style="margin:12px 0 4px;"><a href="${escapeHtml(layout.cta2.href)}" style="display:inline-block;color:#111827;font-size:14px;font-weight:500;text-decoration:underline;">${escapeHtml(
        layout.cta2.label,
      )}</a></p>`
    : ""
}
```

- In the text body array add: `...(layout.cta2 ? ["", `${layout.cta2.label}: ${layout.cta2.href}`] : []),`
- `guestConfirmation`: pass `cta2: ctx.rescheduleUrl ? { label: "Reschedule this booking", href: ctx.rescheduleUrl } : undefined,`

- [ ] **Step 4: Context in `src/services/email.ts`**

In `loadContext`, where `cancelUrl` is computed for guest-facing mail, also compute:

```ts
rescheduleUrl:
  job.to === "guest" && job.kind === "booking_confirmed"
    ? await rescheduleUrl(env.APP_URL, booking.id, env.SESSION_SECRET)
    : undefined,
```

Add to the `ctx` object; import `rescheduleUrl` from `../lib/cancelToken` (the file already imports `cancelUrl`).

- [ ] **Step 5: Run tests + commit**

```bash
npx vitest run test/unit/emailTemplates.test.ts
npm run typecheck && npm test
npx prettier --write src/lib/emailTemplates.ts src/services/email.ts test/unit/emailTemplates.test.ts
npm run format:check
git add src/lib/emailTemplates.ts src/services/email.ts test/unit/emailTemplates.test.ts
git commit -m "feat(reschedule): reschedule link in guest confirmation email"
```

---

### Task 6: Deploy + verify

- [ ] **Step 1: Deploy**

Run: `npm run deploy` (no new migration for this feature).

- [ ] **Step 2: Smoke-check live**

Run: `curl -s -o /dev/null -w "%{http_code}\n" https://meetflow.wmafendi.workers.dev/booking/1/reschedule?token=x`
Expected: 404 (friendly page) — route exists.

- [ ] **Step 3: Full flow on the live site**

Book a slot on https://meetflow.wmafendi.workers.dev/wmafendi/30m-meeting, open the confirmation page, click Reschedule, pick a new slot, confirm — the new time lands and the dashboard shows one cancelled + one confirmed booking.

- [ ] **Step 4: Commit leftovers if any**

```bash
git status --short
```