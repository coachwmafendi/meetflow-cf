# Buffer Time Between Meetings — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add a per-event-type "buffer after meeting" (0–120 min) that keeps the host from being back-to-back.

**Architecture:** `buffer_minutes` column on `event_types`. Availability computation expands busy intervals of **same-type** bookings by the buffer (slots + month free-days). `insertBookingIfFree` gains a buffered-overlap guard so concurrent bookings cannot land inside a buffer window. One number field in the create modal and edit page.

**Tech Stack:** TypeScript, Hono (Cloudflare Worker), D1, Tailwind v4, Alpine.js, Vitest (`cloudflare:test`).

**Spec:** `docs/superpowers/specs/2026-09-14-buffer-time-between-meetings-design.md`

---

### Task 1: Migration, types, and DB layer (buffer + buffered insert guard)

**Files:**
- Create: `migrations/0006_buffer_minutes.sql`
- Modify: `src/types.ts`, `src/db/eventTypes.ts`, `src/db/bookings.ts`
- Test: `test/integration/slots.service.test.ts`, `test/integration/booking.test.ts`

- [ ] **Step 1: Write the failing tests**

In `test/integration/booking.test.ts`, add (check existing imports — `env` from `cloudflare:test`, `resetDb`, `createHost` from `../helpers`, and `insertBookingIfFree` from `../../src/db/bookings`):

```ts
import { insertBookingIfFree } from "../../src/db/bookings";

describe("insertBookingIfFree buffer guard", () => {
  beforeEach(resetDb);

  const base = {
    eventTypeId: 1,
    guestName: "G",
    guestEmail: "g@example.com",
    timezone: "UTC",
    notes: null,
    now: "2026-09-01T00:00:00Z",
  };

  it("rejects a booking that lands inside another same-type booking's buffer", async () => {
    const host = await createHost("wan");
    const first = await insertBookingIfFree(env.DB, {
      ...base,
      userId: host.id,
      startAt: "2026-09-21T01:00:00Z",
      endAt: "2026-09-21T01:30:00Z",
      bufferMinutes: 15,
    });
    expect(first).not.toBeNull();

    // 10:30 slot starts exactly 15 min after the first meeting's buffer ends
    // (end 01:30 + 15 = 01:45) → starts 01:30 is INSIDE the buffer window.
    const inside = await insertBookingIfFree(env.DB, {
      ...base,
      userId: host.id,
      startAt: "2026-09-21T01:30:00Z",
      endAt: "2026-09-21T02:00:00Z",
      bufferMinutes: 15,
    });
    expect(inside).toBeNull();

    // 01:45 onwards is clear of the buffer.
    const after = await insertBookingIfFree(env.DB, {
      ...base,
      userId: host.id,
      startAt: "2026-09-21T01:45:00Z",
      endAt: "2026-09-21T02:15:00Z",
      bufferMinutes: 15,
    });
    expect(after).not.toBeNull();
  });

  it("ignores buffer when the existing booking is a different event type", async () => {
    const host = await createHost("wan");
    const first = await insertBookingIfFree(env.DB, {
      ...base,
      userId: host.id,
      eventTypeId: 1,
      startAt: "2026-09-21T01:00:00Z",
      endAt: "2026-09-21T01:30:00Z",
      bufferMinutes: 15,
    });
    expect(first).not.toBeNull();

    const otherType = await insertBookingIfFree(env.DB, {
      ...base,
      userId: host.id,
      eventTypeId: 2,
      startAt: "2026-09-21T01:30:00Z",
      endAt: "2026-09-21T02:00:00Z",
      bufferMinutes: 0,
    });
    expect(otherType).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/integration/booking.test.ts`
Expected: FAIL — TS error (`bufferMinutes` not in `InsertBookingInput`) or buffer guard absent.

- [ ] **Step 3: Migration — create `migrations/0006_buffer_minutes.sql`**

```sql
-- Gap after each meeting of an event type, so the host is never back-to-back.
-- 0 means meetings may follow each other with no gap.
ALTER TABLE event_types ADD COLUMN buffer_minutes INTEGER NOT NULL DEFAULT 0;
```

- [ ] **Step 4: `src/types.ts`**

