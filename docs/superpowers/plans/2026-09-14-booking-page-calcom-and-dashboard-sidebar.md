# Booking Page (cal.com style) + Dashboard Sidebar — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the public booking page as a cal.com-style three-panel layout (user info + month calendar + time list) and move the host dashboard navigation from a top bar to a left sidebar with icons.

**Architecture:** Server-rendered HTML from Hono views (no framework). A new `GET /api/public/:username/:eventSlug/month` endpoint returns bookable days for a month using 2 D1 queries (existing `listRules` + `listConfirmedBetween`) with per-day slot math in JS. The booking page widget (Alpine.js) manages month navigation, day selection, timezone display, and a 12h/24h toggle. The dashboard shell in `layout.ts` becomes a flex sidebar layout with a mobile drawer.

**Tech Stack:** TypeScript, Hono (Cloudflare Worker), D1, Tailwind CSS v4, Alpine.js, Vitest (`cloudflare:test`).

**Spec:** `docs/superpowers/specs/2026-09-14-booking-page-calcom-and-dashboard-sidebar-design.md`

---

## File map

| File | Change |
|---|---|
| `src/views/escape.ts` | **Create** — `escapeHtml` extracted from `layout.ts` |
| `src/views/layout.ts` | Modify — re-export `escapeHtml`, replace `hostNav()` with sidebar shell |
| `src/views/ui.ts` | Modify — import from `./escape`, add `chevronLeft`, `grid`, `menu` icons |
| `src/services/availability.ts` | Modify — add `getMonthFreeDays` |
| `src/routes/api.public.ts` | Modify — add `GET .../month` |
| `src/views/publicBooking.ts` | Modify — rewrite `bookingPage()` + widget script |
| `src/views/dashboard.ts` | Modify — pass `hostAvatarKey` at 6 `layout()` call sites |
| `src/styles/app.css` | Modify — calendar, segmented control, sidebar, `[x-cloak]` styles |
| `test/integration/monthAvailability.test.ts` | **Create** — service + route tests |
| `test/integration/pages.test.ts` | Modify — sidebar + calendar smoke assertions |

---

### Task 1: Extract `escapeHtml` + add new icons

`layout.ts` will import `avatar`/`icon` from `ui.ts` for the sidebar (Task 6). `ui.ts` currently imports `escapeHtml` from `layout.ts`, so importing `ui.ts` back would create a cycle. Break it by moving `escapeHtml` to its own module.

**Files:**
- Create: `src/views/escape.ts`
- Modify: `src/views/layout.ts:1-8`
- Modify: `src/views/ui.ts:1`
- Modify: `src/views/ui.ts:15-36` (ICON_PATHS)

- [ ] **Step 1: Create `src/views/escape.ts`**

```ts
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
```

- [ ] **Step 2: Replace the local function in `src/views/layout.ts` with a re-export**

Replace lines 1-8:

```ts
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}
```

with:

```ts
export { escapeHtml } from "./escape";
```

(`publicBooking.ts`, `dashboard.ts` and `auth.ts` import `escapeHtml` from `./layout` — the re-export keeps them working.)

- [ ] **Step 3: Point `src/views/ui.ts` at the new module**

Change line 1 from:

```ts
import { escapeHtml } from "./layout";
```

to:

```ts
import { escapeHtml } from "./escape";
```

- [ ] **Step 4: Add the three icons to `ICON_PATHS` in `src/views/ui.ts`**

Inside the `ICON_PATHS` object, after the `chevronRight` entry (`line 34`):

```ts
  chevronRight: '<path d="m9 6 6 6-6 6"/>',
  chevronLeft: '<path d="m15 6-6 6 6 6"/>',
  grid:
    '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
  menu: '<path d="M4 6h16M4 12h16M4 18h16"/>',
  logOut: '<path d="M9 21H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3h3"/><path d="m16 17 5-5-5-5M21 12H9"/>',
```

- [ ] **Step 5: Verify nothing broke**

Run: `npm run typecheck && npm test`
Expected: all pass.

- [ ] **Step 6: Commit**

```bash
git add src/views/escape.ts src/views/layout.ts src/views/ui.ts
git commit -m "refactor(views): extract escapeHtml and add calendar/sidebar icons"
```

---

### Task 2: `getMonthFreeDays` service (TDD)

**Files:**
- Create: `test/integration/monthAvailability.test.ts`
- Modify: `src/services/availability.ts`

- [ ] **Step 1: Write the failing test — `test/integration/monthAvailability.test.ts`**

