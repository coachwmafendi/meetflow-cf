# Global Search (Command Palette) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A host-dashboard ⌘K command palette that searches bookings, event types and attendees via a server-side API, plus quick navigation and actions, per `docs/superpowers/specs/2026-09-15-global-search-design.md`.

**Architecture:** One authenticated endpoint `GET /api/search?q=` (Hono + `requireAuth` + `rateLimit`) runs three host-scoped `LIKE` queries over bookings, event types and `booking_attendees`, capped at 5 results each; an empty query returns the 3 latest bookings as recents. The palette is an Alpine component (`window.meetflowPalette`) living in `hostLayout` with a window-level ⌘K listener, debounced (200ms) fetches and an `AbortController`.

**Tech Stack:** Cloudflare Workers + Hono, D1, Alpine.js (vendored), Vitest + `@cloudflare/vitest-pool-workers`.

**Conventions in this repo:** Alpine components are plain functions assigned to `window` in an inline `<script>` (see `window.createEventTypeForm` in `src/views/dashboard.ts:69`); API routes are Hono sub-apps mounted in `src/index.ts`; rate limits live in `LIMITS` (`src/middleware/rateLimit.ts`); test helpers `createHost`/`api` come from `test/helpers.ts`.

---

### Task 1: Search API (db module, route, rate limit)

**Files:**
- Create: `src/db/search.ts`
- Create: `src/routes/api.search.ts`
- Modify: `src/index.ts` (mount the route)
- Modify: `src/middleware/rateLimit.ts` (add `LIMITS.search`)
- Modify: `vitest.config.ts` (lift the limit in tests)
- Test: `test/integration/search.test.ts`

- [ ] **Step 1: Write the failing tests**

`test/integration/search.test.ts`:

```ts
import { env, SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { insertBookingIfFree } from "../../src/db/bookings";
import { api, createHost, resetDb } from "../helpers";

/** Host + Monday 09:00-17:00 availability + a 30-min event type, via the public API. */
async function seedHost(slug: string, seatsTotal = 1) {
  const host = await createHost(slug);
  await api("/api/availability", {
    method: "PUT",
    cookie: host.cookie,
    body: JSON.stringify({ rules: [{ day_of_week: 1, start_time: "09:00", end_time: "17:00" }] }),
  });
  const res = await api("/api/event-types", {
    method: "POST",
    cookie: host.cookie,
    body: JSON.stringify({
      name: "Consultation",
      slug: "consultation",
      duration_minutes: 30,
      seats_total: seatsTotal,
    }),
  });
  const { eventType } = await res.json<{ eventType: { id: number } }>();
  return { host, eventType };
}

async function book(host: { slug: string }, startAt: string, name: string, email: string) {
  return SELF.fetch(`https://example.com/api/public/${host.slug}/consultation/book`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      start_at: startAt,
      guest_name: name,
      guest_email: email,
      timezone: "Asia/Kuala_Lumpur",
    }),
  });
}

/** Inserts a booking row directly (avoids depending on booking-flow mechanics). */
function insertBooking(hostId: number, eventTypeId: number, startAt: string) {
  return insertBookingIfFree(env.DB, {
    userId: hostId,
    eventTypeId,
    guestName: "Direct Guest",
    guestEmail: "direct@example.com",
    startAt,
    endAt: startAt.replace("T05:00:00Z", "T05:30:00Z"),
    timezone: "Asia/Kuala_Lumpur",
    notes: "Discuss the quarterly budget",
    bufferMinutes: 0,
    now: "2026-09-15T00:00:00Z",
  });
}