Add to `EventTypeRow`, after `duration_minutes: number;`:

```ts
  /** Minutes of gap left after each booking of this type (0 = none). */
  buffer_minutes: number;
```

- [ ] **Step 5: `src/db/eventTypes.ts`**

`InsertEventTypeInput` gains `bufferMinutes: number;`. The INSERT becomes:

```sql
INSERT INTO event_types (user_id, name, slug, description, duration_minutes, buffer_minutes, location_type, location_value, is_active, created_at, updated_at)
VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, ?, ?)
```

bind order: userId, name, slug, description, durationMinutes, bufferMinutes, locationType, locationValue, now, now.

`UpdateEventTypeInput` gains `bufferMinutes: number;`. The UPDATE becomes:

```sql
UPDATE event_types
SET name = ?, slug = ?, description = ?, duration_minutes = ?, buffer_minutes = ?,
    location_type = ?, location_value = ?, is_active = ?, updated_at = ?
WHERE id = ? AND user_id = ?
```

bind order: name, slug, description, durationMinutes, bufferMinutes, locationType, locationValue, isActive, now, id, userId.

- [ ] **Step 6: `src/db/bookings.ts`**

`BusyInterval` gains `event_type_id: number;` and the SELECT becomes:

```sql
SELECT start_at, end_at, event_type_id FROM bookings
```

`InsertBookingInput` gains `bufferMinutes: number;`.

Add `import { isoUtc } from "../lib/time";` and `import { addMinutes } from "../lib/time";` (single import line: `import { addMinutes, isoUtc } from "../lib/time";`).

`insertBookingIfFree` SQL gains a second `NOT EXISTS` (same-type buffered guard):

```sql
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
RETURNING *
```

Compute buffered bounds before the query:

```ts
const bufferedEnd = isoUtc(addMinutes(new Date(input.endAt), input.bufferMinutes));
const bufferedStart = isoUtc(addMinutes(new Date(input.startAt), -input.bufferMinutes));
```

Bind order (append after existing): input.userId (first guard, as today: userId, endAt, startAt), then second guard: input.userId, input.eventTypeId, bufferedEnd, bufferedStart.

- [ ] **Step 7: Fix every `insertEventType`/`updateEventType` caller for typecheck**

`tsc` will list them. In `src/routes/api.eventTypes.ts` (create + patch + delete-deactivate), `src/routes/pages.ts` (legacy create, edit, toggle, delete-deactivate, clone) add `bufferMinutes` values — use `0` / submitted value / `current.buffer_minutes` as appropriate (Task 3 does the real wiring; here pass what compiles and keeps behaviour: for toggle/delete-deactivate/clone pass `current.buffer_minutes`; for create/patch/edit pass a parsed value, defaulting to 0 for now).

- [ ] **Step 8: Run tests**

Run: `npx vitest run test/integration/booking.test.ts test/integration/slots.service.test.ts`
Expected: booking buffer tests pass; existing suites still pass.

- [ ] **Step 9: Typecheck + full suite**

Run: `npm run typecheck && npm test`
Expected: all green.

- [ ] **Step 10: Prettier + commit**

```bash
npx prettier --write migrations/0006_buffer_minutes.sql src/types.ts src/db/eventTypes.ts src/db/bookings.ts src/routes/api.eventTypes.ts src/routes/pages.ts test/integration/booking.test.ts
git add migrations/0006_buffer_minutes.sql src/types.ts src/db/eventTypes.ts src/db/bookings.ts src/routes/api.eventTypes.ts src/routes/pages.ts test/integration/booking.test.ts
git commit -m "feat(buffer): buffer_minutes column and buffered insert guard"
```

---

### Task 2: Availability expansion (slots + month)

**Files:**
- Modify: `src/services/availability.ts`, `src/services/booking.ts`
- Test: `test/integration/slots.service.test.ts`, `test/integration/monthAvailability.test.ts`

- [ ] **Step 1: Write failing tests**

In `test/integration/slots.service.test.ts` add:

```ts
it("expands same-type bookings by the buffer", async () => {
  const { host, eventTypeId } = await seed();
  const now = "2026-09-01T00:00:00Z";
  await env.DB.prepare(
    `INSERT INTO bookings (user_id,event_type_id,guest_name,guest_email,start_at,end_at,timezone,status,created_at,updated_at)
     VALUES (?,?,'G','g@example.com','2026-09-21T01:00:00Z','2026-09-21T01:30:00Z','UTC','confirmed',?,?)`,
  )
    .bind(host.id, eventTypeId, now, now)
    .run();

  const slots = await getSlotsForDate(env.DB, {
    ...BASE,
    hostId: host.id,
    eventTypeId,
    bufferMinutes: 15,
    dateYmd: "2026-09-21",
  });
  // 09:00 slot taken; 09:30 falls inside the 15-min buffer (until 09:45 local).
  expect(slots.map((s) => s.startAt)).toEqual(["2026-09-21T02:00:00Z", "2026-09-21T02:30:00Z"]);
});

it("does not expand other event types' bookings", async () => {
  const { host, eventTypeId } = await seed();
  const now = "2026-09-01T00:00:00Z";
  await env.DB.prepare(
    `INSERT INTO bookings (user_id,event_type_id,guest_name,guest_email,start_at,end_at,timezone,status,created_at,updated_at)
     VALUES (?,?,'G','g@example.com','2026-09-21T01:00:00Z','2026-09-21T01:30:00Z','UTC','confirmed',?,?)`,
  )
    .bind(host.id, eventTypeId + 999, now, now)
    .run();

  const slots = await getSlotsForDate(env.DB, {
    ...BASE,
    hostId: host.id,
    eventTypeId,
    bufferMinutes: 15,
    dateYmd: "2026-09-21",
  });
  // Raw overlap only: 09:30 is bookable again.
  expect(slots.map((s) => s.startAt)).toEqual([
    "2026-09-21T01:30:00Z",
    "2026-09-21T02:00:00Z",
    "2026-09-21T02:30:00Z",
  ]);
});
```

(The seed helper creates Monday 09:00–11:00 Asia/Kuala_Lumpur rules and a 30-min event type; `BASE` already exists in that file. Existing `getSlotsForDate` calls in the file need `bufferMinutes: 0,` added — typecheck will enumerate them.)

In `test/integration/monthAvailability.test.ts` add (note: `seed()` there returns `{ host, eventTypeId }` — always bind the seed-derived id, never a literal, because AUTOINCREMENT sequences are not reset between tests):

```ts
it("respects the buffer for same-type bookings", async () => {
  const { host, eventTypeId } = await seed();
  const now = "2026-09-01T00:00:00Z";
  // Fully books Monday 09-14 (09:00-11:00 local): the day drops regardless.
  await env.DB.prepare(
    `INSERT INTO bookings (user_id,event_type_id,guest_name,guest_email,start_at,end_at,timezone,status,created_at,updated_at)
     VALUES (?,?,'G','g@example.com','2026-09-14T01:00:00Z','2026-09-14T03:00:00Z','UTC','confirmed',?,?)`,
  )
    .bind(host.id, eventTypeId, now, now)
    .run();
  // Books only 09:00-09:30 on Monday 09-21: with a 15-min buffer the 09:30
  // slot dies, but 10:00/10:30 stay free and the day remains bookable.
  await env.DB.prepare(
    `INSERT INTO bookings (user_id,event_type_id,guest_name,guest_email,start_at,end_at,timezone,status,created_at,updated_at)
     VALUES (?,?,'H','h@example.com','2026-09-21T01:00:00Z','2026-09-21T01:30:00Z','UTC','confirmed',?,?)`,
  )
    .bind(host.id, eventTypeId, now, now)
    .run();

  const days = await getMonthFreeDays(env.DB, {
    ...BASE,
    hostId: host.id,
    eventTypeId,
    bufferMinutes: 15,
    year: 2026,
    month: 9,
  });
  expect(days).toEqual(["2026-09-07", "2026-09-21", "2026-09-28"]);
});
```