```ts
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { getMonthFreeDays } from "../../src/services/availability";
import { api, createHost, resetDb } from "../helpers";

const BASE = {
  hostTimezone: "Asia/Kuala_Lumpur",
  durationMinutes: 30,
  nowMs: Date.parse("2026-09-01T00:00:00Z"),
};

async function seed() {
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
  return host;
}

describe("getMonthFreeDays", () => {
  beforeEach(resetDb);

  it("returns every Monday in a month with Monday rules", async () => {
    const host = await seed();
    // Mondays in September 2026 (Sep 1 is a Tuesday): 7, 14, 21, 28.
    const days = await getMonthFreeDays(env.DB, {
      ...BASE,
      hostId: host.id,
      year: 2026,
      month: 9,
    });
    expect(days).toEqual(["2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28"]);
  });

  it("returns nothing for a month fully in the past", async () => {
    const host = await seed();
    const days = await getMonthFreeDays(env.DB, {
      ...BASE,
      hostId: host.id,
      year: 2026,
      month: 8,
    });
    expect(days).toEqual([]);
  });

  it("drops past days of the current month", async () => {
    const host = await seed();
    const days = await getMonthFreeDays(env.DB, {
      ...BASE,
      hostId: host.id,
      year: 2026,
      month: 9,
      nowMs: Date.parse("2026-09-10T00:00:00Z"),
    });
    expect(days).toEqual(["2026-09-14", "2026-09-21", "2026-09-28"]);
  });

  it("excludes a day fully taken by a confirmed booking", async () => {
    const host = await seed();
    const now = "2026-09-01T00:00:00Z";
    await env.DB.prepare(
      `INSERT INTO bookings (user_id,event_type_id,guest_name,guest_email,start_at,end_at,timezone,status,created_at,updated_at)
       VALUES (?,?,'G','g@example.com','2026-09-14T01:00:00Z','2026-09-14T03:00:00Z','UTC','confirmed',?,?)`,
    )
      .bind(host.id, 1, now, now)
      .run();

    const days = await getMonthFreeDays(env.DB, {
      ...BASE,
      hostId: host.id,
      year: 2026,
      month: 9,
    });
    expect(days).toEqual(["2026-09-07", "2026-09-21", "2026-09-28"]);
  });

  it("returns nothing when the host has no rules", async () => {
    const host = await createHost("norrules", "Asia/Kuala_Lumpur");
    const days = await getMonthFreeDays(env.DB, {
      ...BASE,
      hostId: host.id,
      year: 2026,
      month: 9,
    });
    expect(days).toEqual([]);
  });

  it("handles leap February (29 days)", async () => {
    const host = await createHost("leap", "Asia/Kuala_Lumpur");
    await api("/api/availability", {
      method: "PUT",
      cookie: host.cookie,
      body: JSON.stringify({
        rules: [0, 1, 2, 3, 4, 5, 6].map((dow) => ({
          day_of_week: dow,
          start_time: "09:00",
          end_time: "09:30",
        })),
      }),
    });
    const days = await getMonthFreeDays(env.DB, {
      ...BASE,
      hostId: host.id,
      year: 2028,
      month: 2,
    });
    expect(days).toHaveLength(29);
    expect(days[0]).toBe("2028-02-01");
    expect(days[28]).toBe("2028-02-29");
  });
});
```

Note: the fully-booked-day test inserts a booking with `event_type_id = 1`; `listConfirmedBetween` filters by `user_id` only, so any existing event id works after the seed created one.

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/integration/monthAvailability.test.ts`
Expected: FAIL — `getMonthFreeDays` is not exported.

- [ ] **Step 3: Implement `getMonthFreeDays` in `src/services/availability.ts`**

Add these imports to the existing imports at the top:

```ts
import { listRules } from "../db/availability";
```

(The file already imports `listRulesForDay` from there — extend that import line.)

Add after the `SlotQuery` interface (before `export interface Slot`):

```ts
export interface MonthQuery {
  hostId: number;
  hostTimezone: string;
  durationMinutes: number;
  /** 1-12 */
  month: number;
  year: number;
  nowMs: number;
}
```

Append at the end of the file:

```ts
const pad2 = (n: number) => String(n).padStart(2, "0");

/**
 * Host-local dates in one calendar month that have at least one free slot.
 * Two D1 queries: all active rules, then confirmed bookings overlapping the
 * month's candidate range. Everything else is plain JS.
 */