describe("GET /api/search", () => {
  beforeEach(resetDb);

  it("requires auth", async () => {
    expect((await api("/api/search?q=ahmad")).status).toBe(401);
  });

  it("finds a booking by guest name, email and notes", async () => {
    const { host } = await seedHost("wan");
    await book(host, "2026-09-21T05:00:00Z", "Ahmad Zulkifli", "ahmad@example.com");

    for (const q of ["ahmad", "AHMAD@example.com", "quarterly budget"]) {
      const res = await api(`/api/search?q=${encodeURIComponent(q)}`, { cookie: host.cookie });
      expect(res.status).toBe(200);
      const body = await res.json<{ bookings: Array<{ guest_name: string }> }>();
      expect(body.bookings).toHaveLength(1);
      expect(body.bookings[0]!.guest_name).toBe("Ahmad Zulkifli");
    }
  });

  it("never returns another host's data", async () => {
    await seedHost("wan");
    const ali = await seedHost("ali");
    const res = await api("/api/search?q=ahmad", { cookie: ali.cookie });
    const body = await res.json<{ bookings: unknown[] }>();
    expect(body.bookings).toEqual([]);
  });

  it("finds an event type by name and slug", async () => {
    const { host } = await seedHost("wan");
    for (const q of ["consult", "consultation"]) {
      const res = await api(`/api/search?q=${encodeURIComponent(q)}`, { cookie: host.cookie });
      const body = await res.json<{ eventTypes: Array<{ slug: string }> }>();
      expect(body.eventTypes[0]!.slug).toBe("consultation");
    }
  });

  it("finds an attendee by name or email", async () => {
    const { host, eventType } = await seedHost("wan");
    const booking = await insertBooking(host.id, eventType.id, "2026-09-21T05:00:00Z");
    if (!booking) throw new Error("booking insert failed");
    const now = "2026-09-15T00:00:00Z";
    await env.DB.prepare(
      `INSERT INTO booking_attendees
         (booking_id, guest_name, guest_email, notes, timezone, status, created_at, updated_at)
       VALUES (?, ?, ?, NULL, 'Asia/Kuala_Lumpur', 'confirmed', ?, ?)`,
    )
      .bind(booking.id, "Sara Lim", "sara@example.com", now, now)
      .run();

    const res = await api("/api/search?q=sara", { cookie: host.cookie });
    const body = await res.json<{ attendees: Array<{ guest_email: string; booking_id: number }> }>();
    expect(body.attendees).toHaveLength(1);
    expect(body.attendees[0]!.guest_email).toBe("sara@example.com");
    expect(body.attendees[0]!.booking_id).toBe(booking.id);
  });

  it("returns 3 recent bookings on an empty query and no match groups", async () => {
    const { host, eventType } = await seedHost("wan");
    await insertBooking(host.id, eventType.id, "2026-09-21T05:00:00Z");
    await insertBooking(host.id, eventType.id, "2026-09-28T05:00:00Z");

    const res = await api("/api/search", { cookie: host.cookie });
    const body = await res.json<{
      bookings: unknown[];
      eventTypes: unknown[];
      attendees: unknown[];
    }>();
    expect(body.bookings).toHaveLength(2);
    expect(body.eventTypes).toEqual([]);
    expect(body.attendees).toEqual([]);
  });

  it("treats LIKE wildcards literally", async () => {
    const { host } = await seedHost("wan");
    await book(host, "2026-09-21T05:00:00Z", "Ahmad Zulkifli", "ahmad@example.com");

    const res = await api("/api/search?q=%25ahmad%25", { cookie: host.cookie });
    const body = await res.json<{ bookings: unknown[] }>();
    expect(body.bookings).toEqual([]);
  });

  it("rejects an over-100-char query", async () => {
    const { host } = await seedHost("wan");
    const res = await api(`/api/search?q=${"x".repeat(101)}`, { cookie: host.cookie });
    expect(res.status).toBe(400);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/integration/search.test.ts`
Expected: FAIL — `/api/search` 404s (route not mounted), so the auth test expects 401 but gets 404.

- [ ] **Step 3: Add the rate-limit bucket**

In `src/middleware/rateLimit.ts`, add to `LIMITS` (after `guestCancel`):

```ts
  /** Keystroke-driven: 60/min per host is far above human typing, well below abuse. */
  search: { bucket: "search", limit: 60, periodSeconds: 60 },
```

`KNOWN_BUCKETS` derives from `LIMITS`, so nothing else changes there.

- [ ] **Step 4: Lift the limit in tests**

In `vitest.config.ts`, add `search` to `RATE_LIMIT_OVERRIDES` (the suite fires dozens of searches from one IP):

```ts
          RATE_LIMIT_OVERRIDES: JSON.stringify({
            book: 1_000_000,
            login: 1_000_000,
            register: 1_000_000,
            avatar: 1_000_000,
            search: 1_000_000,
          }),
```

- [ ] **Step 5: Create `src/db/search.ts`**

```ts
export interface SearchResultBooking {
  id: number;
  guest_name: string;
  guest_email: string;
  start_at: string;
  status: string;
  event_name: string;
}

export interface SearchResultEventType {
  id: number;
  name: string;
  slug: string;
  is_active: number;
}

export interface SearchResultAttendee {
  booking_id: number;
  guest_name: string;
  guest_email: string;
}

/**
 * Escapes LIKE wildcards so the guest's text matches literally: a query of
 * "%ahmad%" must not be read as a pattern.
 */
export function escapeLike(value: string): string {
  return value.replace(/[\\%_]/g, (ch) => `\\${ch}`);
}

const ESCAPE_CLAUSE = `ESCAPE '\\'`;

export async function searchBookings(
  db: D1Database,
  userId: number,
  q: string,
  limit = 5,
): Promise<SearchResultBooking[]> {
  const pattern = `%${escapeLike(q)}%`;
  const { results } = await db
    .prepare(
      `SELECT b.id, b.guest_name, b.guest_email, b.start_at, b.status, e.name AS event_name
       FROM bookings b
       JOIN event_types e ON e.id = b.event_type_id
       WHERE b.user_id = ?
         AND (b.guest_name LIKE ? ${ESCAPE_CLAUSE}
           OR b.guest_email LIKE ? ${ESCAPE_CLAUSE}
           OR b.notes LIKE ? ${ESCAPE_CLAUSE})
       ORDER BY b.start_at DESC
       LIMIT ?`,
    )
    .bind(userId, pattern, pattern, pattern, limit)
    .all<SearchResultBooking>();
  return results;
}

export async function searchEventTypes(
  db: D1Database,
  userId: number,
  q: string,
  limit = 5,
): Promise<SearchResultEventType[]> {
  const pattern = `%${escapeLike(q)}%`;
  const { results } = await db
    .prepare(
      `SELECT id, name, slug, is_active
       FROM event_types
       WHERE user_id = ?
         AND (name LIKE ? ${ESCAPE_CLAUSE}
           OR slug LIKE ? ${ESCAPE_CLAUSE}
           OR description LIKE ? ${ESCAPE_CLAUSE})
       ORDER BY name
       LIMIT ?`,
    )
    .bind(userId, pattern, pattern, pattern, limit)
    .all<SearchResultEventType>();
  return results;
}

export async function searchAttendees(
  db: D1Database,
  userId: number,
  q: string,
  limit = 5,
): Promise<SearchResultAttendee[]> {
  const pattern = `%${escapeLike(q)}%`;
  const { results } = await db
    .prepare(
      `SELECT a.booking_id, a.guest_name, a.guest_email
       FROM booking_attendees a
       JOIN bookings b ON b.id = a.booking_id
       WHERE b.user_id = ?
         AND (a.guest_name LIKE ? ${ESCAPE_CLAUSE} OR a.guest_email LIKE ? ${ESCAPE_CLAUSE})
       ORDER BY a.created_at DESC
       LIMIT ?`,
    )
    .bind(userId, pattern, pattern, limit)
    .all<SearchResultAttendee>();
  return results;
}

/** The 3 latest bookings, shown as "Recent" when the palette opens empty. */
export async function recentBookings(
  db: D1Database,
  userId: number,
  limit = 3,
): Promise<SearchResultBooking[]> {
  const { results } = await db
    .prepare(
      `SELECT b.id, b.guest_name, b.guest_email, b.start_at, b.status, e.name AS event_name
       FROM bookings b
       JOIN event_types e ON e.id = b.event_type_id
       WHERE b.user_id = ?
       ORDER BY b.created_at DESC
       LIMIT ?`,
    )
    .bind(userId, limit)
    .all<SearchResultBooking>();
  return results;
}
```

- [ ] **Step 6: Create `src/routes/api.search.ts`**

```ts
import { Hono } from "hono";
import { recentBookings, searchAttendees, searchBookings, searchEventTypes } from "../db/search";
import { requireAuth } from "../middleware/auth";
import { LIMITS, rateLimit } from "../middleware/rateLimit";
import type { AppEnv } from "../types";

export const searchRoutes = new Hono<AppEnv>();

searchRoutes.use("*", requireAuth);

searchRoutes.get("/", rateLimit(LIMITS.search), async (c) => {
  const raw = c.req.query("q") ?? "";
  if (raw.length > 100) return c.json({ error: "Query too long" }, 400);
  const q = raw.trim();
  const user = c.get("user");

  if (q === "") {
    return c.json({
      bookings: await recentBookings(c.env.DB, user.id),
      eventTypes: [],
      attendees: [],
    });
  }

  const [bookings, eventTypes, attendees] = await Promise.all([
    searchBookings(c.env.DB, user.id, q),
    searchEventTypes(c.env.DB, user.id, q),
    searchAttendees(c.env.DB, user.id, q),
  ]);
  return c.json({ bookings, eventTypes, attendees });
});
```

- [ ] **Step 7: Mount the route in `src/index.ts`**

Add the import next to the other route imports:

```ts
import { searchRoutes } from "./routes/api.search";
```

and mount it next to the others:

```ts
app.route("/api/search", searchRoutes);
```

- [ ] **Step 8: Run to verify pass**

Run: `npx vitest run test/integration/search.test.ts`
Expected: PASS (8 tests).

- [ ] **Step 9: Commit**

```bash
git add src/db/search.ts src/routes/api.search.ts src/index.ts src/middleware/rateLimit.ts vitest.config.ts test/integration/search.test.ts
git commit -m "feat(search): host-scoped search API"
```

---

### Task 2: The palette UI in `hostLayout`

**Files:**
- Modify: `src/views/layout.ts` (sidebar button, palette markup, Alpine component script)
- Test: `test/integration/pages.test.ts` (markup assertions)

- [ ] **Step 1: Write the failing markup test**

Append inside the top-level `describe("pages", …)` in `test/integration/pages.test.ts` (it already has `createHost` imported from `../helpers`):

```ts
  it("ships the command palette on host pages only", async () => {
    const host = await createHost("wan");
    const res = await SELF.fetch("https://example.com/dashboard", {
      headers: { cookie: host.cookie },
    });
    const html = await res.text();
    expect(html).toContain("meetflowPalette");
    expect(html).toContain("open-palette");

    const login = await SELF.fetch("https://example.com/login");
    expect(await login.text()).not.toContain("meetflowPalette");
  });
```

- [ ] **Step 2: Run to verify failure**

Run: `npx vitest run test/integration/pages.test.ts`
Expected: FAIL — the host page has no `meetflowPalette` yet.

- [ ] **Step 3: Add the palette script to `src/views/layout.ts`**

Next to `COPY_LINK_SCRIPT` (~line 80), add:

```ts
/**
 * The ⌘K command palette. Debounced fetches to /api/search with an
 * AbortController; results are grouped (Actions, Navigation, data groups) and
 * navigated with ↑/↓/Enter. Everything renders via x-text, so guest-controlled
 * strings can never inject markup.
 */
const PALETTE_SCRIPT = `
  <script>
    window.meetflowPalette = function () {
      return {
        open: false,
        q: "",
        loading: false,
        failed: false,
        selected: 0,
        bookings: [],
        eventTypes: [],
        attendees: [],
        controller: null,
        timer: null,

        get items() {
          var items = [];
          function group(name) {
            items.push({ header: true, key: "h-" + name, label: name });
          }
          group("Actions");
          items.push({ key: "new-event-type", label: "New event type", hint: "Action", href: "/dashboard/event-types" });
          group("Navigation");
          items.push({ key: "nav-dashboard", label: "Dashboard", hint: "", href: "/dashboard" });
          items.push({ key: "nav-event-types", label: "Event Types", hint: "", href: "/dashboard/event-types" });
          items.push({ key: "nav-availability", label: "Availability", hint: "", href: "/dashboard/availability" });
          items.push({ key: "nav-bookings", label: "Appointments", hint: "", href: "/dashboard/bookings" });
          items.push({ key: "nav-settings", label: "Settings", hint: "", href: "/dashboard/settings" });
          if (!this.q.trim()) {
            group("Recent");
            for (var i = 0; i < this.bookings.length; i++) {
              var b = this.bookings[i];
              items.push({ key: "b" + b.id, label: b.guest_name + " — " + b.event_name, hint: b.guest_email, href: "/dashboard/bookings" });
            }
            return items;
          }
          if (this.bookings.length) {
            group("Bookings");
            for (var j = 0; j < this.bookings.length; j++) {
              var r = this.bookings[j];
              items.push({ key: "b" + r.id, label: r.guest_name + " — " + r.event_name, hint: r.guest_email, href: "/dashboard/bookings" });
            }
          }
          if (this.eventTypes.length) {
            group("Event types");
            for (var k = 0; k < this.eventTypes.length; k++) {
              var e = this.eventTypes[k];
              items.push({ key: "e" + e.id, label: e.name, hint: "/" + e.slug, href: "/dashboard/event-types/" + e.id });
            }
          }
          if (this.attendees.length) {
            group("Attendees");
            for (var m = 0; m < this.attendees.length; m++) {
              var a = this.attendees[m];
              items.push({ key: "a" + a.booking_id + "-" + a.guest_email, label: a.guest_name, hint: a.guest_email, href: "/dashboard/bookings" });
            }
          }
          return items;
        },

        toggle: function () { this.open ? this.close() : this.show(); },
        show: function () {
          this.open = true;
          this.q = "";
          this.selected = 0;
          this.bookings = [];
          this.eventTypes = [];
          this.attendees = [];
          this.failed = false;
          var self = this;
          this.$nextTick(function () { self.$refs.input.focus(); });
          this.fetch("");
        },
        close: function () {
          this.open = false;
          if (this.controller) this.controller.abort();
        },
        go: function (item) {
          this.close();
          window.location.href = item.href;
        },
        fetch: function (query) {
          var self = this;
          if (this.controller) this.controller.abort();
          this.controller = new AbortController();
          this.loading = true;
          this.failed = false;
          fetch("/api/search?q=" + encodeURIComponent(query), { signal: this.controller.signal })
            .then(function (res) { if (!res.ok) throw new Error(res.status); return res.json(); })
            .then(function (data) {
              self.bookings = data.bookings || [];
              self.eventTypes = data.eventTypes || [];
              self.attendees = data.attendees || [];
              self.selected = 0;
              self.loading = false;
            })
            .catch(function () {
              if (!self.controller.signal.aborted) {
                self.loading = false;
                self.failed = true;
              }
            });
        },
        onInput: function () {
          var self = this;
          if (this.timer) clearTimeout(this.timer);
          this.timer = setTimeout(function () { self.fetch(self.q); }, 200);
        },
        move: function (delta) {
          var next = this.selected;
          do {
            next += delta;
            if (next < 0 || next >= this.items.length) return;
          } while (this.items[next].header);
          this.selected = next;
        },
        onKeydown: function (event) {
          if (event.key === "ArrowDown") { event.preventDefault(); this.move(1); }
          else if (event.key === "ArrowUp") { event.preventDefault(); this.move(-1); }
          else if (event.key === "Enter") {
            var item = this.items[this.selected];
            if (item && !item.header) { event.preventDefault(); this.go(item); }
          }
        },
      };
    };
  </script>`;
```

- [ ] **Step 4: Add the sidebar button in `hostLayout`**

In `hostLayout`, directly after the wordmark header div:

```html
<div class="flex h-14 shrink-0 items-center border-b border-line px-4">
  ${wordmark("/dashboard")}
</div>
```

insert:

```ts
        <div class="px-3 pt-3">
          <button type="button" class="ui-side-link w-full" @click="$dispatch('open-palette')"
                  aria-label="Search — Command K">
            ${icon("search", "size-[18px] shrink-0")}
            <span class="flex-1 text-left">Search</span>
            <kbd class="rounded border border-line bg-subtle px-1.5 py-0.5 text-[0.6875rem] text-muted">⌘K</kbd>
          </button>
        </div>
```

- [ ] **Step 5: Add the palette overlay markup**

In `hostLayout`, directly before `${dataScript}` (same place THEME/COPY scripts sit), add `${PALETTE_SCRIPT}` and the overlay:

```html
<div x-data="meetflowPalette()" @open-palette.window="show()"
     @keydown.meta.k.window.prevent="toggle()" @keydown.ctrl.k.window.prevent="toggle()"
     @keydown.escape.window="if (open) close()">
  <div x-show="open" x-cloak class="fixed inset-0 z-[60] bg-ink/40" @click="close()"></div>
  <div x-show="open" x-cloak x-transition.duration.120ms
       class="fixed inset-x-4 top-[10vh] z-[61] mx-auto max-w-xl" @click.outside="close()">
    <div class="ui-card overflow-hidden p-0">
      <input x-ref="input" x-model="q" @input="onInput()" @keydown="onKeydown($event)"
             type="search" autocomplete="off" aria-label="Search"
             placeholder="Search appointments, event types, attendees…"
             class="w-full border-0 bg-transparent px-4 py-3 text-sm text-ink outline-none">
      <div class="max-h-[60vh] overflow-y-auto border-t border-line py-1">
        <template x-for="item in items" :key="item.key">
          <div x-show="item.header"
               class="px-4 pt-2 pb-1 text-[0.6875rem] font-medium uppercase tracking-wide text-muted"
               x-text="item.label"></div>
        </template>
        <template x-for="(item, index) in items" :key="item.key">
          <button x-show="!item.header" type="button" @click="go(item)" @mouseenter="selected = index"
                  class="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm"
                  :class="selected === index ? 'bg-subtle' : ''">
            <span class="min-w-0 flex-1 truncate text-ink" x-text="item.label"></span>
            <span class="max-w-[14rem] shrink-0 truncate text-[0.75rem] text-muted" x-text="item.hint"></span>
          </button>
        </template>
        <p x-show="!items.length && !loading && !failed" class="px-4 py-3 text-sm text-muted">No results.</p>
        <p x-show="failed" class="px-4 py-3 text-sm text-muted">Search is unavailable right now.</p>
      </div>
    </div>
  </div>
</div>
```

Also add `${PALETTE_SCRIPT}` immediately before the overlay block. (Two `x-for` templates over the same array: one renders headers, one renders rows — keeps selection logic free of header special-cases in the template.)

- [ ] **Step 6: Run to verify pass**

Run: `npx vitest run test/integration/pages.test.ts`
Expected: PASS.

- [ ] **Step 7: Full check**

Run: `npm run check`
Expected: format clean, typecheck clean, all tests green. If Prettier reformats layout.ts, commit that with this task.

- [ ] **Step 8: Commit**

```bash
git add src/views/layout.ts test/integration/pages.test.ts
git commit -m "feat(search): command palette in the host dashboard"
```

---

### Task 3: Docs

**Files:**
- Modify: `PRD.md` (§14 Dashboard, §19 API)

- [ ] **Step 1: Update the PRD**

In §14 Dashboard, add a bullet/short paragraph: the host dashboard has a global ⌘K command
palette searching appointments (guest name/email/notes), event types (name/slug/description)
and attendees, with quick navigation and a "New event type" action; an empty query shows the
3 latest appointments as "Recent".

In §19 API, add to the authenticated endpoints:

```http
GET /api/search?q=<query>
```

with one line: host-scoped `LIKE` search over bookings, event types and attendees; ≤5 results
per group; empty query returns the 3 latest bookings.

- [ ] **Step 2: Format and verify**

Run: `npx prettier --write PRD.md && npm run check`
Expected: clean, all tests green.

- [ ] **Step 3: Commit**

```bash
git add PRD.md
git commit -m "docs(search): prd describes the command palette"
```

---

## Self-Review

- **Spec coverage:** ⌘K + sidebar button (Task 2), grouped results incl. Actions/Navigation (Task 2 `items`), ≤5 per group (Task 1 SQL `LIMIT ?`), empty-query recents (Task 1 `recentBookings` + route, Task 2 UI "Recent" group), keyboard nav (Task 2 `move`/`onKeydown`), debounce + abort (Task 2 `onInput`/`fetch`), fail-open error row (Task 2 `failed`), LIKE escaping (Task 1 `escapeLike`, test "wildcards literally"), 400 over 100 chars (route + test), host isolation (all queries `user_id = ?` + test), 401 (requireAuth + test), rate limit (Task 1 Steps 3-4), click targets (spec: booking→bookings page, event type→edit page — both in `items` hrefs), docs (Task 3).
- **Placeholder scan:** none — every code step is complete.
- **Type consistency:** `SearchResultBooking`/`SearchResultEventType`/`SearchResultAttendee` defined once in Task 1 and consumed by the route and by `items` in Task 2 (snake_case from D1 rows, consumed as-is in JS); `LIMITS.search` referenced by the route matches Step 3; `/api/search` mount name matches imports.