Note for the existing tests in this file: `getMonthFreeDays` calls now require `eventTypeId` and `bufferMinutes` in `MonthQuery` — update every existing call in the file with `eventTypeId` (from seed) and `bufferMinutes: 0`. Typecheck will enumerate them.

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/integration/slots.service.test.ts test/integration/monthAvailability.test.ts`
Expected: FAIL — `bufferMinutes` not accepted / expansion missing.

- [ ] **Step 3: Implement in `src/services/availability.ts`**

- `SlotQuery` gains `bufferMinutes: number;`.
- `MonthQuery` gains `eventTypeId: number;` and `bufferMinutes: number;`.
- In `getDaySlots`, replace the busy mapping with:

```ts
const busy: Interval[] = busyRows.map((b) => ({
  startMs: Date.parse(b.start_at),
  endMs:
    Date.parse(b.end_at) +
    (b.event_type_id === q.eventTypeId ? q.bufferMinutes * 60_000 : 0),
}));
```

- In `getMonthFreeDays`, same mapping (it has `q.eventTypeId` and `q.bufferMinutes` now).

- [ ] **Step 4: `src/services/booking.ts`**

In `createBooking`, pass `bufferMinutes: eventType.buffer_minutes` into the `getDaySlots` call AND into `insertBookingIfFree`.

- [ ] **Step 5: Run the tests**

Run: `npx vitest run test/integration/slots.service.test.ts test/integration/monthAvailability.test.ts test/integration/booking.test.ts`
Expected: all pass.

- [ ] **Step 6: Typecheck + full suite + commit**

```bash
npm run typecheck && npm test
npx prettier --write src/services/availability.ts src/services/booking.ts test/integration/slots.service.test.ts test/integration/monthAvailability.test.ts
git add src/services/availability.ts src/services/booking.ts test/integration/slots.service.test.ts test/integration/monthAvailability.test.ts
git commit -m "feat(buffer): availability expands same-type bookings by the buffer"
```

---

### Task 3: Routes — API validation + page form wiring

**Files:**
- Modify: `src/routes/api.eventTypes.ts`, `src/routes/api.public.ts`, `src/routes/pages.ts`
- Test: `test/integration/eventTypes.test.ts`

- [ ] **Step 1: Write failing tests**

In `test/integration/eventTypes.test.ts` add:

```ts
it("accepts and stores a buffer, rejecting out-of-range values", async () => {
  const host = await createHost("wan");
  const created = await api("/api/event-types", {
    method: "POST",
    cookie: host.cookie,
    body: JSON.stringify({ name: "C", slug: "c", duration_minutes: 30, buffer_minutes: 15 }),
  });
  expect(created.status).toBe(201);
  const { eventType } = await created.json<{ eventType: { buffer_minutes: number } }>();
  expect(eventType.buffer_minutes).toBe(15);

  const bad = await api("/api/event-types", {
    method: "POST",
    cookie: host.cookie,
    body: JSON.stringify({ name: "D", slug: "d", duration_minutes: 30, buffer_minutes: 200 }),
  });
  expect(bad.status).toBe(400);
});

it("PATCH leaves the buffer unchanged when omitted", async () => {
  const host = await createHost("wan");
  const created = await api("/api/event-types", {
    method: "POST",
    cookie: host.cookie,
    body: JSON.stringify({ name: "C", slug: "c", duration_minutes: 30, buffer_minutes: 15 }),
  });
  const { eventType } = await created.json<{ eventType: { id: number } }>();
  const patched = await api(`/api/event-types/${eventType.id}`, {
    method: "PATCH",
    cookie: host.cookie,
    body: JSON.stringify({ name: "Renamed" }),
  });
  expect(patched.status).toBe(200);
  const { eventType: after } = await patched.json<{ eventType: { buffer_minutes: number } }>();
  expect(after.buffer_minutes).toBe(15);
});
```

- [ ] **Step 2: Run to verify they fail**

Run: `npx vitest run test/integration/eventTypes.test.ts`
Expected: FAIL — `buffer_minutes` rejected/ignored.

- [ ] **Step 3: `src/routes/api.eventTypes.ts`**

Create route: after durationMinutes parsing add:

```ts
const bufferMinutes =
  body.buffer_minutes === undefined
    ? 0
    : requireInt(body, "buffer_minutes", { min: 0, max: 120 });