export async function getMonthFreeDays(db: D1Database, q: MonthQuery): Promise<string[]> {
  const daysInMonth = new Date(Date.UTC(q.year, q.month, 0)).getUTCDate();
  const lastDayYmd = `${q.year}-${pad2(q.month)}-${pad2(daysInMonth)}`;
  const todayYmd = zonedDateString(new Date(q.nowMs), q.hostTimezone);
  if (lastDayYmd < todayYmd) return [];

  const rules = await listRules(db, q.hostId);
  if (rules.length === 0) return [];

  const windowsByDow = new Map<number, MinuteWindow[]>();
  for (const r of rules) {
    const list = windowsByDow.get(r.day_of_week) ?? [];
    list.push({ start: toMinutes(r.start_time), end: toMinutes(r.end_time) });
    windowsByDow.set(r.day_of_week, list);
  }

  const byDate = new Map<string, Interval[]>();
  let minMs = Infinity;
  let maxMs = -Infinity;
  for (let day = 1; day <= daysInMonth; day++) {
    const ymd = `${q.year}-${pad2(q.month)}-${pad2(day)}`;
    const windows = windowsByDow.get(dayOfWeek(ymd));
    if (!windows || windows.length === 0) continue;
    const starts = generateSlotStarts(windows, q.durationMinutes);
    if (starts.length === 0) continue;
    const slots: Interval[] = starts.map((minutes) => {
      const start = zonedToUtc(ymd, toHhmm(minutes), q.hostTimezone);
      return { startMs: start.getTime(), endMs: start.getTime() + q.durationMinutes * 60_000 };
    });
    minMs = Math.min(minMs, slots[0]!.startMs);
    maxMs = Math.max(maxMs, slots[slots.length - 1]!.endMs);
    byDate.set(ymd, slots);
  }
  if (byDate.size === 0) return [];

  const busyRows = await listConfirmedBetween(
    db,
    q.hostId,
    isoUtc(new Date(minMs)),
    isoUtc(new Date(maxMs)),
  );
  const busy: Interval[] = busyRows.map((b) => ({
    startMs: Date.parse(b.start_at),
    endMs: Date.parse(b.end_at),
  }));

  const freeDays: string[] = [];
  for (const [ymd, slots] of byDate) {
    if (ymd < todayYmd) continue;
    if (removeBusy(removePast(slots, q.nowMs), busy).length > 0) freeDays.push(ymd);
  }
  return freeDays;
}
```

Verify these names are already imported in `availability.ts`: `listRulesForDay`, `listConfirmedBetween`, `generateSlotStarts`, `removeBusy`, `removePast`, `toHhmm`, `toMinutes`, `Interval`, `isoUtc`, `addMinutes`, `dayOfWeek`, `zonedToUtc` — plus new ones `listRules`, `zonedDateString`, `MinuteWindow`. `MinuteWindow` is imported from `../lib/slots` (it is exported there); `zonedDateString` from `../lib/timezone`. Extend those import lines.

- [ ] **Step 4: Run the tests to verify they pass**

Run: `npx vitest run test/integration/monthAvailability.test.ts`
Expected: all 6 pass.

- [ ] **Step 5: Commit**

```bash
git add src/services/availability.ts test/integration/monthAvailability.test.ts
git commit -m "feat(availability): getMonthFreeDays with two D1 queries"
```

---

### Task 3: `GET /api/public/:username/:eventSlug/month` route (TDD)

**Files:**
- Modify: `src/routes/api.public.ts:34-61` (add below the existing slots route)
- Modify: `test/integration/monthAvailability.test.ts`

- [ ] **Step 1: Write the failing route tests — append to `test/integration/monthAvailability.test.ts`**

Add this import at the top (if not present):

```ts
import { SELF } from "cloudflare:test";
```

Append a second describe block:

```ts
describe("GET /api/public/:username/:eventSlug/month", () => {
  beforeEach(resetDb);

  it("returns bookable days for the requested month", async () => {
    const host = await seed();
    const res = await SELF.fetch(
      "https://example.com/api/public/wan/consultation/month?year=2026&month=9",
    );
    expect(res.status).toBe(200);
    const { days } = await res.json<{ days: string[] }>();
    expect(days).toEqual(["2026-09-07", "2026-09-14", "2026-09-21", "2026-09-28"]);
  });

  it("rejects an out-of-range month", async () => {
    const host = await seed();
    const res = await SELF.fetch(
      "https://example.com/api/public/wan/consultation/month?year=2026&month=13",
    );
    expect(res.status).toBe(400);
  });

  it("rejects a non-numeric year", async () => {
    const host = await seed();
    const res = await SELF.fetch(
      "https://example.com/api/public/wan/consultation/month?year=abc&month=9",
    );
    expect(res.status).toBe(400);
  });

  it("404s for an unknown event", async () => {
    const host = await seed();
    const res = await SELF.fetch(
      "https://example.com/api/public/wan/nope/month?year=2026&month=9",
    );
    expect(res.status).toBe(404);
  });
});
```

- [ ] **Step 2: Run to verify it fails**

Run: `npx vitest run test/integration/monthAvailability.test.ts -t "month"`
Expected: FAIL — 404/not found (route does not exist yet).

- [ ] **Step 3: Add the route in `src/routes/api.public.ts`**

Extend the existing import from the availability service:

```ts
import { getMonthFreeDays, getSlotsForDate } from "../services/availability";
```

Insert after the existing `slots` route (after line 61):

```ts
publicRoutes.get("/:username/:eventSlug/month", async (c) => {
  const year = Number(c.req.query("year"));
  const month = Number(c.req.query("month"));
  if (!Number.isInteger(year) || year < 2000 || year > 2100) {
    return c.json({ error: "year must be a 4-digit year" }, 400);
  }
  if (!Number.isInteger(month) || month < 1 || month > 12) {
    return c.json({ error: "month must be 1-12" }, 400);
  }

  try {
    const { host, eventType } = await resolvePublicTarget(
      c.env.DB,
      c.req.param("username"),
      c.req.param("eventSlug"),
    );
    const days = await getMonthFreeDays(c.env.DB, {
      hostId: host.id,
      hostTimezone: host.timezone,
      durationMinutes: eventType.duration_minutes,
      year,
      month,
      nowMs: Date.now(),
    });
    return c.json({ days });
  } catch (err) {
    if (err instanceof BookingError) return c.json({ error: err.message }, err.status);
    throw err;
  }
});
```

- [ ] **Step 4: Run the route tests**

Run: `npx vitest run test/integration/monthAvailability.test.ts`
Expected: all pass (6 service + 4 route).

- [ ] **Step 5: Commit**

```bash
git add src/routes/api.public.ts test/integration/monthAvailability.test.ts
git commit -m "feat(api): month availability endpoint for the booking calendar"
```

---

### Task 4: Rewrite the booking page (three-panel + calendar widget)

**Files:**
- Modify: `src/views/publicBooking.ts:81-294` (replace `bookingPage()` entirely)

- [ ] **Step 1: Add the timezone-select imports**

At the top of `src/views/publicBooking.ts`, add:

```ts
import { TIMEZONE_SCRIPT } from "./timezoneSelect";
```

- [ ] **Step 2: Replace `bookingPage()` with the new implementation**

Replace the whole `bookingPage` function (lines 81-294) with:

```ts
export function bookingPage(host: PublicUser, eventType: EventTypeRow): string {
  const data = {
    hostSlug: host.slug,
    hostName: host.name,
    hostTimezone: host.timezone,
    eventSlug: eventType.slug,
    eventName: eventType.name,
    durationMinutes: eventType.duration_minutes,
  };

  const WEEKDAY_HEAD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    .map((d) => `<span class="py-1 text-center text-[0.75rem] font-medium text-muted">${d}</span>`)
    .join("");

  return layout({
    title: eventType.name,
    nav: "public",
    width: "lg",
    data,
    body: `
      <div class="mx-auto max-w-5xl ui-rise" x-data="bookingWidget()" x-init="init()">
        <div class="ui-card overflow-hidden shadow-sm">
          <div class="grid lg:grid-cols-[17rem_minmax(0,1fr)_15rem]">

            <!-- Host + event summary -->
            <aside class="border-b border-line p-5 sm:p-6 lg:border-b-0 lg:border-r">
              <a href="/${escapeHtml(host.slug)}" class="group flex items-center gap-2.5">
                ${avatar(host.name, host.avatar_key, "size-10", "text-sm")}
                <span class="min-w-0">
                  <span class="block truncate text-sm font-medium text-ink group-hover:underline">
                    ${escapeHtml(host.name)}
                  </span>
                  <span class="block text-[0.75rem] text-muted">View public page</span>
                </span>
              </a>

              <h1 class="mt-4 text-lg font-semibold tracking-[-0.02em] text-ink">${escapeHtml(
                eventType.name,
              )}</h1>

              <div class="mt-3">
                <span class="ui-badge ui-badge-neutral">
                  <span class="ui-time">${eventType.duration_minutes}m</span>
                </span>
              </div>

              <div class="mt-3.5">
                <label class="ui-label" for="guest-timezone">Timezone</label>
                <select class="ui-select" id="guest-timezone" x-model="guestTimezone"
                        data-timezone data-timezone-autodetect></select>
              </div>

              <template x-if="selected">
                <div class="mt-4 border-t border-line pt-4">
                  <p class="flex items-center gap-2 text-[0.8125rem] text-ink">
                    ${icon("calendar", "size-4 shrink-0")}
                    <span class="ui-time font-medium" x-text="summary()"></span>
                  </p>
                </div>
              </template>

              ${
                eventType.description
                  ? `<p class="mt-4 border-t border-line pt-4 text-[0.8125rem] leading-relaxed text-muted">${escapeHtml(
                      eventType.description,
                    )}</p>`
                  : ""
              }
            </aside>

            <!-- Step 1a: month calendar -->
            <section class="border-b border-line p-5 sm:p-6 lg:border-b-0" x-show="step === 'slot'">
              <div class="mb-3 flex items-center justify-between">
                <p class="text-sm font-semibold text-ink">
                  <span x-text="monthName()"></span>&nbsp;<span x-text="viewYear"></span>
                </p>
                <div class="flex items-center gap-1">
                  <button type="button" class="ui-btn ui-btn-ghost ui-btn-sm px-2"
                          :disabled="atEarliestMonth()" @click="prevMonth()"
                          aria-label="Previous month">
                    ${icon("chevronLeft", "size-4")}
                  </button>
                  <button type="button" class="ui-btn ui-btn-ghost ui-btn-sm px-2"
                          @click="nextMonth()" aria-label="Next month">
                    ${icon("chevronRight", "size-4")}
                  </button>
                </div>
              </div>

              <div class="mb-1 grid grid-cols-7">${WEEKDAY_HEAD}</div>

              <div class="grid grid-cols-7 gap-1">
                <template x-for="cell in cells()" :key="cell.key">
                  <div class="aspect-square">
                    <button type="button" class="ui-day"
                            x-show="!cell.blank"
                            :class="{
                              'ui-day-selected': cell.selected,
                              'ui-day-today': cell.today,
                            }"
                            :disabled="!cell.enabled"
                            @click="pickDay(cell.date)">
                      <span x-text="cell.label"></span>
                    </button>
                    <div x-show="cell.blank" x-cloak></div>
                  </div>
                </template>
              </div>
            </section>

            <!-- Step 1b: guest details -->
            <section class="border-b border-line p-5 sm:p-6 lg:border-b-0" x-show="step === 'form'" x-cloak>
              <button type="button" @click="step = 'slot'"
                      class="ui-btn ui-btn-ghost ui-btn-sm -ml-2 mb-4">
                ${icon("arrowLeft", "size-4")}<span>Change time</span>
              </button>

              <template x-if="error">
                <div class="ui-alert ui-alert-danger mb-4" role="alert">
                  ${icon("alert", "size-4 shrink-0 mt-px")}<span x-text="error"></span>
                </div>
              </template>

              <form class="space-y-4" @submit.prevent="submit()">
                <div class="ui-fieldset">
                  <label class="ui-label" for="guest_name">Your name</label>
                  <input class="ui-input" id="guest_name" x-model="guestName" required>
                </div>
                <div class="ui-fieldset">
                  <label class="ui-label" for="guest_email">Email</label>
                  <input class="ui-input" id="guest_email" type="email" x-model="guestEmail" required>
                  <p class="ui-hint">Where the confirmation would be sent.</p>
                </div>
                <div class="ui-fieldset">
                  <label class="ui-label" for="notes">Notes <span class="font-normal text-muted">(optional)</span></label>
                  <textarea class="ui-input resize-y" id="notes" rows="3" x-model="notes"
                            placeholder="Anything useful to know beforehand?"></textarea>
                </div>
                <button class="ui-btn ui-btn-primary ui-btn-lg" type="submit" :disabled="submitting">
                  <span x-text="submitting ? 'Booking…' : 'Confirm booking'"></span>
                </button>
              </form>
            </section>

            <!-- Step 2a: time list -->
            <section class="p-5 sm:p-6" x-show="step === 'slot'" x-ref="times">
              <div x-show="!selectedDate">
                <p class="text-sm font-semibold text-ink">Select a date</p>
                <p class="mt-1 text-[0.8125rem] text-muted">
                  Pick a day on the calendar to see available times.
                </p>
              </div>

              <div x-show="selectedDate">
                <div class="mb-3 flex items-center justify-between gap-2">
                  <p class="text-sm font-semibold text-ink" x-text="selectedDayLabel()"></p>
                  <div class="ui-seg" role="group" aria-label="Time format">
                    <button type="button" :class="hour12 ? 'ui-seg-active' : ''"
                            @click="hour12 = true">12h</button>
                    <button type="button" :class="!hour12 ? 'ui-seg-active' : ''"
                            @click="hour12 = false">24h</button>
                  </div>
                </div>

                <div class="space-y-2" x-show="loading" x-cloak>
                  <template x-for="n in 5" :key="n">
                    <div class="h-[42px] animate-pulse rounded-md border border-line bg-subtle"></div>
                  </template>
                </div>

                <div class="max-h-[19rem] space-y-2 overflow-y-auto pr-1"
                     x-show="!loading && slots.length">
                  <template x-for="slot in slots" :key="slot.startAt">
                    <button type="button" class="ui-slot w-full" @click="choose(slot)"
                            x-text="label(slot.startAt)"></button>
                  </template>
                </div>

                <div x-show="!loading && slots.length === 0" x-cloak
                     class="rounded-lg border border-dashed border-line-strong px-4 py-8 text-center">
                  <p class="text-sm font-medium text-ink">No times on this date</p>
                  <p class="mt-1 text-[0.8125rem] text-muted">Try another day.</p>
                </div>
              </div>
            </section>

            <!-- Step 2b: chosen time summary -->
            <section class="p-5 sm:p-6" x-show="step === 'form'" x-cloak>
              <template x-if="selected">
                <div>
                  <p class="ui-eyebrow">Your booking</p>
                  <p class="ui-time mt-2 text-base font-semibold text-ink" x-text="summary()"></p>
                  <p class="mt-1 text-[0.8125rem] text-muted" x-text="timezoneLabel"></p>
                </div>
              </template>
            </section>

          </div>
        </div>

        <p class="mt-4 text-center text-[0.75rem] text-muted">
          Powered by <span class="font-medium text-body">MeetFlow</span>
        </p>
      </div>

      <script>
        function bookingWidget() {
          var cfg = JSON.parse(document.getElementById('page-data').textContent);
          var now = new Date();
          var pad2 = function (n) { return String(n).padStart(2, '0'); };
          var todayYmd = now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate());
          var hour12Default = (function () {
            var opt = Intl.DateTimeFormat().resolvedOptions().hour12;
            return opt === undefined ? true : opt;
          })();

          return {
            ...cfg,
            guestTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            hour12: hour12Default,
            today: todayYmd,
            todayYear: now.getFullYear(),
            todayMonth: now.getMonth(),
            viewYear: now.getFullYear(),
            viewMonth: now.getMonth(),
            days: [],
            selectedDate: null,
            slots: [],
            loading: false,
            step: 'slot',
            selected: null,
            guestName: '',
            guestEmail: '',
            notes: '',
            error: '',
            submitting: false,

            get timezoneLabel() {
              var zone = this.guestTimezone;
              var city = zone.split('/').pop().replace(/_/g, ' ');
              var mins = -new Date().getTimezoneOffset();
              if (mins === 0) return city + ' (GMT)';
              var sign = mins < 0 ? '-' : '+';
              var abs = Math.abs(mins);
              var rest = abs % 60;
              return city + ' (GMT' + sign + Math.floor(abs / 60) +
                (rest ? ':' + String(rest).padStart(2, '0') : '') + ')';
            },

            init() { this.loadMonth(); },

            monthName() {
              var names = ['January', 'February', 'March', 'April', 'May', 'June',
                           'July', 'August', 'September', 'October', 'November', 'December'];
              return names[this.viewMonth];
            },

            atEarliestMonth() {
              return this.viewYear === this.todayYear && this.viewMonth === this.todayMonth;
            },

            async loadMonth() {
              this.days = [];
              var url = '/api/public/' + this.hostSlug + '/' + this.eventSlug +
                '/month?year=' + this.viewYear + '&month=' + (this.viewMonth + 1);
              try {
                var res = await fetch(url);
                if (res.ok) this.days = (await res.json()).days;
              } catch (e) {}
            },

            prevMonth() {
              if (this.atEarliestMonth()) return;
              this.selectedDate = null;
              this.slots = [];
              if (this.viewMonth === 0) { this.viewMonth = 11; this.viewYear -= 1; }
              else this.viewMonth -= 1;
              this.loadMonth();
            },

            nextMonth() {
              this.selectedDate = null;
              this.slots = [];
              if (this.viewMonth === 11) { this.viewMonth = 0; this.viewYear += 1; }
              else this.viewMonth += 1;
              this.loadMonth();
            },

            cells() {
              var firstDow = new Date(Date.UTC(this.viewYear, this.viewMonth, 1)).getUTCDay();
              var count = new Date(Date.UTC(this.viewYear, this.viewMonth + 1, 0)).getUTCDate();
              var out = [];
              for (var i = 0; i < 42; i++) {
                var d = i - firstDow + 1;
                if (d < 1 || d > count) { out.push({ blank: true, key: 'b' + i }); continue; }
                var date = this.viewYear + '-' + pad2(this.viewMonth + 1) + '-' + pad2(d);
                out.push({
                  blank: false,
                  key: date,
                  date: date,
                  label: d,
                  enabled: date >= this.today && this.days.indexOf(date) !== -1,
                  selected: date === this.selectedDate,
                  today: date === this.today,
                });
              }
              return out;
            },

            async pickDay(date) {
              this.selectedDate = date;
              this.error = '';
              this.loading = true;
              this.slots = [];
              var url = '/api/public/' + this.hostSlug + '/' + this.eventSlug + '/slots?date=' + date;
              try {
                var res = await fetch(url);
                if (res.ok) this.slots = (await res.json()).slots;
              } finally {
                this.loading = false;
                var self = this;
                this.$nextTick(function () {
                  if (window.matchMedia('(max-width: 63.9rem)').matches) {
                    var el = self.$refs.times;
                    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                  }
                });
              }
            },

            label(startAt) {
              // 'en-US' keeps the suffix deterministic ("10:00 AM"), which the
              // replace below turns into cal.com's compact "10:00am".
              return new Date(startAt).toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: this.hour12,
                timeZone: this.guestTimezone,
              }).replace(/\\s?[AP]M/, function (m) { return m.trim().toLowerCase(); });
            },

            selectedDayLabel() {
              if (!this.selectedDate) return '';
              var d = new Date(this.selectedDate + 'T12:00:00Z');
              var weekday = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: this.guestTimezone });
              var dayNum = Number(this.selectedDate.slice(8, 10));
              var s = ['th', 'st', 'nd', 'rd'];
              var v = dayNum % 100;
              var suffix = s[(v - 20) % 10] || s[v] || s[0];
              return weekday + ' ' + dayNum + suffix;
            },

            summary() {
              if (!this.selected) return '';
              return new Date(this.selected.startAt).toLocaleString('en-US', {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
                hour12: this.hour12,
                timeZone: this.guestTimezone,
              });
            },

            choose(slot) {
              this.selected = slot;
              this.error = '';
              this.step = 'form';
            },

            async submit() {
              this.submitting = true;
              this.error = '';
              var res = await fetch('/api/public/' + this.hostSlug + '/' + this.eventSlug + '/book', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  start_at: this.selected.startAt,
                  guest_name: this.guestName,
                  guest_email: this.guestEmail,
                  notes: this.notes,
                  timezone: this.guestTimezone,
                }),
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
          };
        }
      </script>
      ${TIMEZONE_SCRIPT}`,
  });
}
```

- [ ] **Step 3: Typecheck**

Run: `npm run typecheck`
Expected: clean (the widget script is a raw string; `this` inside object methods is inferred as the object literal).

Note: inside the TS template literal the widget uses `var`/`function` syntax deliberately (browser target, matches the old script) and the regex `/\\s?[AP]M/` must stay written as `\\s` in the source so the emitted JS contains `\s`.

- [ ] **Step 4: Run the existing page test (smoke)**

Run: `npx vitest run test/integration/pages.test.ts`
Expected: "renders a public booking page" passes ("Confirm booking" and `id="page-data"` are still present).

- [ ] **Step 5: Commit**

```bash
git add src/views/publicBooking.ts
git commit -m "feat(booking): cal.com-style three-panel booking page with month calendar"
```

---

### Task 5: Calendar, segmented control and sidebar-link CSS

**Files:**
- Modify: `src/styles/app.css`

- [ ] **Step 1: Add global `[x-cloak]` to the base layer**

In `@layer base { ... }`, after the `::selection` rule (which is followed by the button cursor rule), add:

```css
  [x-cloak] {
    display: none !important;
  }
```

- [ ] **Step 2: Add component styles before the closing `}` of `@layer components`**

Insert before the `/* --- Slot picker --- */` block (keep slot picker as is):

```css
  /* --- Calendar (public booking) -------------------------------------- */
  .ui-day {
    @apply flex h-full w-full items-center justify-center rounded-md text-sm font-medium
           text-ink transition-colors duration-100 hover:bg-subtle
           focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/45;
  }

  .ui-day:disabled {
    @apply pointer-events-none text-muted/40;
  }

  .ui-day-selected {
    @apply bg-primary text-on-primary hover:bg-primary-hover;
  }

  .ui-day-today {
    @apply ring-1 ring-inset ring-ink/50;
  }

  /* --- Segmented control ----------------------------------------------- */
  .ui-seg {
    @apply inline-flex shrink-0 items-center rounded-md border border-line bg-subtle p-0.5;
  }

  .ui-seg > button {
    @apply rounded-[0.3125rem] px-2.5 py-1 text-[0.75rem] font-medium text-muted
           transition-colors duration-100 hover:text-ink;
  }

  .ui-seg > button.ui-seg-active {
    @apply bg-surface text-ink shadow-xs;
  }

  /* --- Sidebar navigation ---------------------------------------------- */
  .ui-side-link {
    @apply flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-muted
           transition-colors duration-100 hover:bg-subtle hover:text-ink;
  }

  .ui-side-link-active {
    @apply bg-subtle text-ink;
  }

  /* --- App shell (host dashboard) -------------------------------------- */
  .app-sidebar {
    @apply fixed inset-y-0 left-0 z-50 flex w-64 flex-col border-r border-line bg-surface
           transition-transform duration-200 ease-out lg:sticky lg:top-0 lg:z-auto lg:h-screen;
    transform: translateX(-100%);
  }

  @media (width >= 64rem) {
    .app-sidebar {
      transform: none;
    }
  }

  .app-sidebar.drawer-open {
    transform: translateX(0);
  }