```

Pass `bufferMinutes` into `insertEventType`.

PATCH route: in the `merged` object add:

```ts
bufferMinutes:
  body.buffer_minutes === undefined
    ? current.buffer_minutes
    : requireInt(body, "buffer_minutes", { min: 0, max: 120 }),
```

- [ ] **Step 4: `src/routes/api.public.ts`**

Slots route: add `bufferMinutes: eventType.buffer_minutes,` to the `getSlotsForDate` call. Month route: add `eventTypeId: eventType.id,` and `bufferMinutes: eventType.buffer_minutes,` to the `getMonthFreeDays` call.

- [ ] **Step 5: `src/routes/pages.ts`**

- Legacy create POST: `const bufferMinutes = Number(form.buffer_minutes);` then use `Number.isInteger(bufferMinutes) && bufferMinutes >= 0 && bufferMinutes <= 120 ? bufferMinutes : 0` and pass into `insertEventType`.
- Edit POST: parse `bufferMinutes` like duration; add to `draft`; validation message `"Buffer must be between 0 and 120 minutes."` when out of range; pass into `updateEventType`.
- Toggle + delete-deactivate + clone: pass `current.buffer_minutes` (typecheck will confirm each call site).

- [ ] **Step 6: Run tests + commit**

```bash
npx vitest run test/integration/eventTypes.test.ts && npm run typecheck && npm test
npx prettier --write src/routes/api.eventTypes.ts src/routes/api.public.ts src/routes/pages.ts test/integration/eventTypes.test.ts
git add src/routes/api.eventTypes.ts src/routes/api.public.ts src/routes/pages.ts test/integration/eventTypes.test.ts
git commit -m "feat(buffer): API validation and page route wiring"
```

---

### Task 4: UI — create modal + edit page

**Files:**
- Modify: `src/views/dashboard.ts`
- Test: `test/integration/pages.test.ts`

- [ ] **Step 1: Create modal**

In the modal form, right after the Duration fieldset, add:

```html
<div class="ui-fieldset">
  <label class="ui-label" for="et_buffer">Buffer after meeting</label>
  <input class="ui-input font-mono" id="et_buffer" type="number" x-model="buffer"
         min="0" max="120" step="5">
  <p class="ui-hint">Minutes of breathing room after each booking. 0 = back-to-back.</p>
</div>
```

In `createEventTypeForm()` state add `buffer: 0,` and in the submit payload add `buffer_minutes: Number(this.buffer),`.

- [ ] **Step 2: Edit page**

After the Duration field, add:

```ts
${field({
  name: "buffer_minutes",
  label: "Buffer after meeting",
  type: "number",
  value: String(eventType.buffer_minutes),
  hint: "Minutes of breathing room after each booking.",
  attrsHtml: 'min="0" max="120" step="5"',
})}
```

- [ ] **Step 3: Page test**

In `test/integration/pages.test.ts`, in "preserves typed values when an edit fails validation", add assertions:

```ts
expect(html).toContain('name="buffer_minutes"');
```

And in the create-modal assertions of "renders open/copy actions on event type cards", add:

```ts
expect(html).toContain("Buffer after meeting");
```

- [ ] **Step 4: Verify + commit**

```bash
npx prettier --write src/views/dashboard.ts test/integration/pages.test.ts
npm run format:check && npm run typecheck && npm test
git add src/views/dashboard.ts test/integration/pages.test.ts
git commit -m "feat(buffer): buffer field in create modal and edit page"
```

---

### Task 5: Migrate production + deploy + verify

- [ ] **Step 1: Apply migration remotely**

Run: `npx wrangler d1 migrations apply meetflow-db --remote`
Expected: `0006_buffer_minutes.sql ✅`.

- [ ] **Step 2: Deploy**

Run: `npm run deploy`
Expected: uploads worker + assets cleanly.

- [ ] **Step 3: Smoke-check live**

Run: `curl -s https://meetflow.wmafendi.workers.dev/api/public/wmafendi/30m-meeting/month?year=2026&month=10`
Expected: `{"days":[...]}` (unchanged shape).

- [ ] **Step 4: Commit leftovers if any**

```bash
git status --short
```