```

- [ ] **Step 3: Rebuild the CSS**

Run: `npm run css`
Expected: "Done" with no warnings/errors.

- [ ] **Step 4: Commit**

```bash
git add src/styles/app.css
git commit -m "style: calendar, segmented toggle and sidebar styles"
```

---

### Task 6: Sidebar shell in `layout.ts`

**Files:**
- Modify: `src/views/layout.ts` (replace `hostNav()`, add `hostLayout()`, extend `LayoutOptions`)
- Modify: `src/views/dashboard.ts` (6 call sites — add `hostAvatarKey`)

- [ ] **Step 1: Add the imports and nav config to `src/views/layout.ts`**

At the top, after the `escapeHtml` re-export line, add:

```ts
import { avatar, icon } from "./ui";
```

Replace the `HOST_NAV` const (currently around line 89) with:

```ts
const HOST_NAV = [
  { href: "/dashboard", label: "Dashboard", icon: "grid" },
  { href: "/dashboard/event-types", label: "Event Types", icon: "layers" },
  { href: "/dashboard/availability", label: "Availability", icon: "clock" },
  { href: "/dashboard/bookings", label: "Bookings", icon: "calendar" },
  { href: "/dashboard/settings", label: "Settings", icon: "settings" },
] as const;
```

- [ ] **Step 2: Extend `LayoutOptions` with `hostAvatarKey`**

In the `LayoutOptions` interface, after `hostName?: string;` add:

```ts
  /** R2 object key for the host's avatar, shown in the sidebar. */
  hostAvatarKey?: string | null;
```

- [ ] **Step 3: Replace `hostNav()` with `hostLayout()`**

Delete the whole `hostNav` function (currently lines 114-145) and add:

```ts
function hostLayout(options: LayoutOptions, dataScript: string): string {
  const links = HOST_NAV.map((item) => {
    const active = options.activeNav === item.href;
    return `<a href="${item.href}" @click="drawer = false"
        class="ui-side-link ${active ? "ui-side-link-active" : ""}"${
          active ? ' aria-current="page"' : ""
        }>
      ${icon(item.icon, "size-[18px] shrink-0")}
      <span class="truncate">${item.label}</span>
    </a>`;
  }).join("");

  return `<!doctype html>
<html lang="en" class="h-full">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  ${THEME_BOOTSTRAP}
  <title>${escapeHtml(options.title)} · MeetFlow</title>
  <link rel="preload" href="/fonts/geist-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/app.css">
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' rx='6' fill='%23222'/%3E%3Crect x='7' y='11' width='6' height='5' rx='1.5' fill='white'/%3E%3C/svg%3E">
  <script defer src="/vendor/alpine.min.js"></script>
</head>
<body class="min-h-full bg-canvas text-body antialiased">
  <div class="flex min-h-screen" x-data="{ drawer: false }">

    <header class="fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-surface/85 px-4 backdrop-blur-md lg:hidden">
      ${wordmark("/dashboard")}
      <button type="button" class="ui-btn ui-btn-ghost ui-btn-sm px-2"
              @click="drawer = true" aria-label="Open menu" aria-controls="app-sidebar">
        ${icon("menu", "size-5")}
      </button>
    </header>

    <div x-show="drawer" x-cloak class="fixed inset-0 z-40 bg-ink/40 lg:hidden"
         @click="drawer = false" aria-hidden="true"></div>

    <aside id="app-sidebar" class="app-sidebar" :class="drawer ? 'drawer-open' : ''">
      <div class="flex h-14 shrink-0 items-center border-b border-line px-4">
        ${wordmark("/dashboard")}
      </div>

      <nav class="flex-1 space-y-0.5 overflow-y-auto p-3" aria-label="Main">${links}</nav>

      <div class="shrink-0 space-y-3 border-t border-line p-3">
        <div class="flex items-center gap-2.5 px-1">
          ${avatar(options.hostName ?? "You", options.hostAvatarKey ?? null, "size-8", "text-xs")}
          <span class="min-w-0 truncate text-sm font-medium text-ink">${escapeHtml(
            options.hostName ?? "",
          )}</span>
        </div>
        <div class="flex items-center justify-between gap-1">
          ${themeToggle()}
          <form method="post" action="/logout">
            <button class="ui-btn ui-btn-ghost ui-btn-sm" type="submit">
              ${icon("logOut", "size-4")}
              <span>Sign out</span>
            </button>
          </form>
        </div>
      </div>
    </aside>

    <div class="min-w-0 flex-1">
      <main class="mx-auto w-full max-w-5xl px-5 pb-10 pt-20 sm:px-6 lg:pt-10">${options.body}</main>
    </div>
  </div>
  ${dataScript}
  ${THEME_TOGGLE_SCRIPT}
</body>
</html>`;
}
```

- [ ] **Step 4: Route `nav: "host"` to the new shell**

In `layout()`, replace:

```ts
  const header =
    options.nav === "host"
      ? hostNav(options.activeNav, options.hostName)
      : options.nav === "public"
        ? publicHeader()
        : "";
```

with:

```ts
  if (options.nav === "host") return hostLayout(options, dataScript);

  const header = options.nav === "public" ? publicHeader() : "";
```

- [ ] **Step 5: Pass `hostAvatarKey` from the six dashboard pages**

In `src/views/dashboard.ts`, at each of the six `layout({ ... nav: "host", activeNav: ..., hostName: user.name, ... })` call sites, add `hostAvatarKey: user.avatar_key,` on the line after `hostName: user.name,`.

- [ ] **Step 6: Typecheck and test**

Run: `npm run typecheck && npm test`
Expected: all pass. (`escapeHtml` in the same file is still the re-export; `wordmark`, `themeToggle`, `THEME_BOOTSTRAP`, `THEME_TOGGLE_SCRIPT` unchanged.)

- [ ] **Step 7: Commit**

```bash
git add src/views/layout.ts src/views/dashboard.ts
git commit -m "feat(shell): left sidebar navigation with icons and mobile drawer"
```

---

### Task 7: Page smoke-test updates

**Files:**
- Modify: `test/integration/pages.test.ts`

- [ ] **Step 1: Assert the new shells in the smoke tests**

In the "renders the dashboard for a signed-in host" test, after `expect(res.status).toBe(200);` add:

```ts
    const html = await res.text();
    expect(html).toContain("Upcoming");
    expect(html).toContain("app-sidebar");
    expect(html).toContain("ui-side-link-active");
```

(Replace the existing `expect(await res.text()).toContain("Upcoming");` with the above so the text is fetched once.)

In the "renders a public booking page" test, add after `expect(html).toContain('id="page-data"');`:

```ts
    expect(html).toContain("ui-day");
    expect(html).toContain("data-timezone");
```

- [ ] **Step 2: Run**

Run: `npx vitest run test/integration/pages.test.ts`
Expected: pass.

- [ ] **Step 3: Commit**

```bash
git add test/integration/pages.test.ts
git commit -m "test(pages): assert sidebar and calendar markup"
```

---

### Task 8: Full verification and deploy

- [ ] **Step 1: Format check**

Run: `npm run format:check`
Expected: clean. If not: `npm run format`, then re-run checks.

- [ ] **Step 2: Full test suite + typecheck**

Run: `npm run check`
Expected: all green (format, typecheck, tests).

- [ ] **Step 3: Manual browser checks (local)**

Run: `npm run dev` then visit:

- `http://localhost:8787/wan/consultation` (or your real slug) — calendar shows disabled past/unavailable days, click a day → time list, 12h/24h toggle relabels, timezone select relabels, pick time → form → confirm booking.
- `http://localhost:8787/dashboard` (signed in) — sidebar with icons on desktop, hamburger drawer on mobile, theme toggle works, sign out works.
- Resize to mobile width: booking page stacks; picking a day scrolls to the time list.

- [ ] **Step 4: Deploy**

Run: `npm run deploy`
Expected: uploads `app.css` + worker, no errors.

- [ ] **Step 5: Verify production**

Run: `curl -s https://meetflow.wmafendi.workers.dev/api/public/<your-slug>/<event-slug>/month?year=2026&month=10`
Expected: `{"days":[...]}`. Then open `https://meetflow.wmafendi.workers.dev/<your-slug>/<event-slug>` and click through a booking.

- [ ] **Step 6: Commit any leftover changes and summarize**

```bash
git status --short
```