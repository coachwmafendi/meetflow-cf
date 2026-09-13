# MeetFlow MVP Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a Cal.com-style scheduling app on Cloudflare Workers + D1 where a host can publish a booking page and a guest can book a slot that can never be double-booked.

**Architecture:** One Cloudflare Worker runs everything — Hono routes the API and server-renders HTML, D1 is the only source of truth, and the Workers Assets binding serves the Tailwind bundle and Alpine.js from `public/`. The booking engine is split into three pure, dependency-free modules (`timezone.ts`, `slots.ts`, `booking.ts` policy) that are unit-testable without a database; everything that touches D1 lives behind thin repository functions. Double-booking is prevented by a single atomic conditional `INSERT ... SELECT ... WHERE NOT EXISTS`, backed by a partial unique index.

**Tech Stack:** TypeScript, Cloudflare Workers (`workerd`), Hono 4, Cloudflare D1 (SQLite), Workers Assets, Tailwind CSS 4 CLI, Alpine.js 3 (CDN-free, vendored), Vitest + `@cloudflare/vitest-pool-workers`, Wrangler 4.

**Source specs:** [PRD.md](../../../PRD.md), [ERD.md](../../../ERD.md)

---

## File Structure

```text
meetflow-cf/
├── PRD.md
├── ERD.md
├── erd.png
├── README.md
├── package.json
├── tsconfig.json
├── wrangler.jsonc
├── vitest.config.ts
├── tailwind.config.js               # only if Tailwind v3 fallback is needed
├── migrations/
│   └── 0001_initial.sql             # schema + indexes (ERD.md §7, §8)
├── src/
│   ├── index.ts                     # Hono app assembly, error handler, export default
│   ├── types.ts                     # Env bindings, row types, Variables
│   ├── lib/
│   │   ├── time.ts                  # isoUtc(), nowIso() — fixed-width UTC strings
│   │   ├── timezone.ts              # Intl-based zoned <-> UTC conversion
│   │   ├── slots.ts                 # pure slot generation + overlap filtering
│   │   ├── password.ts              # PBKDF2 hash/verify via Web Crypto
│   │   ├── session.ts               # HMAC signed cookie token sign/verify
│   │   └── validate.ts              # tiny hand-rolled validators (no zod)
│   ├── db/
│   │   ├── users.ts
│   │   ├── eventTypes.ts
│   │   ├── availability.ts
│   │   └── bookings.ts
│   ├── services/
│   │   ├── auth.ts                  # register/login orchestration
│   │   ├── availability.ts          # rules -> bookable slots for a date
│   │   └── booking.ts               # validate + atomic create + cancel
│   ├── middleware/
│   │   └── auth.ts                  # requireAuth, loadUser
│   ├── routes/
│   │   ├── api.auth.ts
│   │   ├── api.eventTypes.ts
│   │   ├── api.availability.ts
│   │   ├── api.bookings.ts
│   │   ├── api.public.ts
│   │   └── pages.ts                 # all server-rendered HTML routes
│   └── views/
│       ├── layout.ts                # shell: <head>, nav, flash
│       ├── auth.ts                  # login + register forms
│       ├── dashboard.ts             # dashboard, event types, availability, bookings, settings
│       └── publicBooking.ts         # /:username and /:username/:eventSlug + confirmation
├── public/
│   ├── app.css                      # Tailwind build output (gitignored)
│   └── vendor/alpine.min.js
└── test/
    ├── env.d.ts
    ├── unit/
    │   ├── timezone.test.ts
    │   ├── slots.test.ts
    │   ├── password.test.ts
    │   └── session.test.ts
    └── integration/
        ├── auth.test.ts
        ├── eventTypes.test.ts
        ├── availability.test.ts
        ├── booking.test.ts
        └── ownership.test.ts
```

**Responsibility boundaries:**
- `lib/*` — pure functions. No D1, no Hono, no `Env`. Fully unit-testable.
- `db/*` — the only files that write SQL. One file per table.
- `services/*` — business rules. Take `D1Database` + plain args, return plain results.
- `routes/*` — HTTP shape only: parse, call a service, map errors to status codes.
- `views/*` — return `string` HTML. No data fetching.

---

## Phase 1 — Foundation

### Task 1: Project scaffold

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `wrangler.jsonc`
- Create: `.gitignore`
- Create: `src/types.ts`
- Create: `src/index.ts`
- Create: `vitest.config.ts`
- Create: `test/env.d.ts`
- Create: `test/integration/smoke.test.ts`

- [ ] **Step 1: Init git and install dependencies**

```bash
cd /Users/wmafendi/meetflow-cf
git init
npm init -y
npm install hono
npm install -D wrangler typescript vitest @cloudflare/vitest-pool-workers @cloudflare/workers-types tailwindcss @tailwindcss/cli
```

- [ ] **Step 2: Write `package.json` scripts**

Replace the `scripts` block in `package.json` with:

```json
{
  "name": "meetflow",
  "private": true,
  "type": "module",
  "scripts": {
    "dev": "npm run css && wrangler dev",
    "css": "tailwindcss -i ./src/styles/app.css -o ./public/app.css",
    "css:watch": "tailwindcss -i ./src/styles/app.css -o ./public/app.css --watch",
    "build": "npm run css",
    "test": "vitest run",
    "test:watch": "vitest",
    "typecheck": "tsc --noEmit",
    "db:migrate:local": "wrangler d1 migrations apply meetflow-db --local",
    "db:migrate:remote": "wrangler d1 migrations apply meetflow-db --remote",
    "deploy": "npm run css && wrangler deploy"
  }
}
```

- [ ] **Step 3: Write `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "lib": ["ES2022"],
    "types": ["@cloudflare/workers-types/2023-07-01", "@cloudflare/vitest-pool-workers"],
    "strict": true,
    "noUncheckedIndexedAccess": true,
    "noEmit": true,
    "skipLibCheck": true,
    "isolatedModules": true,
    "jsx": "react-jsx",
    "jsxImportSource": "hono/jsx"
  },
  "include": ["src/**/*.ts", "test/**/*.ts", "*.ts"]
}
```

- [ ] **Step 4: Write `wrangler.jsonc`**

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "meetflow",
  "main": "src/index.ts",
  "compatibility_date": "2026-09-01",
  "assets": {
    "directory": "./public",
    "binding": "ASSETS"
  },
  "d1_databases": [
    {
      "binding": "DB",
      "database_name": "meetflow-db",
      "database_id": "PLACEHOLDER_REPLACED_IN_TASK_2",
      "migrations_dir": "migrations"
    }
  ],
  "observability": { "enabled": true }
}
```

- [ ] **Step 5: Write `.gitignore`**

```gitignore
node_modules/
.wrangler/
public/app.css
.dev.vars
.DS_Store
```

- [ ] **Step 6: Write `src/types.ts`**

```ts
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
```

- [ ] **Step 7: Write `src/index.ts`**

```ts
import { Hono } from "hono";
import type { AppEnv } from "./types";

const app = new Hono<AppEnv>();

app.get("/healthz", (c) => c.json({ ok: true }));

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Internal Server Error" }, 500);
});

export default app;
```

- [ ] **Step 8: Write `vitest.config.ts`**

```ts
import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        singleWorker: true,
        wrangler: { configPath: "./wrangler.jsonc" },
        miniflare: {
          bindings: { SESSION_SECRET: "test-secret-do-not-use-in-prod" },
          d1Databases: { DB: "meetflow-test" },
        },
      },
    },
  },
});
```

- [ ] **Step 9: Write `test/env.d.ts`**

```ts
declare module "cloudflare:test" {
  interface ProvidedEnv extends import("../src/types").Env {
    TEST_MIGRATIONS: D1Migration[];
  }
}
```

- [ ] **Step 10: Write the smoke test**

`test/integration/smoke.test.ts`:

```ts
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("worker", () => {
  it("responds to /healthz", async () => {
    const res = await SELF.fetch("https://example.com/healthz");
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ ok: true });
  });
});
```

- [ ] **Step 11: Run the smoke test**

Run: `npm test`
Expected: 1 passed. (If it fails on the D1 `database_id` placeholder, that is fixed in Task 2 — the local test pool does not need a real id, so it should pass.)

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "chore: scaffold Cloudflare Worker + Hono + Vitest project"
```

---

### Task 2: Database schema and migrations

**Files:**
- Create: `migrations/0001_initial.sql`
- Modify: `vitest.config.ts`
- Create: `test/integration/schema.test.ts`
- Modify: `wrangler.jsonc` (real `database_id`)

- [ ] **Step 1: Create the D1 database**

```bash
npx wrangler d1 create meetflow-db
```

Copy the printed `database_id` into `wrangler.jsonc`, replacing `PLACEHOLDER_REPLACED_IN_TASK_2`.

- [ ] **Step 2: Write `migrations/0001_initial.sql`**

```sql
PRAGMA foreign_keys = ON;

CREATE TABLE users (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE,
    password_hash TEXT NOT NULL,
    slug TEXT NOT NULL UNIQUE,
    timezone TEXT NOT NULL DEFAULT 'UTC',
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL
);

CREATE TABLE event_types (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    description TEXT,
    duration_minutes INTEGER NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
    UNIQUE(user_id, slug)
);

CREATE TABLE availability_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    day_of_week INTEGER NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

CREATE TABLE bookings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    event_type_id INTEGER NOT NULL,
    guest_name TEXT NOT NULL,
    guest_email TEXT NOT NULL,
    start_at TEXT NOT NULL,
    end_at TEXT NOT NULL,
    timezone TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'confirmed',
    notes TEXT,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (event_type_id) REFERENCES event_types(id)
);

CREATE INDEX idx_event_types_user_id ON event_types(user_id);
CREATE INDEX idx_availability_rules_user_id ON availability_rules(user_id);
CREATE INDEX idx_availability_rules_user_day ON availability_rules(user_id, day_of_week);
CREATE INDEX idx_bookings_user_id ON bookings(user_id);
CREATE INDEX idx_bookings_event_type_id ON bookings(event_type_id);
CREATE INDEX idx_bookings_start_at ON bookings(start_at);
CREATE INDEX idx_bookings_user_start ON bookings(user_id, start_at);

CREATE UNIQUE INDEX idx_bookings_unique_confirmed_start
ON bookings(user_id, start_at)
WHERE status = 'confirmed';
```

- [ ] **Step 3: Teach Vitest to read the migrations**

Add to `vitest.config.ts`, above `export default`:

```ts
import { readD1Migrations } from "@cloudflare/vitest-pool-workers/config";
import path from "node:path";

const migrations = await readD1Migrations(path.join(__dirname, "migrations"));
```

and add `TEST_MIGRATIONS: migrations` to the `miniflare.bindings` object.

- [ ] **Step 4: Add a global test setup that applies migrations**

Create `test/setup.ts`:

```ts
import { applyD1Migrations, env } from "cloudflare:test";

await applyD1Migrations(env.DB, env.TEST_MIGRATIONS);
```

Add `setupFiles: ["./test/setup.ts"]` to the `test` block in `vitest.config.ts`.

- [ ] **Step 5: Write the failing schema test**

`test/integration/schema.test.ts`:

```ts
import { env } from "cloudflare:test";
import { describe, expect, it } from "vitest";

describe("schema", () => {
  it("creates the four core tables", async () => {
    const { results } = await env.DB.prepare(
      "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name",
    ).all<{ name: string }>();
    const names = results.map((r) => r.name);
    expect(names).toEqual(expect.arrayContaining([
      "availability_rules", "bookings", "event_types", "users",
    ]));
  });

  it("enforces the confirmed-start unique index", async () => {
    const now = "2026-09-13T00:00:00Z";
    await env.DB.prepare(
      `INSERT INTO users (id,name,email,password_hash,slug,timezone,created_at,updated_at)
       VALUES (900,'U','u900@example.com','x','u900','UTC',?,?)`,
    ).bind(now, now).run();
    await env.DB.prepare(
      `INSERT INTO event_types (id,user_id,name,slug,duration_minutes,is_active,created_at,updated_at)
       VALUES (900,900,'E','e',30,1,?,?)`,
    ).bind(now, now).run();

    const insert = (endAt: string) =>
      env.DB.prepare(
        `INSERT INTO bookings (user_id,event_type_id,guest_name,guest_email,start_at,end_at,timezone,status,created_at,updated_at)
         VALUES (900,900,'G','g@example.com','2026-10-01T01:00:00Z',?, 'UTC','confirmed',?,?)`,
      ).bind(endAt, now, now).run();

    await insert("2026-10-01T01:30:00Z");
    await expect(insert("2026-10-01T02:00:00Z")).rejects.toThrow();
  });
});
```

- [ ] **Step 6: Run the test**

Run: `npm test -- schema`
Expected: both tests PASS.

- [ ] **Step 7: Apply the migration locally**

Run: `npm run db:migrate:local`
Expected: `🚣 1 migration(s) applied`.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(db): add initial D1 schema, indexes and migration test harness"
```

---

## Phase 2 — Core engine (pure, no DB)

### Task 3: Fixed-width UTC timestamps

**Files:**
- Create: `src/lib/time.ts`
- Create: `test/unit/time.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { isoUtc, parseIsoUtc } from "../../src/lib/time";

describe("isoUtc", () => {
  it("formats without milliseconds", () => {
    expect(isoUtc(new Date(Date.UTC(2026, 8, 21, 1, 0, 0, 456)))).toBe("2026-09-21T01:00:00Z");
  });

  it("round-trips", () => {
    const s = "2026-09-21T01:30:00Z";
    expect(isoUtc(parseIsoUtc(s))).toBe(s);
  });

  it("sorts lexicographically in chronological order", () => {
    const a = isoUtc(new Date(Date.UTC(2026, 8, 21, 9, 0)));
    const b = isoUtc(new Date(Date.UTC(2026, 8, 21, 10, 0)));
    expect(a < b).toBe(true);
  });

  it("rejects malformed input", () => {
    expect(() => parseIsoUtc("2026-09-21 01:00")).toThrow("Invalid UTC timestamp");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- time`
Expected: FAIL — `Failed to resolve import "../../src/lib/time"`.

- [ ] **Step 3: Implement `src/lib/time.ts`**

```ts
const ISO_UTC = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/;

/** Fixed-width UTC string: YYYY-MM-DDTHH:MM:SSZ (no millis, so TEXT sort == time sort). */
export function isoUtc(date: Date): string {
  return `${date.toISOString().slice(0, 19)}Z`;
}

export function nowIso(): string {
  return isoUtc(new Date());
}

export function parseIsoUtc(value: string): Date {
  if (!ISO_UTC.test(value)) {
    throw new Error(`Invalid UTC timestamp: ${value}`);
  }
  return new Date(value);
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60_000);
}
```

- [ ] **Step 4: Run the test again**

Run: `npm test -- time`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/time.ts test/unit/time.test.ts
git commit -m "feat(lib): add fixed-width UTC timestamp helpers"
```

---

### Task 4: Timezone conversion

**Files:**
- Create: `src/lib/timezone.ts`
- Create: `test/unit/timezone.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { isValidTimeZone, tzOffsetMinutes, utcToZonedParts, zonedToUtc } from "../../src/lib/timezone";
import { isoUtc } from "../../src/lib/time";

describe("timezone", () => {
  it("computes a fixed offset zone", () => {
    const d = new Date("2026-09-21T00:00:00Z");
    expect(tzOffsetMinutes(d, "Asia/Kuala_Lumpur")).toBe(480);
  });

  it("computes DST offsets for London", () => {
    expect(tzOffsetMinutes(new Date("2026-07-01T12:00:00Z"), "Europe/London")).toBe(60);
    expect(tzOffsetMinutes(new Date("2026-01-01T12:00:00Z"), "Europe/London")).toBe(0);
  });

  it("converts a local wall time to UTC", () => {
    // 09:00 in Kuala Lumpur (UTC+8) == 01:00Z
    expect(isoUtc(zonedToUtc("2026-09-21", "09:00", "Asia/Kuala_Lumpur")))
      .toBe("2026-09-21T01:00:00Z");
  });

  it("converts across a DST boundary in New York", () => {
    // 2026-03-08 is the US spring-forward date; 09:00 EDT == 13:00Z
    expect(isoUtc(zonedToUtc("2026-03-08", "09:00", "America/New_York")))
      .toBe("2026-03-08T13:00:00Z");
    // the day before is still EST; 09:00 EST == 14:00Z
    expect(isoUtc(zonedToUtc("2026-03-07", "09:00", "America/New_York")))
      .toBe("2026-03-07T14:00:00Z");
  });

  it("renders a UTC instant back into zoned parts", () => {
    expect(utcToZonedParts(new Date("2026-09-21T01:00:00Z"), "Asia/Kuala_Lumpur"))
      .toEqual({ year: 2026, month: 9, day: 21, hour: 9, minute: 0, second: 0 });
  });

  it("validates IANA identifiers", () => {
    expect(isValidTimeZone("Asia/Kuala_Lumpur")).toBe(true);
    expect(isValidTimeZone("Mars/Olympus")).toBe(false);
    expect(isValidTimeZone("UTC+8")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- timezone`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/timezone.ts`**

```ts
export interface ZonedParts {
  year: number;
  month: number;
  day: number;
  hour: number;
  minute: number;
  second: number;
}

const formatterCache = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string): Intl.DateTimeFormat {
  let fmt = formatterCache.get(timeZone);
  if (!fmt) {
    fmt = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hour12: false,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    formatterCache.set(timeZone, fmt);
  }
  return fmt;
}

export function isValidTimeZone(timeZone: string): boolean {
  if (!timeZone.includes("/") && timeZone !== "UTC") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone });
    return true;
  } catch {
    return false;
  }
}

/** Wall-clock fields of `instant` as seen in `timeZone`. */
export function utcToZonedParts(instant: Date, timeZone: string): ZonedParts {
  const parts = formatterFor(timeZone).formatToParts(instant);
  const get = (type: Intl.DateTimeFormatPartTypes): number => {
    const part = parts.find((p) => p.type === type);
    if (!part) throw new Error(`Missing ${type} for ${timeZone}`);
    return Number(part.value);
  };
  return {
    year: get("year"),
    month: get("month"),
    day: get("day"),
    hour: get("hour") % 24, // ICU can emit "24" for midnight under hour12:false
    minute: get("minute"),
    second: get("second"),
  };
}

/** Offset of `timeZone` from UTC, in minutes, at `instant` (DST-aware). */
export function tzOffsetMinutes(instant: Date, timeZone: string): number {
  const p = utcToZonedParts(instant, timeZone);
  const asIfUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute, p.second);
  const instantSeconds = Math.floor(instant.getTime() / 1000) * 1000;
  return (asIfUtc - instantSeconds) / 60_000;
}

/**
 * Convert a local wall time in `timeZone` to the corresponding UTC instant.
 * Two-pass: guess with the offset at the naive instant, then correct using the
 * offset at the candidate instant. This resolves DST transitions.
 */
export function zonedToUtc(dateYmd: string, timeHm: string, timeZone: string): Date {
  const dm = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateYmd);
  const tm = /^(\d{2}):(\d{2})$/.exec(timeHm);
  if (!dm || !tm) throw new Error(`Invalid local datetime: ${dateYmd} ${timeHm}`);

  const naive = Date.UTC(
    Number(dm[1]), Number(dm[2]) - 1, Number(dm[3]),
    Number(tm[1]), Number(tm[2]), 0,
  );

  const firstOffset = tzOffsetMinutes(new Date(naive), timeZone);
  let candidate = naive - firstOffset * 60_000;
  const secondOffset = tzOffsetMinutes(new Date(candidate), timeZone);
  if (secondOffset !== firstOffset) {
    candidate = naive - secondOffset * 60_000;
  }
  return new Date(candidate);
}

/** Day of week (0=Sunday) of `dateYmd` — calendar arithmetic, timezone independent. */
export function dayOfWeek(dateYmd: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateYmd);
  if (!m) throw new Error(`Invalid date: ${dateYmd}`);
  return new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]))).getUTCDay();
}

/** The YYYY-MM-DD calendar date `instant` falls on inside `timeZone`. */
export function zonedDateString(instant: Date, timeZone: string): string {
  const p = utcToZonedParts(instant, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)}`;
}

/** HH:MM of `instant` inside `timeZone`. */
export function zonedTimeString(instant: Date, timeZone: string): string {
  const p = utcToZonedParts(instant, timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(p.hour)}:${pad(p.minute)}`;
}
```

- [ ] **Step 4: Run the test again**

Run: `npm test -- timezone`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/timezone.ts test/unit/timezone.test.ts
git commit -m "feat(lib): add DST-aware timezone conversion using Intl"
```

---

### Task 5: Slot generation

**Files:**
- Create: `src/lib/slots.ts`
- Create: `test/unit/slots.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { generateSlotStarts, removeBusy, toMinutes } from "../../src/lib/slots";

describe("generateSlotStarts", () => {
  it("fits whole events only (PRD §11)", () => {
    expect(generateSlotStarts([{ start: toMinutes("09:00"), end: toMinutes("11:00") }], 30))
      .toEqual([540, 570, 600, 630]); // 09:00 09:30 10:00 10:30
  });

  it("drops a trailing partial window", () => {
    expect(generateSlotStarts([{ start: toMinutes("09:00"), end: toMinutes("10:20") }], 30))
      .toEqual([540, 570]); // 09:00 09:30 — 10:00 would end 10:30 > 10:20
  });

  it("handles two windows on one day", () => {
    const windows = [
      { start: toMinutes("09:00"), end: toMinutes("10:00") },
      { start: toMinutes("14:00"), end: toMinutes("15:00") },
    ];
    expect(generateSlotStarts(windows, 30)).toEqual([540, 570, 840, 870]);
  });

  it("merges duplicates and sorts", () => {
    const windows = [
      { start: toMinutes("14:00"), end: toMinutes("15:00") },
      { start: toMinutes("14:00"), end: toMinutes("15:00") },
    ];
    expect(generateSlotStarts(windows, 60)).toEqual([840]);
  });

  it("returns nothing when the window is shorter than the event", () => {
    expect(generateSlotStarts([{ start: 540, end: 560 }], 30)).toEqual([]);
  });
});

describe("removeBusy", () => {
  const slot = (startMs: number) => ({ startMs, endMs: startMs + 30 * 60_000 });

  it("removes a slot overlapping a booking", () => {
    const slots = [slot(0), slot(1_800_000), slot(3_600_000)];
    const busy = [{ startMs: 1_800_000, endMs: 3_600_000 }];
    expect(removeBusy(slots, busy)).toEqual([slot(0), slot(3_600_000)]);
  });

  it("keeps slots that only touch at the boundary", () => {
    const slots = [slot(0)];
    const busy = [{ startMs: 1_800_000, endMs: 3_600_000 }];
    expect(removeBusy(slots, busy)).toEqual([slot(0)]);
  });

  it("removes a slot straddled by a longer booking", () => {
    const slots = [slot(1_800_000)];
    const busy = [{ startMs: 0, endMs: 5_400_000 }];
    expect(removeBusy(slots, busy)).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- slots`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/slots.ts`**

```ts
export interface MinuteWindow {
  /** Minutes from local midnight, inclusive. */
  start: number;
  /** Minutes from local midnight, exclusive. */
  end: number;
}

export interface Interval {
  startMs: number;
  endMs: number;
}

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

export function toMinutes(hhmm: string): number {
  const m = HHMM.exec(hhmm);
  if (!m) throw new Error(`Invalid HH:MM: ${hhmm}`);
  return Number(m[1]) * 60 + Number(m[2]);
}

export function toHhmm(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
}

/**
 * Start times (minutes from local midnight) for every event that fits entirely
 * inside one of `windows`. Step size equals the event duration (PRD §11).
 */
export function generateSlotStarts(windows: MinuteWindow[], durationMinutes: number): number[] {
  if (durationMinutes <= 0) throw new Error("durationMinutes must be positive");
  const starts = new Set<number>();
  for (const w of windows) {
    for (let t = w.start; t + durationMinutes <= w.end; t += durationMinutes) {
      starts.add(t);
    }
  }
  return [...starts].sort((a, b) => a - b);
}

/** Half-open overlap: [aStart,aEnd) intersects [bStart,bEnd). */
export function overlaps(a: Interval, b: Interval): boolean {
  return a.startMs < b.endMs && a.endMs > b.startMs;
}

export function removeBusy(slots: Interval[], busy: Interval[]): Interval[] {
  return slots.filter((slot) => !busy.some((b) => overlaps(slot, b)));
}

export function removePast(slots: Interval[], nowMs: number): Interval[] {
  return slots.filter((slot) => slot.startMs >= nowMs);
}
```

- [ ] **Step 4: Run the test again**

Run: `npm test -- slots`
Expected: 8 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/slots.ts test/unit/slots.test.ts
git commit -m "feat(lib): add pure slot generation and busy/past filtering"
```

---

### Task 6: Password hashing

**Files:**
- Create: `src/lib/password.ts`
- Create: `test/unit/password.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { hashPassword, verifyPassword } from "../../src/lib/password";

describe("password", () => {
  it("produces a self-describing hash string", async () => {
    const hash = await hashPassword("correct horse battery staple");
    expect(hash.startsWith("pbkdf2$100000$")).toBe(true);
    expect(hash.split("$")).toHaveLength(4);
  });

  it("uses a fresh salt each time", async () => {
    const a = await hashPassword("same");
    const b = await hashPassword("same");
    expect(a).not.toBe(b);
  });

  it("verifies the right password", async () => {
    const hash = await hashPassword("s3cret-pass");
    expect(await verifyPassword("s3cret-pass", hash)).toBe(true);
  });

  it("rejects the wrong password", async () => {
    const hash = await hashPassword("s3cret-pass");
    expect(await verifyPassword("s3cret-pas", hash)).toBe(false);
  });

  it("rejects a malformed hash instead of throwing", async () => {
    expect(await verifyPassword("x", "not-a-hash")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- password`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/password.ts`**

```ts
const ITERATIONS = 100_000;
const KEY_BITS = 256;
const SALT_BYTES = 16;

function toBase64(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes));
}

function fromBase64(value: string): Uint8Array {
  return Uint8Array.from(atob(value), (c) => c.charCodeAt(0));
}

async function derive(password: string, salt: Uint8Array, iterations: number): Promise<Uint8Array> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(password),
    "PBKDF2",
    false,
    ["deriveBits"],
  );
  const bits = await crypto.subtle.deriveBits(
    { name: "PBKDF2", hash: "SHA-256", salt, iterations },
    key,
    KEY_BITS,
  );
  return new Uint8Array(bits);
}

/** Returns `pbkdf2$<iterations>$<saltB64>$<hashB64>`. */
export async function hashPassword(password: string): Promise<string> {
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const hash = await derive(password, salt, ITERATIONS);
  return `pbkdf2$${ITERATIONS}$${toBase64(salt)}$${toBase64(hash)}`;
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 4 || parts[0] !== "pbkdf2") return false;
  const iterations = Number(parts[1]);
  if (!Number.isInteger(iterations) || iterations <= 0) return false;

  let salt: Uint8Array;
  let expected: Uint8Array;
  try {
    salt = fromBase64(parts[2]!);
    expected = fromBase64(parts[3]!);
  } catch {
    return false;
  }

  const actual = await derive(password, salt, iterations);
  return timingSafeEqual(actual, expected);
}

function timingSafeEqual(a: Uint8Array, b: Uint8Array): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) diff |= a[i]! ^ b[i]!;
  return diff === 0;
}
```

- [ ] **Step 4: Run the test again**

Run: `npm test -- password`
Expected: 5 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/password.ts test/unit/password.test.ts
git commit -m "feat(lib): add PBKDF2 password hashing via Web Crypto"
```

---

### Task 7: Session tokens

**Files:**
- Create: `src/lib/session.ts`
- Create: `test/unit/session.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { SESSION_COOKIE, signSession, verifySession } from "../../src/lib/session";

const SECRET = "unit-test-secret";

describe("session", () => {
  it("names the cookie", () => {
    expect(SESSION_COOKIE).toBe("mf_session");
  });

  it("round-trips a user id", async () => {
    const token = await signSession(7, SECRET, 3600, 1_000_000);
    expect(await verifySession(token, SECRET, 1_000_100)).toBe(7);
  });

  it("rejects an expired token", async () => {
    const token = await signSession(7, SECRET, 60, 1_000_000);
    expect(await verifySession(token, SECRET, 1_000_000 + 61_000)).toBeNull();
  });

  it("rejects a tampered payload", async () => {
    const token = await signSession(7, SECRET, 3600, 1_000_000);
    const [payload, sig] = token.split(".");
    const forged = `${btoa("9999.99999999999").replace(/=+$/, "")}.${sig}`;
    expect(forged).not.toBe(token);
    expect(await verifySession(forged, SECRET, 1_000_100)).toBeNull();
    expect(payload).toBeTruthy();
  });

  it("rejects a token signed with another secret", async () => {
    const token = await signSession(7, "other-secret", 3600, 1_000_000);
    expect(await verifySession(token, SECRET, 1_000_100)).toBeNull();
  });

  it("rejects garbage", async () => {
    expect(await verifySession("garbage", SECRET, 1_000_100)).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- session`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/session.ts`**

```ts
export const SESSION_COOKIE = "mf_session";
export const SESSION_TTL_SECONDS = 60 * 60 * 24 * 30; // 30 days

function b64urlEncode(bytes: Uint8Array): string {
  return btoa(String.fromCharCode(...bytes)).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function b64urlDecode(value: string): Uint8Array {
  const padded = value.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(value.length / 4) * 4, "=");
  return Uint8Array.from(atob(padded), (c) => c.charCodeAt(0));
}

async function hmacKey(secret: string): Promise<CryptoKey> {
  return crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign", "verify"],
  );
}

/** Token format: base64url("<userId>.<expiresAtMs>") + "." + base64url(HMAC) */
export async function signSession(
  userId: number,
  secret: string,
  ttlSeconds: number = SESSION_TTL_SECONDS,
  nowMs: number = Date.now(),
): Promise<string> {
  const payload = `${userId}.${nowMs + ttlSeconds * 1000}`;
  const encoded = b64urlEncode(new TextEncoder().encode(payload));
  const sig = await crypto.subtle.sign("HMAC", await hmacKey(secret), new TextEncoder().encode(encoded));
  return `${encoded}.${b64urlEncode(new Uint8Array(sig))}`;
}

export async function verifySession(
  token: string,
  secret: string,
  nowMs: number = Date.now(),
): Promise<number | null> {
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const encoded = token.slice(0, dot);
  const sigPart = token.slice(dot + 1);

  let sig: Uint8Array;
  try {
    sig = b64urlDecode(sigPart);
  } catch {
    return null;
  }

  const ok = await crypto.subtle.verify(
    "HMAC",
    await hmacKey(secret),
    sig,
    new TextEncoder().encode(encoded),
  );
  if (!ok) return null;

  let payload: string;
  try {
    payload = new TextDecoder().decode(b64urlDecode(encoded));
  } catch {
    return null;
  }

  const [idPart, expPart] = payload.split(".");
  const userId = Number(idPart);
  const expiresAt = Number(expPart);
  if (!Number.isInteger(userId) || userId <= 0 || !Number.isFinite(expiresAt)) return null;
  if (nowMs >= expiresAt) return null;
  return userId;
}
```

- [ ] **Step 4: Run the test again**

Run: `npm test -- session`
Expected: 6 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/session.ts test/unit/session.test.ts
git commit -m "feat(lib): add HMAC-signed stateless session tokens"
```

---

### Task 8: Input validation helpers

**Files:**
- Create: `src/lib/validate.ts`
- Create: `test/unit/validate.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { describe, expect, it } from "vitest";
import { isEmail, isHhmm, isSlug, isYmd, RESERVED_SLUGS } from "../../src/lib/validate";

describe("validate", () => {
  it("accepts sane slugs", () => {
    expect(isSlug("wan")).toBe(true);
    expect(isSlug("wan-mafendi")).toBe(true);
  });

  it("rejects bad slugs", () => {
    expect(isSlug("Wan")).toBe(false);
    expect(isSlug("a")).toBe(false);
    expect(isSlug("wan_mafendi")).toBe(false);
    expect(isSlug("-wan")).toBe(false);
  });

  it("blocks reserved slugs", () => {
    expect(RESERVED_SLUGS.has("api")).toBe(true);
    expect(RESERVED_SLUGS.has("dashboard")).toBe(true);
  });

  it("checks emails, times and dates", () => {
    expect(isEmail("wan@example.com")).toBe(true);
    expect(isEmail("wan@")).toBe(false);
    expect(isHhmm("09:00")).toBe(true);
    expect(isHhmm("24:00")).toBe(false);
    expect(isYmd("2026-09-21")).toBe(true);
    expect(isYmd("2026-9-21")).toBe(false);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- validate`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/lib/validate.ts`**

```ts
export const RESERVED_SLUGS = new Set([
  "api", "dashboard", "login", "logout", "register", "booking", "bookings",
  "public", "assets", "static", "admin", "settings", "healthz", "app",
]);

const SLUG = /^[a-z0-9](?:[a-z0-9-]{1,30}[a-z0-9])$/;
const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const YMD = /^\d{4}-\d{2}-\d{2}$/;

export function isSlug(value: string): boolean {
  return SLUG.test(value);
}

export function isAvailableSlug(value: string): boolean {
  return isSlug(value) && !RESERVED_SLUGS.has(value);
}

export function isEmail(value: string): boolean {
  return EMAIL.test(value) && value.length <= 254;
}

export function isHhmm(value: string): boolean {
  return HHMM.test(value);
}

export function isYmd(value: string): boolean {
  if (!YMD.test(value)) return false;
  const d = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === value;
}

export class ValidationError extends Error {
  constructor(public readonly field: string, message: string) {
    super(message);
    this.name = "ValidationError";
  }
}

export function requireString(
  body: Record<string, unknown>,
  field: string,
  { min = 1, max = 255 }: { min?: number; max?: number } = {},
): string {
  const raw = body[field];
  if (typeof raw !== "string") throw new ValidationError(field, `${field} is required`);
  const value = raw.trim();
  if (value.length < min) throw new ValidationError(field, `${field} is too short`);
  if (value.length > max) throw new ValidationError(field, `${field} is too long`);
  return value;
}

export function optionalString(
  body: Record<string, unknown>,
  field: string,
  max = 2000,
): string | null {
  const raw = body[field];
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string") throw new ValidationError(field, `${field} must be text`);
  const value = raw.trim();
  if (value.length > max) throw new ValidationError(field, `${field} is too long`);
  return value || null;
}

export function requireInt(
  body: Record<string, unknown>,
  field: string,
  { min, max }: { min: number; max: number },
): number {
  const value = Number(body[field]);
  if (!Number.isInteger(value)) throw new ValidationError(field, `${field} must be a whole number`);
  if (value < min || value > max) throw new ValidationError(field, `${field} is out of range`);
  return value;
}
```

- [ ] **Step 4: Run the test again**

Run: `npm test -- validate`
Expected: 4 passed.

- [ ] **Step 5: Commit**

```bash
git add src/lib/validate.ts test/unit/validate.test.ts
git commit -m "feat(lib): add input validation helpers"
```

---

## Phase 3 — Data access and auth

### Task 9: User repository and auth service

**Files:**
- Create: `src/db/users.ts`
- Create: `src/services/auth.ts`
- Create: `test/integration/auth.service.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { login, register } from "../../src/services/auth";

async function reset() {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM bookings"),
    env.DB.prepare("DELETE FROM availability_rules"),
    env.DB.prepare("DELETE FROM event_types"),
    env.DB.prepare("DELETE FROM users"),
  ]);
}

const input = {
  name: "Wan",
  email: "Wan@Example.com",
  password: "hunter2hunter2",
  slug: "wan",
  timezone: "Asia/Kuala_Lumpur",
};

describe("auth service", () => {
  beforeEach(reset);

  it("registers a host and lowercases the email", async () => {
    const user = await register(env.DB, input);
    expect(user.email).toBe("wan@example.com");
    expect(user.slug).toBe("wan");
    expect(user).not.toHaveProperty("password_hash");
  });

  it("rejects a duplicate email", async () => {
    await register(env.DB, input);
    await expect(register(env.DB, { ...input, slug: "wan2" }))
      .rejects.toThrow("Email already registered");
  });

  it("rejects a duplicate slug", async () => {
    await register(env.DB, input);
    await expect(register(env.DB, { ...input, email: "other@example.com" }))
      .rejects.toThrow("Username already taken");
  });

  it("rejects a reserved slug", async () => {
    await expect(register(env.DB, { ...input, slug: "dashboard" }))
      .rejects.toThrow("Username already taken");
  });

  it("rejects an invalid timezone", async () => {
    await expect(register(env.DB, { ...input, timezone: "Mars/Olympus" }))
      .rejects.toThrow("Invalid timezone");
  });

  it("logs in with the right password", async () => {
    await register(env.DB, input);
    const user = await login(env.DB, "wan@example.com", "hunter2hunter2");
    expect(user?.slug).toBe("wan");
  });

  it("returns null for a wrong password", async () => {
    await register(env.DB, input);
    expect(await login(env.DB, "wan@example.com", "wrong")).toBeNull();
  });

  it("returns null for an unknown email", async () => {
    expect(await login(env.DB, "nobody@example.com", "hunter2hunter2")).toBeNull();
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- auth.service`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/db/users.ts`**

```ts
import type { PublicUser, UserRow } from "../types";

const PUBLIC_COLUMNS = "id, name, email, slug, timezone, created_at, updated_at";

export async function findUserByEmail(db: D1Database, email: string): Promise<UserRow | null> {
  return db.prepare("SELECT * FROM users WHERE email = ?").bind(email).first<UserRow>();
}

export async function findUserById(db: D1Database, id: number): Promise<PublicUser | null> {
  return db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE id = ?`).bind(id).first<PublicUser>();
}

export async function findUserBySlug(db: D1Database, slug: string): Promise<PublicUser | null> {
  return db.prepare(`SELECT ${PUBLIC_COLUMNS} FROM users WHERE slug = ?`).bind(slug).first<PublicUser>();
}

export interface InsertUserInput {
  name: string;
  email: string;
  passwordHash: string;
  slug: string;
  timezone: string;
  now: string;
}

export async function insertUser(db: D1Database, input: InsertUserInput): Promise<PublicUser> {
  const row = await db
    .prepare(
      `INSERT INTO users (name, email, password_hash, slug, timezone, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)
       RETURNING ${PUBLIC_COLUMNS}`,
    )
    .bind(input.name, input.email, input.passwordHash, input.slug, input.timezone, input.now, input.now)
    .first<PublicUser>();
  if (!row) throw new Error("Failed to insert user");
  return row;
}

export async function updateUserSettings(
  db: D1Database,
  userId: number,
  fields: { name: string; timezone: string; now: string },
): Promise<PublicUser | null> {
  return db
    .prepare(
      `UPDATE users SET name = ?, timezone = ?, updated_at = ?
       WHERE id = ?
       RETURNING ${PUBLIC_COLUMNS}`,
    )
    .bind(fields.name, fields.timezone, fields.now, userId)
    .first<PublicUser>();
}
```

- [ ] **Step 4: Implement `src/services/auth.ts`**

```ts
import { findUserByEmail, insertUser } from "../db/users";
import { hashPassword, verifyPassword } from "../lib/password";
import { nowIso } from "../lib/time";
import { isValidTimeZone } from "../lib/timezone";
import { isAvailableSlug, isEmail } from "../lib/validate";
import type { PublicUser } from "../types";

export class AuthError extends Error {
  constructor(message: string, public readonly status = 400) {
    super(message);
    this.name = "AuthError";
  }
}

export interface RegisterInput {
  name: string;
  email: string;
  password: string;
  slug: string;
  timezone: string;
}

export async function register(db: D1Database, input: RegisterInput): Promise<PublicUser> {
  const email = input.email.trim().toLowerCase();
  const slug = input.slug.trim().toLowerCase();

  if (!isEmail(email)) throw new AuthError("Invalid email");
  if (!isAvailableSlug(slug)) throw new AuthError("Username already taken", 409);
  if (input.password.length < 8) throw new AuthError("Password must be at least 8 characters");
  if (!isValidTimeZone(input.timezone)) throw new AuthError("Invalid timezone");

  const passwordHash = await hashPassword(input.password);

  try {
    return await insertUser(db, {
      name: input.name.trim(),
      email,
      passwordHash,
      slug,
      timezone: input.timezone,
      now: nowIso(),
    });
  } catch (err) {
    const message = String(err);
    if (message.includes("users.email")) throw new AuthError("Email already registered", 409);
    if (message.includes("users.slug")) throw new AuthError("Username already taken", 409);
    throw err;
  }
}

export async function login(
  db: D1Database,
  email: string,
  password: string,
): Promise<PublicUser | null> {
  const row = await findUserByEmail(db, email.trim().toLowerCase());
  if (!row) {
    // Equalise timing so a missing account is not distinguishable from a bad password.
    await verifyPassword(password, "pbkdf2$100000$AAAAAAAAAAAAAAAAAAAAAA==$AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=");
    return null;
  }
  if (!(await verifyPassword(password, row.password_hash))) return null;

  const { password_hash: _ignored, ...publicUser } = row;
  return publicUser;
}
```

- [ ] **Step 5: Run the test again**

Run: `npm test -- auth.service`
Expected: 8 passed.

- [ ] **Step 6: Commit**

```bash
git add src/db/users.ts src/services/auth.ts test/integration/auth.service.test.ts
git commit -m "feat(auth): add user repository and register/login service"
```

---

### Task 10: Auth routes and middleware

**Files:**
- Create: `src/middleware/auth.ts`
- Create: `src/routes/api.auth.ts`
- Modify: `src/index.ts`
- Create: `test/integration/auth.api.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { SELF } from "cloudflare:test";
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";

async function reset() {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM bookings"),
    env.DB.prepare("DELETE FROM availability_rules"),
    env.DB.prepare("DELETE FROM event_types"),
    env.DB.prepare("DELETE FROM users"),
  ]);
}

const body = {
  name: "Wan",
  email: "wan@example.com",
  password: "hunter2hunter2",
  slug: "wan",
  timezone: "Asia/Kuala_Lumpur",
};

function post(path: string, json: unknown, cookie?: string) {
  return SELF.fetch(`https://example.com${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(cookie ? { cookie } : {}) },
    body: JSON.stringify(json),
  });
}

describe("auth api", () => {
  beforeEach(reset);

  it("registers and sets an HttpOnly session cookie", async () => {
    const res = await post("/api/auth/register", body);
    expect(res.status).toBe(201);
    const setCookie = res.headers.get("set-cookie") ?? "";
    expect(setCookie).toContain("mf_session=");
    expect(setCookie).toContain("HttpOnly");
    expect(setCookie).toContain("SameSite=Lax");
    expect(await res.json()).toMatchObject({ user: { slug: "wan" } });
  });

  it("never returns the password hash", async () => {
    const res = await post("/api/auth/register", body);
    expect(JSON.stringify(await res.json())).not.toContain("pbkdf2");
  });

  it("rejects a duplicate email with 409", async () => {
    await post("/api/auth/register", body);
    const res = await post("/api/auth/register", { ...body, slug: "wan2" });
    expect(res.status).toBe(409);
  });

  it("logs in and returns the user", async () => {
    await post("/api/auth/register", body);
    const res = await post("/api/auth/login", { email: body.email, password: body.password });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ user: { email: "wan@example.com" } });
  });

  it("returns 401 for a bad password", async () => {
    await post("/api/auth/register", body);
    const res = await post("/api/auth/login", { email: body.email, password: "nope" });
    expect(res.status).toBe(401);
  });

  it("clears the cookie on logout", async () => {
    const res = await post("/api/auth/logout", {});
    expect(res.status).toBe(200);
    expect(res.headers.get("set-cookie")).toContain("Max-Age=0");
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- auth.api`
Expected: FAIL — 404 from the Worker.

- [ ] **Step 3: Implement `src/middleware/auth.ts`**

```ts
import { getCookie, setCookie } from "hono/cookie";
import { createMiddleware } from "hono/factory";
import { findUserById } from "../db/users";
import { SESSION_COOKIE, SESSION_TTL_SECONDS, signSession, verifySession } from "../lib/session";
import type { AppEnv } from "../types";
import type { Context } from "hono";

export async function issueSession(c: Context<AppEnv>, userId: number): Promise<void> {
  const token = await signSession(userId, c.env.SESSION_SECRET);
  setCookie(c, SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: SESSION_TTL_SECONDS,
  });
}

export function clearSession(c: Context<AppEnv>): void {
  setCookie(c, SESSION_COOKIE, "", {
    httpOnly: true,
    secure: true,
    sameSite: "Lax",
    path: "/",
    maxAge: 0,
  });
}

/** Populates c.var.user when a valid cookie is present. Never rejects. */
export const loadUser = createMiddleware<AppEnv>(async (c, next) => {
  const token = getCookie(c, SESSION_COOKIE);
  if (token) {
    const userId = await verifySession(token, c.env.SESSION_SECRET);
    if (userId) {
      const user = await findUserById(c.env.DB, userId);
      if (user) c.set("user", user);
    }
  }
  await next();
});

/** 401 for API routes when there is no session. Must run after loadUser. */
export const requireAuth = createMiddleware<AppEnv>(async (c, next) => {
  if (!c.get("user")) return c.json({ error: "Unauthorized" }, 401);
  await next();
});
```

- [ ] **Step 4: Implement `src/routes/api.auth.ts`**

```ts
import { Hono } from "hono";
import { clearSession, issueSession } from "../middleware/auth";
import { AuthError, login, register } from "../services/auth";
import type { AppEnv } from "../types";

export const authRoutes = new Hono<AppEnv>();

authRoutes.post("/register", async (c) => {
  const body = await c.req.json<Record<string, string>>().catch(() => ({}) as Record<string, string>);
  try {
    const user = await register(c.env.DB, {
      name: body.name ?? "",
      email: body.email ?? "",
      password: body.password ?? "",
      slug: body.slug ?? "",
      timezone: body.timezone ?? "UTC",
    });
    await issueSession(c, user.id);
    return c.json({ user }, 201);
  } catch (err) {
    if (err instanceof AuthError) return c.json({ error: err.message }, err.status as 400);
    throw err;
  }
});

authRoutes.post("/login", async (c) => {
  const body = await c.req.json<Record<string, string>>().catch(() => ({}) as Record<string, string>);
  const user = await login(c.env.DB, body.email ?? "", body.password ?? "");
  if (!user) return c.json({ error: "Invalid email or password" }, 401);
  await issueSession(c, user.id);
  return c.json({ user });
});

authRoutes.post("/logout", (c) => {
  clearSession(c);
  return c.json({ ok: true });
});
```

- [ ] **Step 5: Wire it into `src/index.ts`**

Replace `src/index.ts` with:

```ts
import { Hono } from "hono";
import { loadUser } from "./middleware/auth";
import { authRoutes } from "./routes/api.auth";
import type { AppEnv } from "./types";

const app = new Hono<AppEnv>();

app.use("*", loadUser);

app.get("/healthz", (c) => c.json({ ok: true }));
app.route("/api/auth", authRoutes);

app.onError((err, c) => {
  console.error(err);
  return c.json({ error: "Internal Server Error" }, 500);
});

export default app;
```

- [ ] **Step 6: Run the test again**

Run: `npm test -- auth.api`
Expected: 6 passed.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(auth): add register/login/logout API and session middleware"
```

---

### Task 11: Event types CRUD with ownership

**Files:**
- Create: `src/db/eventTypes.ts`
- Create: `src/routes/api.eventTypes.ts`
- Modify: `src/index.ts`
- Create: `test/integration/eventTypes.test.ts`
- Create: `test/helpers.ts`

- [ ] **Step 1: Write the shared test helper**

`test/helpers.ts`:

```ts
import { SELF, env } from "cloudflare:test";

export async function resetDb(): Promise<void> {
  await env.DB.batch([
    env.DB.prepare("DELETE FROM bookings"),
    env.DB.prepare("DELETE FROM availability_rules"),
    env.DB.prepare("DELETE FROM event_types"),
    env.DB.prepare("DELETE FROM users"),
  ]);
}

export interface TestHost {
  id: number;
  slug: string;
  cookie: string;
}

export async function createHost(
  slug: string,
  timezone = "Asia/Kuala_Lumpur",
): Promise<TestHost> {
  const res = await SELF.fetch("https://example.com/api/auth/register", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      name: slug,
      email: `${slug}@example.com`,
      password: "hunter2hunter2",
      slug,
      timezone,
    }),
  });
  if (res.status !== 201) throw new Error(`register failed: ${res.status} ${await res.text()}`);
  const { user } = await res.json<{ user: { id: number } }>();
  const raw = res.headers.get("set-cookie") ?? "";
  return { id: user.id, slug, cookie: raw.split(";")[0]! };
}

export function api(path: string, init: RequestInit & { cookie?: string } = {}): Promise<Response> {
  const { cookie, headers, ...rest } = init;
  return SELF.fetch(`https://example.com${path}`, {
    ...rest,
    headers: {
      "content-type": "application/json",
      ...(cookie ? { cookie } : {}),
      ...(headers as Record<string, string> | undefined),
    },
  });
}
```

- [ ] **Step 2: Write the failing test**

`test/integration/eventTypes.test.ts`:

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { api, createHost, resetDb } from "../helpers";

describe("event types", () => {
  beforeEach(resetDb);

  it("requires auth", async () => {
    expect((await api("/api/event-types")).status).toBe(401);
  });

  it("creates and lists an event type", async () => {
    const host = await createHost("wan");
    const created = await api("/api/event-types", {
      method: "POST",
      cookie: host.cookie,
      body: JSON.stringify({
        name: "Consultation",
        slug: "consultation",
        description: "A 30-minute consultation",
        duration_minutes: 30,
      }),
    });
    expect(created.status).toBe(201);

    const list = await api("/api/event-types", { cookie: host.cookie });
    const { eventTypes } = await list.json<{ eventTypes: Array<{ slug: string }> }>();
    expect(eventTypes).toHaveLength(1);
    expect(eventTypes[0]!.slug).toBe("consultation");
  });

  it("rejects a duplicate slug for the same host", async () => {
    const host = await createHost("wan");
    const payload = JSON.stringify({ name: "C", slug: "consultation", duration_minutes: 30 });
    await api("/api/event-types", { method: "POST", cookie: host.cookie, body: payload });
    const dup = await api("/api/event-types", { method: "POST", cookie: host.cookie, body: payload });
    expect(dup.status).toBe(409);
  });

  it("rejects an out-of-range duration", async () => {
    const host = await createHost("wan");
    const res = await api("/api/event-types", {
      method: "POST",
      cookie: host.cookie,
      body: JSON.stringify({ name: "C", slug: "c", duration_minutes: 0 }),
    });
    expect(res.status).toBe(400);
  });

  it("does not leak another host's event type", async () => {
    const wan = await createHost("wan");
    const ali = await createHost("ali");
    const created = await api("/api/event-types", {
      method: "POST",
      cookie: wan.cookie,
      body: JSON.stringify({ name: "C", slug: "c", duration_minutes: 30 }),
    });
    const { eventType } = await created.json<{ eventType: { id: number } }>();

    expect((await api(`/api/event-types/${eventType.id}`, { cookie: ali.cookie })).status).toBe(404);
    expect((await api(`/api/event-types/${eventType.id}`, {
      method: "PATCH",
      cookie: ali.cookie,
      body: JSON.stringify({ name: "Hacked" }),
    })).status).toBe(404);
    expect((await api(`/api/event-types/${eventType.id}`, {
      method: "DELETE",
      cookie: ali.cookie,
    })).status).toBe(404);
  });

  it("deactivates instead of hard-deleting when bookings exist", async () => {
    const host = await createHost("wan");
    const created = await api("/api/event-types", {
      method: "POST",
      cookie: host.cookie,
      body: JSON.stringify({ name: "C", slug: "c", duration_minutes: 30 }),
    });
    const { eventType } = await created.json<{ eventType: { id: number } }>();

    const patched = await api(`/api/event-types/${eventType.id}`, {
      method: "PATCH",
      cookie: host.cookie,
      body: JSON.stringify({ is_active: 0 }),
    });
    expect(patched.status).toBe(200);
    const { eventType: updated } = await patched.json<{ eventType: { is_active: number } }>();
    expect(updated.is_active).toBe(0);
  });
});
```

- [ ] **Step 3: Run it and watch it fail**

Run: `npm test -- eventTypes`
Expected: FAIL — routes not mounted.

- [ ] **Step 4: Implement `src/db/eventTypes.ts`**

```ts
import type { EventTypeRow } from "../types";

export async function listEventTypes(db: D1Database, userId: number): Promise<EventTypeRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM event_types WHERE user_id = ? ORDER BY created_at DESC")
    .bind(userId)
    .all<EventTypeRow>();
  return results;
}

export async function getEventTypeOwned(
  db: D1Database,
  id: number,
  userId: number,
): Promise<EventTypeRow | null> {
  return db
    .prepare("SELECT * FROM event_types WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .first<EventTypeRow>();
}

export async function getPublicEventType(
  db: D1Database,
  userId: number,
  slug: string,
): Promise<EventTypeRow | null> {
  return db
    .prepare("SELECT * FROM event_types WHERE user_id = ? AND slug = ? AND is_active = 1")
    .bind(userId, slug)
    .first<EventTypeRow>();
}

export async function listPublicEventTypes(db: D1Database, userId: number): Promise<EventTypeRow[]> {
  const { results } = await db
    .prepare("SELECT * FROM event_types WHERE user_id = ? AND is_active = 1 ORDER BY duration_minutes")
    .bind(userId)
    .all<EventTypeRow>();
  return results;
}

export interface InsertEventTypeInput {
  userId: number;
  name: string;
  slug: string;
  description: string | null;
  durationMinutes: number;
  now: string;
}

export async function insertEventType(
  db: D1Database,
  input: InsertEventTypeInput,
): Promise<EventTypeRow> {
  const row = await db
    .prepare(
      `INSERT INTO event_types (user_id, name, slug, description, duration_minutes, is_active, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, 1, ?, ?)
       RETURNING *`,
    )
    .bind(input.userId, input.name, input.slug, input.description, input.durationMinutes, input.now, input.now)
    .first<EventTypeRow>();
  if (!row) throw new Error("Failed to insert event type");
  return row;
}

export interface UpdateEventTypeInput {
  name: string;
  slug: string;
  description: string | null;
  durationMinutes: number;
  isActive: number;
  now: string;
}

export async function updateEventType(
  db: D1Database,
  id: number,
  userId: number,
  input: UpdateEventTypeInput,
): Promise<EventTypeRow | null> {
  return db
    .prepare(
      `UPDATE event_types
       SET name = ?, slug = ?, description = ?, duration_minutes = ?, is_active = ?, updated_at = ?
       WHERE id = ? AND user_id = ?
       RETURNING *`,
    )
    .bind(input.name, input.slug, input.description, input.durationMinutes, input.isActive, input.now, id, userId)
    .first<EventTypeRow>();
}

export async function deleteEventType(db: D1Database, id: number, userId: number): Promise<boolean> {
  const res = await db
    .prepare("DELETE FROM event_types WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .run();
  return (res.meta.changes ?? 0) > 0;
}

export async function countBookingsForEventType(db: D1Database, id: number): Promise<number> {
  const row = await db
    .prepare("SELECT COUNT(*) AS n FROM bookings WHERE event_type_id = ?")
    .bind(id)
    .first<{ n: number }>();
  return row?.n ?? 0;
}
```

- [ ] **Step 5: Implement `src/routes/api.eventTypes.ts`**

```ts
import { Hono } from "hono";
import {
  countBookingsForEventType,
  deleteEventType,
  getEventTypeOwned,
  insertEventType,
  listEventTypes,
  updateEventType,
} from "../db/eventTypes";
import { nowIso } from "../lib/time";
import { ValidationError, isSlug, optionalString, requireInt, requireString } from "../lib/validate";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";

export const eventTypeRoutes = new Hono<AppEnv>();

eventTypeRoutes.use("*", requireAuth);

eventTypeRoutes.get("/", async (c) => {
  const eventTypes = await listEventTypes(c.env.DB, c.get("user").id);
  return c.json({ eventTypes });
});

eventTypeRoutes.post("/", async (c) => {
  const user = c.get("user");
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  try {
    const name = requireString(body, "name", { max: 100 });
    const slug = requireString(body, "slug", { max: 60 }).toLowerCase();
    if (!isSlug(slug)) throw new ValidationError("slug", "slug must be lowercase letters, digits and dashes");
    const description = optionalString(body, "description");
    const durationMinutes = requireInt(body, "duration_minutes", { min: 5, max: 480 });

    const eventType = await insertEventType(c.env.DB, {
      userId: user.id,
      name,
      slug,
      description,
      durationMinutes,
      now: nowIso(),
    });
    return c.json({ eventType }, 201);
  } catch (err) {
    if (err instanceof ValidationError) return c.json({ error: err.message, field: err.field }, 400);
    if (String(err).includes("UNIQUE")) return c.json({ error: "You already have an event type with that URL" }, 409);
    throw err;
  }
});

eventTypeRoutes.get("/:id", async (c) => {
  const eventType = await getEventTypeOwned(c.env.DB, Number(c.req.param("id")), c.get("user").id);
  if (!eventType) return c.json({ error: "Not found" }, 404);
  return c.json({ eventType });
});

eventTypeRoutes.patch("/:id", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const current = await getEventTypeOwned(c.env.DB, id, user.id);
  if (!current) return c.json({ error: "Not found" }, 404);

  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  try {
    const merged = {
      name: body.name === undefined ? current.name : requireString(body, "name", { max: 100 }),
      slug: body.slug === undefined ? current.slug : requireString(body, "slug", { max: 60 }).toLowerCase(),
      description: body.description === undefined ? current.description : optionalString(body, "description"),
      durationMinutes:
        body.duration_minutes === undefined
          ? current.duration_minutes
          : requireInt(body, "duration_minutes", { min: 5, max: 480 }),
      isActive:
        body.is_active === undefined ? current.is_active : requireInt(body, "is_active", { min: 0, max: 1 }),
      now: nowIso(),
    };
    if (!isSlug(merged.slug)) throw new ValidationError("slug", "invalid slug");

    const eventType = await updateEventType(c.env.DB, id, user.id, merged);
    if (!eventType) return c.json({ error: "Not found" }, 404);
    return c.json({ eventType });
  } catch (err) {
    if (err instanceof ValidationError) return c.json({ error: err.message, field: err.field }, 400);
    if (String(err).includes("UNIQUE")) return c.json({ error: "You already have an event type with that URL" }, 409);
    throw err;
  }
});

eventTypeRoutes.delete("/:id", async (c) => {
  const user = c.get("user");
  const id = Number(c.req.param("id"));
  const current = await getEventTypeOwned(c.env.DB, id, user.id);
  if (!current) return c.json({ error: "Not found" }, 404);

  // ERD.md §12: never orphan historical bookings — deactivate instead.
  if ((await countBookingsForEventType(c.env.DB, id)) > 0) {
    const eventType = await updateEventType(c.env.DB, id, user.id, {
      name: current.name,
      slug: current.slug,
      description: current.description,
      durationMinutes: current.duration_minutes,
      isActive: 0,
      now: nowIso(),
    });
    return c.json({ eventType, deactivated: true });
  }

  await deleteEventType(c.env.DB, id, user.id);
  return c.json({ ok: true });
});
```

- [ ] **Step 6: Mount it in `src/index.ts`**

Add after the `/api/auth` route:

```ts
import { eventTypeRoutes } from "./routes/api.eventTypes";
// ...
app.route("/api/event-types", eventTypeRoutes);
```

- [ ] **Step 7: Run the test again**

Run: `npm test -- eventTypes`
Expected: 6 passed.

- [ ] **Step 8: Commit**

```bash
git add -A
git commit -m "feat(event-types): add CRUD API with ownership checks and safe delete"
```

---

### Task 12: Availability API

**Files:**
- Create: `src/db/availability.ts`
- Create: `src/routes/api.availability.ts`
- Modify: `src/index.ts`
- Create: `test/integration/availability.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { api, createHost, resetDb } from "../helpers";

const rules = [
  { day_of_week: 1, start_time: "09:00", end_time: "12:00" },
  { day_of_week: 1, start_time: "14:00", end_time: "17:00" },
  { day_of_week: 2, start_time: "09:00", end_time: "12:00" },
];

describe("availability", () => {
  beforeEach(resetDb);

  it("requires auth", async () => {
    expect((await api("/api/availability")).status).toBe(401);
  });

  it("starts empty", async () => {
    const host = await createHost("wan");
    const res = await api("/api/availability", { cookie: host.cookie });
    expect(await res.json()).toEqual({ rules: [] });
  });

  it("replaces the whole week on PUT", async () => {
    const host = await createHost("wan");
    await api("/api/availability", { method: "PUT", cookie: host.cookie, body: JSON.stringify({ rules }) });
    await api("/api/availability", {
      method: "PUT",
      cookie: host.cookie,
      body: JSON.stringify({ rules: [{ day_of_week: 3, start_time: "10:00", end_time: "11:00" }] }),
    });
    const res = await api("/api/availability", { cookie: host.cookie });
    const body = await res.json<{ rules: Array<{ day_of_week: number }> }>();
    expect(body.rules).toHaveLength(1);
    expect(body.rules[0]!.day_of_week).toBe(3);
  });

  it("allows two windows on the same day", async () => {
    const host = await createHost("wan");
    await api("/api/availability", { method: "PUT", cookie: host.cookie, body: JSON.stringify({ rules }) });
    const res = await api("/api/availability", { cookie: host.cookie });
    const body = await res.json<{ rules: unknown[] }>();
    expect(body.rules).toHaveLength(3);
  });

  it("rejects end before start", async () => {
    const host = await createHost("wan");
    const res = await api("/api/availability", {
      method: "PUT",
      cookie: host.cookie,
      body: JSON.stringify({ rules: [{ day_of_week: 1, start_time: "17:00", end_time: "09:00" }] }),
    });
    expect(res.status).toBe(400);
  });

  it("rejects a bad day_of_week", async () => {
    const host = await createHost("wan");
    const res = await api("/api/availability", {
      method: "PUT",
      cookie: host.cookie,
      body: JSON.stringify({ rules: [{ day_of_week: 7, start_time: "09:00", end_time: "10:00" }] }),
    });
    expect(res.status).toBe(400);
  });

  it("keeps hosts isolated", async () => {
    const wan = await createHost("wan");
    const ali = await createHost("ali");
    await api("/api/availability", { method: "PUT", cookie: wan.cookie, body: JSON.stringify({ rules }) });
    const res = await api("/api/availability", { cookie: ali.cookie });
    expect(await res.json()).toEqual({ rules: [] });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- availability`
Expected: FAIL — 404.

- [ ] **Step 3: Implement `src/db/availability.ts`**

```ts
import type { AvailabilityRuleRow } from "../types";

export async function listRules(db: D1Database, userId: number): Promise<AvailabilityRuleRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM availability_rules
       WHERE user_id = ? AND is_active = 1
       ORDER BY day_of_week, start_time`,
    )
    .bind(userId)
    .all<AvailabilityRuleRow>();
  return results;
}

export async function listRulesForDay(
  db: D1Database,
  userId: number,
  dayOfWeek: number,
): Promise<AvailabilityRuleRow[]> {
  const { results } = await db
    .prepare(
      `SELECT * FROM availability_rules
       WHERE user_id = ? AND day_of_week = ? AND is_active = 1
       ORDER BY start_time`,
    )
    .bind(userId, dayOfWeek)
    .all<AvailabilityRuleRow>();
  return results;
}

export interface RuleInput {
  dayOfWeek: number;
  startTime: string;
  endTime: string;
}

/** Replaces the host's entire weekly set atomically (ERD.md §12). */
export async function replaceRules(
  db: D1Database,
  userId: number,
  rules: RuleInput[],
  now: string,
): Promise<void> {
  const statements: D1PreparedStatement[] = [
    db.prepare("DELETE FROM availability_rules WHERE user_id = ?").bind(userId),
  ];
  for (const rule of rules) {
    statements.push(
      db
        .prepare(
          `INSERT INTO availability_rules (user_id, day_of_week, start_time, end_time, is_active, created_at, updated_at)
           VALUES (?, ?, ?, ?, 1, ?, ?)`,
        )
        .bind(userId, rule.dayOfWeek, rule.startTime, rule.endTime, now, now),
    );
  }
  await db.batch(statements);
}
```

- [ ] **Step 4: Implement `src/routes/api.availability.ts`**

```ts
import { Hono } from "hono";
import { listRules, replaceRules, type RuleInput } from "../db/availability";
import { toMinutes } from "../lib/slots";
import { nowIso } from "../lib/time";
import { isHhmm } from "../lib/validate";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";

export const availabilityRoutes = new Hono<AppEnv>();

availabilityRoutes.use("*", requireAuth);

availabilityRoutes.get("/", async (c) => {
  const rules = await listRules(c.env.DB, c.get("user").id);
  return c.json({ rules });
});

availabilityRoutes.put("/", async (c) => {
  const body = await c.req.json<{ rules?: unknown }>().catch(() => ({}));
  if (!Array.isArray(body.rules)) return c.json({ error: "rules must be an array" }, 400);
  if (body.rules.length > 70) return c.json({ error: "Too many availability rules" }, 400);

  const parsed: RuleInput[] = [];
  for (const raw of body.rules as Array<Record<string, unknown>>) {
    const dayOfWeek = Number(raw.day_of_week);
    const startTime = String(raw.start_time ?? "");
    const endTime = String(raw.end_time ?? "");

    if (!Number.isInteger(dayOfWeek) || dayOfWeek < 0 || dayOfWeek > 6) {
      return c.json({ error: "day_of_week must be 0-6" }, 400);
    }
    if (!isHhmm(startTime) || !isHhmm(endTime)) {
      return c.json({ error: "start_time and end_time must be HH:MM" }, 400);
    }
    if (toMinutes(startTime) >= toMinutes(endTime)) {
      return c.json({ error: "end_time must be after start_time" }, 400);
    }
    parsed.push({ dayOfWeek, startTime, endTime });
  }

  await replaceRules(c.env.DB, c.get("user").id, parsed, nowIso());
  const rules = await listRules(c.env.DB, c.get("user").id);
  return c.json({ rules });
});
```

- [ ] **Step 5: Mount it in `src/index.ts`**

```ts
import { availabilityRoutes } from "./routes/api.availability";
// ...
app.route("/api/availability", availabilityRoutes);
```

- [ ] **Step 6: Run the test again**

Run: `npm test -- availability`
Expected: 7 passed.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(availability): add weekly availability GET/PUT with batch replace"
```

---

## Phase 4 — Booking engine

### Task 13: Availability service — slots for a date

**Files:**
- Create: `src/db/bookings.ts`
- Create: `src/services/availability.ts`
- Create: `test/integration/slots.service.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { getSlotsForDate } from "../../src/services/availability";
import { api, createHost, resetDb } from "../helpers";

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
  return { host, eventTypeId: eventType.id };
}

describe("getSlotsForDate", () => {
  beforeEach(resetDb);

  it("returns slots inside availability, converted to UTC", async () => {
    const { host, eventTypeId } = await seed();
    // 2026-09-21 is a Monday
    const slots = await getSlotsForDate(env.DB, {
      hostId: host.id,
      hostTimezone: "Asia/Kuala_Lumpur",
      eventTypeId,
      durationMinutes: 30,
      dateYmd: "2026-09-21",
      nowMs: Date.parse("2026-09-01T00:00:00Z"),
    });
    expect(slots.map((s) => s.startAt)).toEqual([
      "2026-09-21T01:00:00Z",
      "2026-09-21T01:30:00Z",
      "2026-09-21T02:00:00Z",
      "2026-09-21T02:30:00Z",
    ]);
  });

  it("returns nothing on a day with no rules", async () => {
    const { host, eventTypeId } = await seed();
    // 2026-09-22 is a Tuesday
    const slots = await getSlotsForDate(env.DB, {
      hostId: host.id,
      hostTimezone: "Asia/Kuala_Lumpur",
      eventTypeId,
      durationMinutes: 30,
      dateYmd: "2026-09-22",
      nowMs: Date.parse("2026-09-01T00:00:00Z"),
    });
    expect(slots).toEqual([]);
  });

  it("hides past slots", async () => {
    const { host, eventTypeId } = await seed();
    const slots = await getSlotsForDate(env.DB, {
      hostId: host.id,
      hostTimezone: "Asia/Kuala_Lumpur",
      eventTypeId,
      durationMinutes: 30,
      dateYmd: "2026-09-21",
      nowMs: Date.parse("2026-09-21T01:45:00Z"),
    });
    expect(slots.map((s) => s.startAt)).toEqual(["2026-09-21T02:00:00Z", "2026-09-21T02:30:00Z"]);
  });

  it("hides slots taken by a confirmed booking", async () => {
    const { host, eventTypeId } = await seed();
    const now = "2026-09-01T00:00:00Z";
    await env.DB.prepare(
      `INSERT INTO bookings (user_id,event_type_id,guest_name,guest_email,start_at,end_at,timezone,status,created_at,updated_at)
       VALUES (?,?,'G','g@example.com','2026-09-21T01:30:00Z','2026-09-21T02:00:00Z','UTC','confirmed',?,?)`,
    ).bind(host.id, eventTypeId, now, now).run();

    const slots = await getSlotsForDate(env.DB, {
      hostId: host.id,
      hostTimezone: "Asia/Kuala_Lumpur",
      eventTypeId,
      durationMinutes: 30,
      dateYmd: "2026-09-21",
      nowMs: Date.parse("2026-09-01T00:00:00Z"),
    });
    expect(slots.map((s) => s.startAt)).toEqual([
      "2026-09-21T01:00:00Z",
      "2026-09-21T02:00:00Z",
      "2026-09-21T02:30:00Z",
    ]);
  });

  it("ignores cancelled bookings", async () => {
    const { host, eventTypeId } = await seed();
    const now = "2026-09-01T00:00:00Z";
    await env.DB.prepare(
      `INSERT INTO bookings (user_id,event_type_id,guest_name,guest_email,start_at,end_at,timezone,status,created_at,updated_at)
       VALUES (?,?,'G','g@example.com','2026-09-21T01:30:00Z','2026-09-21T02:00:00Z','UTC','cancelled',?,?)`,
    ).bind(host.id, eventTypeId, now, now).run();

    const slots = await getSlotsForDate(env.DB, {
      hostId: host.id,
      hostTimezone: "Asia/Kuala_Lumpur",
      eventTypeId,
      durationMinutes: 30,
      dateYmd: "2026-09-21",
      nowMs: Date.parse("2026-09-01T00:00:00Z"),
    });
    expect(slots).toHaveLength(4);
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- slots.service`
Expected: FAIL — module not found.

- [ ] **Step 3: Implement `src/db/bookings.ts`**

```ts
import type { BookingRow } from "../types";

export interface BusyInterval {
  start_at: string;
  end_at: string;
}

export async function listConfirmedBetween(
  db: D1Database,
  userId: number,
  fromIso: string,
  toIso: string,
): Promise<BusyInterval[]> {
  const { results } = await db
    .prepare(
      `SELECT start_at, end_at FROM bookings
       WHERE user_id = ?
         AND status = 'confirmed'
         AND start_at < ?
         AND end_at > ?`,
    )
    .bind(userId, toIso, fromIso)
    .all<BusyInterval>();
  return results;
}

export interface InsertBookingInput {
  userId: number;
  eventTypeId: number;
  guestName: string;
  guestEmail: string;
  startAt: string;
  endAt: string;
  timezone: string;
  notes: string | null;
  now: string;
}

/**
 * Atomic conditional insert (ERD.md §9). Returns null when an overlapping
 * confirmed booking already exists — no interactive transaction required.
 */
export async function insertBookingIfFree(
  db: D1Database,
  input: InsertBookingInput,
): Promise<BookingRow | null> {
  try {
    return await db
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
         RETURNING *`,
      )
      .bind(
        input.userId, input.eventTypeId, input.guestName, input.guestEmail,
        input.startAt, input.endAt, input.timezone, input.notes, input.now, input.now,
        input.userId, input.endAt, input.startAt,
      )
      .first<BookingRow>();
  } catch (err) {
    // Partial unique index fired — same host, same start, already confirmed.
    if (String(err).includes("UNIQUE")) return null;
    throw err;
  }
}

export async function getBookingOwned(
  db: D1Database,
  id: number,
  userId: number,
): Promise<BookingRow | null> {
  return db
    .prepare("SELECT * FROM bookings WHERE id = ? AND user_id = ?")
    .bind(id, userId)
    .first<BookingRow>();
}

export async function getBookingById(db: D1Database, id: number): Promise<BookingRow | null> {
  return db.prepare("SELECT * FROM bookings WHERE id = ?").bind(id).first<BookingRow>();
}

export async function cancelBooking(
  db: D1Database,
  id: number,
  userId: number,
  now: string,
): Promise<BookingRow | null> {
  return db
    .prepare(
      `UPDATE bookings SET status = 'cancelled', updated_at = ?
       WHERE id = ? AND user_id = ? AND status = 'confirmed'
       RETURNING *`,
    )
    .bind(now, id, userId)
    .first<BookingRow>();
}

export interface BookingWithEvent extends BookingRow {
  event_name: string;
}

export async function listBookings(
  db: D1Database,
  userId: number,
  scope: "upcoming" | "past" | "cancelled",
  nowIsoString: string,
): Promise<BookingWithEvent[]> {
  const where =
    scope === "cancelled"
      ? "b.status = 'cancelled'"
      : scope === "past"
        ? "b.status != 'cancelled' AND b.end_at <= ?"
        : "b.status = 'confirmed' AND b.end_at > ?";
  const order = scope === "upcoming" ? "ASC" : "DESC";

  const stmt = db.prepare(
    `SELECT b.*, e.name AS event_name
     FROM bookings b
     JOIN event_types e ON e.id = b.event_type_id
     WHERE b.user_id = ? AND ${where}
     ORDER BY b.start_at ${order}
     LIMIT 200`,
  );
  const bound = scope === "cancelled" ? stmt.bind(userId) : stmt.bind(userId, nowIsoString);
  const { results } = await bound.all<BookingWithEvent>();
  return results;
}

export interface DashboardStats {
  upcoming: number;
  today: number;
  total: number;
  activeEventTypes: number;
}

export async function dashboardStats(
  db: D1Database,
  userId: number,
  nowIsoString: string,
  dayStartIso: string,
  dayEndIso: string,
): Promise<DashboardStats> {
  const [upcoming, today, total, active] = await db.batch<{ n: number }>([
    db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE user_id = ? AND status = 'confirmed' AND end_at > ?").bind(userId, nowIsoString),
    db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE user_id = ? AND status = 'confirmed' AND start_at >= ? AND start_at < ?").bind(userId, dayStartIso, dayEndIso),
    db.prepare("SELECT COUNT(*) AS n FROM bookings WHERE user_id = ?").bind(userId),
    db.prepare("SELECT COUNT(*) AS n FROM event_types WHERE user_id = ? AND is_active = 1").bind(userId),
  ]);
  return {
    upcoming: upcoming.results[0]?.n ?? 0,
    today: today.results[0]?.n ?? 0,
    total: total.results[0]?.n ?? 0,
    activeEventTypes: active.results[0]?.n ?? 0,
  };
}
```

- [ ] **Step 4: Implement `src/services/availability.ts`**

```ts
import { listRulesForDay } from "../db/availability";
import { listConfirmedBetween } from "../db/bookings";
import { generateSlotStarts, removeBusy, removePast, toHhmm, toMinutes, type Interval } from "../lib/slots";
import { addMinutes, isoUtc } from "../lib/time";
import { dayOfWeek, zonedToUtc } from "../lib/timezone";

export interface SlotQuery {
  hostId: number;
  hostTimezone: string;
  eventTypeId: number;
  durationMinutes: number;
  dateYmd: string;
  nowMs: number;
}

export interface Slot {
  /** UTC instant, fixed-width ISO. */
  startAt: string;
  endAt: string;
}

/**
 * Bookable slots for one calendar date in the HOST's timezone.
 * Availability rules are host-local; results are UTC instants.
 */
export async function getSlotsForDate(db: D1Database, q: SlotQuery): Promise<Slot[]> {
  const rules = await listRulesForDay(db, q.hostId, dayOfWeek(q.dateYmd));
  if (rules.length === 0) return [];

  const windows = rules.map((r) => ({ start: toMinutes(r.start_time), end: toMinutes(r.end_time) }));
  const startMinutes = generateSlotStarts(windows, q.durationMinutes);
  if (startMinutes.length === 0) return [];

  const candidates: Interval[] = startMinutes.map((minutes) => {
    const start = zonedToUtc(q.dateYmd, toHhmm(minutes), q.hostTimezone);
    return { startMs: start.getTime(), endMs: start.getTime() + q.durationMinutes * 60_000 };
  });

  const dayStart = candidates[0]!.startMs;
  const dayEnd = candidates[candidates.length - 1]!.endMs;
  const busyRows = await listConfirmedBetween(
    db,
    q.hostId,
    isoUtc(new Date(dayStart)),
    isoUtc(new Date(dayEnd)),
  );
  const busy: Interval[] = busyRows.map((b) => ({
    startMs: Date.parse(b.start_at),
    endMs: Date.parse(b.end_at),
  }));

  return removeBusy(removePast(candidates, q.nowMs), busy).map((slot) => ({
    startAt: isoUtc(new Date(slot.startMs)),
    endAt: isoUtc(addMinutes(new Date(slot.startMs), q.durationMinutes)),
  }));
}

/** True when `startAt` is exactly one of the bookable slot starts for its host-local date. */
export async function isBookableSlot(
  db: D1Database,
  q: Omit<SlotQuery, "dateYmd">,
  startAtIso: string,
  dateYmd: string,
): Promise<boolean> {
  const slots = await getSlotsForDate(db, { ...q, dateYmd });
  return slots.some((s) => s.startAt === startAtIso);
}
```

- [ ] **Step 5: Run the test again**

Run: `npm test -- slots.service`
Expected: 5 passed.

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "feat(booking): add slot service combining availability, bookings and now"
```

---

### Task 14: Booking creation with double-booking protection

**Files:**
- Create: `src/services/booking.ts`
- Create: `src/routes/api.public.ts`
- Modify: `src/index.ts`
- Create: `test/integration/booking.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { api, createHost, resetDb } from "../helpers";

async function seed() {
  const host = await createHost("wan", "Asia/Kuala_Lumpur");
  await api("/api/availability", {
    method: "PUT",
    cookie: host.cookie,
    body: JSON.stringify({ rules: [{ day_of_week: 1, start_time: "09:00", end_time: "11:00" }] }),
  });
  await api("/api/event-types", {
    method: "POST",
    cookie: host.cookie,
    body: JSON.stringify({ name: "Consultation", slug: "consultation", duration_minutes: 30 }),
  });
  return host;
}

const BOOK = "/api/public/wan/consultation/book";

function bookBody(startAt: string) {
  return JSON.stringify({
    start_at: startAt,
    date: "2026-09-21",
    guest_name: "Ahmad",
    guest_email: "ahmad@example.com",
    notes: "Discuss ads",
    timezone: "Asia/Kuala_Lumpur",
  });
}

describe("public booking", () => {
  beforeEach(resetDb);

  it("exposes the public event type", async () => {
    await seed();
    const res = await api("/api/public/wan/consultation");
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      host: { slug: "wan", timezone: "Asia/Kuala_Lumpur" },
      eventType: { slug: "consultation", duration_minutes: 30 },
    });
  });

  it("404s for an unknown host or event", async () => {
    await seed();
    expect((await api("/api/public/nobody/consultation")).status).toBe(404);
    expect((await api("/api/public/wan/nope")).status).toBe(404);
  });

  it("lists slots for a date", async () => {
    await seed();
    const res = await api("/api/public/wan/consultation/slots?date=2026-09-21");
    const { slots } = await res.json<{ slots: Array<{ startAt: string }> }>();
    expect(slots.map((s) => s.startAt)).toContain("2026-09-21T01:00:00Z");
  });

  it("creates a booking and derives end_at on the server", async () => {
    await seed();
    const res = await api(BOOK, { method: "POST", body: bookBody("2026-09-21T01:00:00Z") });
    expect(res.status).toBe(201);
    const { booking } = await res.json<{ booking: { end_at: string; status: string } }>();
    expect(booking.end_at).toBe("2026-09-21T01:30:00Z");
    expect(booking.status).toBe("confirmed");
  });

  it("rejects a second booking for the same slot with 409", async () => {
    await seed();
    await api(BOOK, { method: "POST", body: bookBody("2026-09-21T01:00:00Z") });
    const second = await api(BOOK, { method: "POST", body: bookBody("2026-09-21T01:00:00Z") });
    expect(second.status).toBe(409);
    expect(await second.json()).toMatchObject({ error: "This time slot is no longer available." });
  });

  it("removes the booked slot from the slot list", async () => {
    await seed();
    await api(BOOK, { method: "POST", body: bookBody("2026-09-21T01:00:00Z") });
    const res = await api("/api/public/wan/consultation/slots?date=2026-09-21");
    const { slots } = await res.json<{ slots: Array<{ startAt: string }> }>();
    expect(slots.map((s) => s.startAt)).not.toContain("2026-09-21T01:00:00Z");
  });

  it("rejects a start time outside availability", async () => {
    await seed();
    const res = await api(BOOK, { method: "POST", body: bookBody("2026-09-21T08:00:00Z") });
    expect(res.status).toBe(422);
  });

  it("rejects a start time off the slot grid", async () => {
    await seed();
    const res = await api(BOOK, { method: "POST", body: bookBody("2026-09-21T01:07:00Z") });
    expect(res.status).toBe(422);
  });

  it("rejects a booking in the past", async () => {
    await seed();
    const res = await api(BOOK, {
      method: "POST",
      body: JSON.stringify({
        start_at: "2020-01-06T01:00:00Z",
        date: "2020-01-06",
        guest_name: "Ahmad",
        guest_email: "ahmad@example.com",
        timezone: "Asia/Kuala_Lumpur",
      }),
    });
    expect(res.status).toBe(422);
  });

  it("rejects an invalid guest email", async () => {
    await seed();
    const res = await api(BOOK, {
      method: "POST",
      body: JSON.stringify({
        start_at: "2026-09-21T01:00:00Z",
        date: "2026-09-21",
        guest_name: "Ahmad",
        guest_email: "not-an-email",
        timezone: "Asia/Kuala_Lumpur",
      }),
    });
    expect(res.status).toBe(400);
  });

  it("ignores a client-supplied end_at", async () => {
    await seed();
    const res = await api(BOOK, {
      method: "POST",
      body: JSON.stringify({
        start_at: "2026-09-21T01:00:00Z",
        end_at: "2026-09-21T09:00:00Z",
        date: "2026-09-21",
        guest_name: "Ahmad",
        guest_email: "ahmad@example.com",
        timezone: "Asia/Kuala_Lumpur",
      }),
    });
    const { booking } = await res.json<{ booking: { end_at: string } }>();
    expect(booking.end_at).toBe("2026-09-21T01:30:00Z");
  });

  it("survives concurrent submissions for the same slot", async () => {
    await seed();
    const results = await Promise.all([
      api(BOOK, { method: "POST", body: bookBody("2026-09-21T01:00:00Z") }),
      api(BOOK, { method: "POST", body: bookBody("2026-09-21T01:00:00Z") }),
      api(BOOK, { method: "POST", body: bookBody("2026-09-21T01:00:00Z") }),
    ]);
    const created = results.filter((r) => r.status === 201);
    expect(created).toHaveLength(1);

    const row = await env.DB.prepare(
      "SELECT COUNT(*) AS n FROM bookings WHERE status = 'confirmed' AND start_at = '2026-09-21T01:00:00Z'",
    ).first<{ n: number }>();
    expect(row?.n).toBe(1);
  });
});
```

> Note: the "past booking" test uses a fixed 2020 date so it stays in the past forever. The other
> tests use 2026-09-21 (a Monday); if you are running this after that date, bump every `2026-09-21`
> to the next future Monday consistently across this file.

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- booking`
Expected: FAIL — 404 on `/api/public/...`.

- [ ] **Step 3: Implement `src/services/booking.ts`**

```ts
import { getPublicEventType } from "../db/eventTypes";
import { cancelBooking, getBookingOwned, insertBookingIfFree } from "../db/bookings";
import { findUserBySlug } from "../db/users";
import { addMinutes, isoUtc, nowIso, parseIsoUtc } from "../lib/time";
import { isValidTimeZone, zonedDateString } from "../lib/timezone";
import { isEmail, isYmd } from "../lib/validate";
import { getSlotsForDate } from "./availability";
import type { BookingRow, EventTypeRow, PublicUser } from "../types";

export class BookingError extends Error {
  constructor(message: string, public readonly status: 400 | 404 | 409 | 422) {
    super(message);
    this.name = "BookingError";
  }
}

export interface PublicTarget {
  host: PublicUser;
  eventType: EventTypeRow;
}

export async function resolvePublicTarget(
  db: D1Database,
  hostSlug: string,
  eventSlug: string,
): Promise<PublicTarget> {
  const host = await findUserBySlug(db, hostSlug.toLowerCase());
  if (!host) throw new BookingError("Not found", 404);
  const eventType = await getPublicEventType(db, host.id, eventSlug.toLowerCase());
  if (!eventType) throw new BookingError("Not found", 404);
  return { host, eventType };
}

export interface CreateBookingInput {
  hostSlug: string;
  eventSlug: string;
  startAt: string;
  guestName: string;
  guestEmail: string;
  guestTimezone: string;
  notes: string | null;
  nowMs?: number;
}

export async function createBooking(
  db: D1Database,
  input: CreateBookingInput,
): Promise<BookingRow> {
  const { host, eventType } = await resolvePublicTarget(db, input.hostSlug, input.eventSlug);

  const guestName = input.guestName.trim();
  const guestEmail = input.guestEmail.trim().toLowerCase();
  if (guestName.length < 1 || guestName.length > 100) throw new BookingError("Name is required", 400);
  if (!isEmail(guestEmail)) throw new BookingError("A valid email is required", 400);
  if (!isValidTimeZone(input.guestTimezone)) throw new BookingError("Invalid timezone", 400);
  if (input.notes && input.notes.length > 2000) throw new BookingError("Notes are too long", 400);

  let start: Date;
  try {
    start = parseIsoUtc(input.startAt);
  } catch {
    throw new BookingError("Invalid start time", 400);
  }

  const nowMs = input.nowMs ?? Date.now();
  if (start.getTime() < nowMs) throw new BookingError("That time is in the past", 422);

  const end = addMinutes(start, eventType.duration_minutes);
  const startIso = isoUtc(start);
  const endIso = isoUtc(end);

  // Re-derive the host-local date from the instant so the client cannot lie about it.
  const hostDate = zonedDateString(start, host.timezone);
  if (!isYmd(hostDate)) throw new BookingError("Invalid start time", 400);

  const slots = await getSlotsForDate(db, {
    hostId: host.id,
    hostTimezone: host.timezone,
    eventTypeId: eventType.id,
    durationMinutes: eventType.duration_minutes,
    dateYmd: hostDate,
    nowMs,
  });
  if (!slots.some((s) => s.startAt === startIso)) {
    throw new BookingError("That time is not available", 422);
  }

  const booking = await insertBookingIfFree(db, {
    userId: host.id,
    eventTypeId: eventType.id,
    guestName,
    guestEmail,
    startAt: startIso,
    endAt: endIso,
    timezone: input.guestTimezone,
    notes: input.notes,
    now: nowIso(),
  });
  if (!booking) throw new BookingError("This time slot is no longer available.", 409);
  return booking;
}

export async function cancelOwnedBooking(
  db: D1Database,
  bookingId: number,
  userId: number,
): Promise<BookingRow> {
  const existing = await getBookingOwned(db, bookingId, userId);
  if (!existing) throw new BookingError("Not found", 404);
  if (existing.status === "cancelled") return existing;

  const cancelled = await cancelBooking(db, bookingId, userId, nowIso());
  if (!cancelled) throw new BookingError("Not found", 404);
  return cancelled;
}
```

- [ ] **Step 4: Implement `src/routes/api.public.ts`**

```ts
import { Hono } from "hono";
import { listPublicEventTypes } from "../db/eventTypes";
import { findUserBySlug } from "../db/users";
import { isYmd } from "../lib/validate";
import { getSlotsForDate } from "../services/availability";
import { BookingError, createBooking, resolvePublicTarget } from "../services/booking";
import type { AppEnv } from "../types";

export const publicRoutes = new Hono<AppEnv>();

function handleBookingError(err: unknown) {
  if (err instanceof BookingError) return { error: err.message, status: err.status } as const;
  return null;
}

publicRoutes.get("/:username", async (c) => {
  const host = await findUserBySlug(c.env.DB, c.req.param("username").toLowerCase());
  if (!host) return c.json({ error: "Not found" }, 404);
  const eventTypes = await listPublicEventTypes(c.env.DB, host.id);
  return c.json({ host, eventTypes });
});

publicRoutes.get("/:username/:eventSlug", async (c) => {
  try {
    const { host, eventType } = await resolvePublicTarget(
      c.env.DB,
      c.req.param("username"),
      c.req.param("eventSlug"),
    );
    return c.json({ host, eventType });
  } catch (err) {
    const mapped = handleBookingError(err);
    if (mapped) return c.json({ error: mapped.error }, mapped.status);
    throw err;
  }
});

publicRoutes.get("/:username/:eventSlug/slots", async (c) => {
  const date = c.req.query("date") ?? "";
  if (!isYmd(date)) return c.json({ error: "date must be YYYY-MM-DD" }, 400);

  try {
    const { host, eventType } = await resolvePublicTarget(
      c.env.DB,
      c.req.param("username"),
      c.req.param("eventSlug"),
    );
    const slots = await getSlotsForDate(c.env.DB, {
      hostId: host.id,
      hostTimezone: host.timezone,
      eventTypeId: eventType.id,
      durationMinutes: eventType.duration_minutes,
      dateYmd: date,
      nowMs: Date.now(),
    });
    return c.json({ hostTimezone: host.timezone, durationMinutes: eventType.duration_minutes, slots });
  } catch (err) {
    const mapped = handleBookingError(err);
    if (mapped) return c.json({ error: mapped.error }, mapped.status);
    throw err;
  }
});

publicRoutes.post("/:username/:eventSlug/book", async (c) => {
  const body = await c.req.json<Record<string, unknown>>().catch(() => ({}));
  try {
    const booking = await createBooking(c.env.DB, {
      hostSlug: c.req.param("username"),
      eventSlug: c.req.param("eventSlug"),
      startAt: String(body.start_at ?? ""),
      guestName: String(body.guest_name ?? ""),
      guestEmail: String(body.guest_email ?? ""),
      guestTimezone: String(body.timezone ?? "UTC"),
      notes: body.notes ? String(body.notes) : null,
    });
    return c.json({ booking }, 201);
  } catch (err) {
    const mapped = handleBookingError(err);
    if (mapped) return c.json({ error: mapped.error }, mapped.status);
    throw err;
  }
});
```

- [ ] **Step 5: Mount it in `src/index.ts`**

```ts
import { publicRoutes } from "./routes/api.public";
// ...
app.route("/api/public", publicRoutes);
```

- [ ] **Step 6: Run the test again**

Run: `npm test -- booking`
Expected: 12 passed. The concurrency test is the important one — exactly one 201.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(booking): add public booking API with atomic double-booking protection"
```

---

### Task 15: Host booking management

**Files:**
- Create: `src/routes/api.bookings.ts`
- Modify: `src/index.ts`
- Create: `test/integration/bookingsAdmin.test.ts`

- [ ] **Step 1: Write the failing test**

```ts
import { beforeEach, describe, expect, it } from "vitest";
import { api, createHost, resetDb } from "../helpers";

async function seedBooking() {
  const host = await createHost("wan", "Asia/Kuala_Lumpur");
  await api("/api/availability", {
    method: "PUT",
    cookie: host.cookie,
    body: JSON.stringify({ rules: [{ day_of_week: 1, start_time: "09:00", end_time: "11:00" }] }),
  });
  await api("/api/event-types", {
    method: "POST",
    cookie: host.cookie,
    body: JSON.stringify({ name: "Consultation", slug: "consultation", duration_minutes: 30 }),
  });
  const res = await api("/api/public/wan/consultation/book", {
    method: "POST",
    body: JSON.stringify({
      start_at: "2026-09-21T01:00:00Z",
      guest_name: "Ahmad",
      guest_email: "ahmad@example.com",
      timezone: "Asia/Kuala_Lumpur",
    }),
  });
  const { booking } = await res.json<{ booking: { id: number } }>();
  return { host, bookingId: booking.id };
}

describe("host bookings", () => {
  beforeEach(resetDb);

  it("requires auth", async () => {
    expect((await api("/api/bookings")).status).toBe(401);
  });

  it("lists upcoming bookings with the event name", async () => {
    const { host } = await seedBooking();
    const res = await api("/api/bookings?scope=upcoming", { cookie: host.cookie });
    const { bookings } = await res.json<{ bookings: Array<{ event_name: string; guest_name: string }> }>();
    expect(bookings).toHaveLength(1);
    expect(bookings[0]!.event_name).toBe("Consultation");
    expect(bookings[0]!.guest_name).toBe("Ahmad");
  });

  it("cancels without deleting the row", async () => {
    const { host, bookingId } = await seedBooking();
    const res = await api(`/api/bookings/${bookingId}/cancel`, { method: "POST", cookie: host.cookie });
    expect(res.status).toBe(200);

    const detail = await api(`/api/bookings/${bookingId}`, { cookie: host.cookie });
    const { booking } = await detail.json<{ booking: { status: string } }>();
    expect(booking.status).toBe("cancelled");
  });

  it("frees the slot after cancellation", async () => {
    const { host, bookingId } = await seedBooking();
    await api(`/api/bookings/${bookingId}/cancel`, { method: "POST", cookie: host.cookie });
    const res = await api("/api/public/wan/consultation/slots?date=2026-09-21");
    const { slots } = await res.json<{ slots: Array<{ startAt: string }> }>();
    expect(slots.map((s) => s.startAt)).toContain("2026-09-21T01:00:00Z");
  });

  it("blocks another host from cancelling", async () => {
    const { bookingId } = await seedBooking();
    const ali = await createHost("ali");
    const res = await api(`/api/bookings/${bookingId}/cancel`, { method: "POST", cookie: ali.cookie });
    expect(res.status).toBe(404);
  });

  it("returns dashboard stats", async () => {
    const { host } = await seedBooking();
    const res = await api("/api/bookings/stats", { cookie: host.cookie });
    expect(await res.json()).toMatchObject({ stats: { total: 1, activeEventTypes: 1 } });
  });
});
```

- [ ] **Step 2: Run it and watch it fail**

Run: `npm test -- bookingsAdmin`
Expected: FAIL — 404.

- [ ] **Step 3: Implement `src/routes/api.bookings.ts`**

```ts
import { Hono } from "hono";
import { dashboardStats, getBookingOwned, listBookings } from "../db/bookings";
import { isoUtc, nowIso } from "../lib/time";
import { zonedDateString, zonedToUtc } from "../lib/timezone";
import { BookingError, cancelOwnedBooking } from "../services/booking";
import { requireAuth } from "../middleware/auth";
import type { AppEnv } from "../types";

export const bookingRoutes = new Hono<AppEnv>();

bookingRoutes.use("*", requireAuth);

bookingRoutes.get("/stats", async (c) => {
  const user = c.get("user");
  const now = new Date();
  const today = zonedDateString(now, user.timezone);
  const dayStart = zonedToUtc(today, "00:00", user.timezone);
  const dayEnd = new Date(dayStart.getTime() + 24 * 60 * 60_000);

  const stats = await dashboardStats(
    c.env.DB,
    user.id,
    isoUtc(now),
    isoUtc(dayStart),
    isoUtc(dayEnd),
  );
  return c.json({ stats });
});

bookingRoutes.get("/", async (c) => {
  const raw = c.req.query("scope") ?? "upcoming";
  const scope = raw === "past" || raw === "cancelled" ? raw : "upcoming";
  const bookings = await listBookings(c.env.DB, c.get("user").id, scope, nowIso());
  return c.json({ bookings, scope });
});

bookingRoutes.get("/:id", async (c) => {
  const booking = await getBookingOwned(c.env.DB, Number(c.req.param("id")), c.get("user").id);
  if (!booking) return c.json({ error: "Not found" }, 404);
  return c.json({ booking });
});

bookingRoutes.post("/:id/cancel", async (c) => {
  try {
    const booking = await cancelOwnedBooking(c.env.DB, Number(c.req.param("id")), c.get("user").id);
    return c.json({ booking });
  } catch (err) {
    if (err instanceof BookingError) return c.json({ error: err.message }, err.status);
    throw err;
  }
});
```

- [ ] **Step 4: Mount it in `src/index.ts`**

```ts
import { bookingRoutes } from "./routes/api.bookings";
// ...
app.route("/api/bookings", bookingRoutes);
```

- [ ] **Step 5: Run the test again**

Run: `npm test -- bookingsAdmin`
Expected: 6 passed.

- [ ] **Step 6: Run the whole suite**

Run: `npm test`
Expected: all suites pass.

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "feat(bookings): add host booking list, detail, cancel and dashboard stats"
```

---

## Phase 5 — Interface

### Task 16: Tailwind build and layout shell

**Files:**
- Create: `src/styles/app.css`
- Create: `src/views/layout.ts`
- Create: `public/vendor/alpine.min.js`
- Create: `src/routes/pages.ts`
- Modify: `src/index.ts`
- Create: `test/integration/pages.test.ts`

- [ ] **Step 1: Write `src/styles/app.css`**

```css
@import "tailwindcss";
@source "../**/*.ts";

@theme {
  --color-ink: oklch(0.21 0.02 264);
  --color-muted: oklch(0.55 0.02 264);
  --color-line: oklch(0.92 0.005 264);
  --color-accent: oklch(0.55 0.19 264);
}

@layer components {
  .mf-card {
    @apply rounded-xl border border-[--color-line] bg-white p-6 shadow-sm;
  }
  .mf-btn {
    @apply inline-flex items-center justify-center rounded-lg bg-[--color-accent] px-4 py-2.5
           text-sm font-medium text-white transition hover:opacity-90
           focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[--color-accent]
           disabled:opacity-50;
  }
  .mf-btn-ghost {
    @apply inline-flex items-center justify-center rounded-lg border border-[--color-line]
           px-4 py-2.5 text-sm font-medium text-[--color-ink] transition hover:bg-neutral-50;
  }
  .mf-input {
    @apply w-full rounded-lg border border-[--color-line] px-3 py-2.5 text-sm
           focus:border-[--color-accent] focus:outline-none focus:ring-1 focus:ring-[--color-accent];
  }
  .mf-label {
    @apply mb-1.5 block text-sm font-medium text-[--color-ink];
  }
}
```

- [ ] **Step 2: Vendor Alpine.js**

```bash
mkdir -p public/vendor
curl -sL https://cdn.jsdelivr.net/npm/alpinejs@3.14.9/dist/cdn.min.js -o public/vendor/alpine.min.js
test -s public/vendor/alpine.min.js && echo "alpine ok"
```

Expected: `alpine ok`. Vendoring (rather than a CDN `<script src>`) keeps the page working with a
strict CSP and removes a third-party runtime dependency.

- [ ] **Step 3: Implement `src/views/layout.ts`**

```ts
export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface LayoutOptions {
  title: string;
  body: string;
  /** Rendered inside a <script type="application/json" id="page-data"> tag. */
  data?: unknown;
  nav?: "host" | "public" | "none";
  activeNav?: string;
  hostName?: string;
}

const HOST_NAV: Array<{ href: string; label: string }> = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dashboard/event-types", label: "Event Types" },
  { href: "/dashboard/availability", label: "Availability" },
  { href: "/dashboard/bookings", label: "Bookings" },
  { href: "/dashboard/settings", label: "Settings" },
];

function hostNav(active: string | undefined, hostName: string | undefined): string {
  const links = HOST_NAV.map(
    (item) => `<a href="${item.href}" class="rounded-lg px-3 py-2 text-sm ${
      active === item.href ? "bg-neutral-100 font-medium text-[--color-ink]" : "text-[--color-muted] hover:bg-neutral-50"
    }">${item.label}</a>`,
  ).join("");
  return `
    <header class="border-b border-[--color-line] bg-white">
      <div class="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
        <a href="/dashboard" class="text-base font-semibold tracking-tight">MeetFlow</a>
        <nav class="hidden items-center gap-1 md:flex">${links}</nav>
        <form method="post" action="/logout">
          <button class="text-sm text-[--color-muted] hover:text-[--color-ink]">
            ${hostName ? `Sign out ${escapeHtml(hostName)}` : "Sign out"}
          </button>
        </form>
      </div>
    </header>`;
}

export function layout(options: LayoutOptions): string {
  const dataScript = options.data
    ? `<script type="application/json" id="page-data">${JSON.stringify(options.data).replace(/</g, "\\u003c")}</script>`
    : "";
  return `<!doctype html>
<html lang="en" class="h-full">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(options.title)} · MeetFlow</title>
  <link rel="stylesheet" href="/app.css">
  <script defer src="/vendor/alpine.min.js"></script>
</head>
<body class="h-full bg-neutral-50 text-[--color-ink] antialiased">
  ${options.nav === "host" ? hostNav(options.activeNav, options.hostName) : ""}
  <main class="mx-auto max-w-5xl px-6 py-10">${options.body}</main>
  ${dataScript}
</body>
</html>`;
}
```

- [ ] **Step 4: Write the failing page test**

`test/integration/pages.test.ts`:

```ts
import { SELF } from "cloudflare:test";
import { beforeEach, describe, expect, it } from "vitest";
import { createHost, resetDb } from "../helpers";

describe("pages", () => {
  beforeEach(resetDb);

  it("serves the login page as HTML", async () => {
    const res = await SELF.fetch("https://example.com/login");
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toContain("text/html");
    expect(await res.text()).toContain("Sign in");
  });

  it("redirects an anonymous visitor away from the dashboard", async () => {
    const res = await SELF.fetch("https://example.com/dashboard", { redirect: "manual" });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login");
  });

  it("renders the dashboard for a signed-in host", async () => {
    const host = await createHost("wan");
    const res = await SELF.fetch("https://example.com/dashboard", { headers: { cookie: host.cookie } });
    expect(res.status).toBe(200);
    expect(await res.text()).toContain("Upcoming");
  });

  it("404s an unknown public profile", async () => {
    const res = await SELF.fetch("https://example.com/nobody");
    expect(res.status).toBe(404);
  });

  it("escapes host-controlled text", async () => {
    const host = await createHost("wan");
    await SELF.fetch("https://example.com/api/event-types", {
      method: "POST",
      headers: { "content-type": "application/json", cookie: host.cookie },
      body: JSON.stringify({ name: "<script>alert(1)</script>", slug: "xss", duration_minutes: 30 }),
    });
    const res = await SELF.fetch("https://example.com/dashboard/event-types", {
      headers: { cookie: host.cookie },
    });
    const html = await res.text();
    expect(html).not.toContain("<script>alert(1)</script>");
    expect(html).toContain("&lt;script&gt;");
  });
});
```

- [ ] **Step 5: Run it and watch it fail**

Run: `npm test -- pages`
Expected: FAIL — 404 on `/login`.

- [ ] **Step 6: Implement `src/views/auth.ts`**

```ts
import { layout } from "./layout";

function field(name: string, label: string, type = "text", extra = ""): string {
  return `
    <div class="mb-4">
      <label class="mf-label" for="${name}">${label}</label>
      <input class="mf-input" id="${name}" name="${name}" type="${type}" ${extra} required>
    </div>`;
}

const TZ_SCRIPT = `
  <script>
    document.addEventListener('DOMContentLoaded', function () {
      var tz = document.getElementById('timezone');
      if (tz && !tz.value) tz.value = Intl.DateTimeFormat().resolvedOptions().timeZone;
    });
  </script>`;

export function loginPage(error?: string): string {
  return layout({
    title: "Sign in",
    nav: "none",
    body: `
      <div class="mx-auto max-w-sm">
        <h1 class="mb-1 text-2xl font-semibold tracking-tight">Sign in</h1>
        <p class="mb-6 text-sm text-[--color-muted]">Welcome back to MeetFlow.</p>
        ${error ? `<p class="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">${error}</p>` : ""}
        <form class="mf-card" method="post" action="/login">
          ${field("email", "Email", "email")}
          ${field("password", "Password", "password")}
          <button class="mf-btn w-full" type="submit">Sign in</button>
        </form>
        <p class="mt-4 text-center text-sm text-[--color-muted]">
          No account? <a class="underline" href="/register">Create one</a>
        </p>
      </div>`,
  });
}

export function registerPage(error?: string): string {
  return layout({
    title: "Create account",
    nav: "none",
    body: `
      <div class="mx-auto max-w-sm">
        <h1 class="mb-1 text-2xl font-semibold tracking-tight">Create your account</h1>
        <p class="mb-6 text-sm text-[--color-muted]">Publish a booking page in two minutes.</p>
        ${error ? `<p class="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">${error}</p>` : ""}
        <form class="mf-card" method="post" action="/register">
          ${field("name", "Name")}
          ${field("email", "Email", "email")}
          ${field("password", "Password", "password", 'minlength="8"')}
          ${field("slug", "Username", "text", 'pattern="[a-z0-9][a-z0-9-]{1,30}[a-z0-9]"')}
          ${field("timezone", "Timezone")}
          <button class="mf-btn w-full" type="submit">Create account</button>
        </form>
      </div>
      ${TZ_SCRIPT}`,
  });
}
```

- [ ] **Step 7: Implement `src/views/dashboard.ts`**

```ts
import { escapeHtml, layout } from "./layout";
import type { BookingWithEvent, DashboardStats } from "../db/bookings";
import type { AvailabilityRuleRow, EventTypeRow, PublicUser } from "../types";
import { utcToZonedParts } from "../lib/timezone";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function fmt(iso: string, timeZone: string): string {
  const p = utcToZonedParts(new Date(iso), timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
}

function statCard(label: string, value: string | number): string {
  return `<div class="mf-card">
    <p class="text-sm text-[--color-muted]">${label}</p>
    <p class="mt-1 text-3xl font-semibold tracking-tight">${value}</p>
  </div>`;
}

export function dashboardPage(
  user: PublicUser,
  stats: DashboardStats,
  recent: BookingWithEvent[],
): string {
  const rows = recent.length
    ? recent
        .map(
          (b) => `<tr class="border-t border-[--color-line]">
            <td class="py-3 pr-4">${escapeHtml(b.guest_name)}</td>
            <td class="py-3 pr-4 text-[--color-muted]">${escapeHtml(b.event_name)}</td>
            <td class="py-3 text-right tabular-nums">${fmt(b.start_at, user.timezone)}</td>
          </tr>`,
        )
        .join("")
    : `<tr><td colspan="3" class="py-6 text-center text-sm text-[--color-muted]">No bookings yet.</td></tr>`;

  return layout({
    title: "Dashboard",
    nav: "host",
    activeNav: "/dashboard",
    hostName: user.name,
    body: `
      <h1 class="mb-6 text-2xl font-semibold tracking-tight">Good day, ${escapeHtml(user.name)}</h1>
      <div class="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        ${statCard("Upcoming", stats.upcoming)}
        ${statCard("Today", stats.today)}
        ${statCard("Total bookings", stats.total)}
        ${statCard("Active event types", stats.activeEventTypes)}
      </div>
      <div class="mf-card">
        <h2 class="mb-4 text-lg font-medium">Recent bookings</h2>
        <table class="w-full text-sm"><tbody>${rows}</tbody></table>
      </div>`,
  });
}

export function eventTypesPage(user: PublicUser, eventTypes: EventTypeRow[]): string {
  const cards = eventTypes.length
    ? eventTypes
        .map(
          (e) => `<div class="mf-card flex items-start justify-between gap-4">
            <div>
              <p class="font-medium">${escapeHtml(e.name)}</p>
              <p class="text-sm text-[--color-muted]">${e.duration_minutes} min${e.is_active ? "" : " · inactive"}</p>
              <p class="mt-2 text-sm"><code class="rounded bg-neutral-100 px-1.5 py-0.5">/${escapeHtml(user.slug)}/${escapeHtml(e.slug)}</code></p>
            </div>
            <div class="flex shrink-0 gap-2">
              <button class="mf-btn-ghost" type="button"
                onclick="navigator.clipboard.writeText(location.origin + '/${escapeHtml(user.slug)}/${escapeHtml(e.slug)}')">
                Copy link
              </button>
            </div>
          </div>`,
        )
        .join("")
    : `<div class="mf-card text-sm text-[--color-muted]">No event types yet. Create your first one below.</div>`;

  return layout({
    title: "Event Types",
    nav: "host",
    activeNav: "/dashboard/event-types",
    hostName: user.name,
    body: `
      <h1 class="mb-6 text-2xl font-semibold tracking-tight">Event types</h1>
      <div class="mb-8 grid gap-4">${cards}</div>
      <form class="mf-card grid gap-4 sm:grid-cols-2" method="post" action="/dashboard/event-types">
        <div><label class="mf-label" for="name">Name</label><input class="mf-input" id="name" name="name" required></div>
        <div><label class="mf-label" for="slug">URL slug</label><input class="mf-input" id="slug" name="slug" required></div>
        <div><label class="mf-label" for="duration_minutes">Duration (minutes)</label>
          <input class="mf-input" id="duration_minutes" name="duration_minutes" type="number" min="5" max="480" value="30" required></div>
        <div><label class="mf-label" for="description">Description</label><input class="mf-input" id="description" name="description"></div>
        <div class="sm:col-span-2"><button class="mf-btn" type="submit">Create event type</button></div>
      </form>`,
  });
}

export function availabilityPage(user: PublicUser, rules: AvailabilityRuleRow[]): string {
  const rows = DAY_NAMES.map((day, index) => {
    const dayRules = rules.filter((r) => r.day_of_week === index);
    const inputs = (dayRules.length ? dayRules : [{ start_time: "", end_time: "" }])
      .map(
        (r) => `<div class="flex items-center gap-2">
          <input class="mf-input w-32" type="time" name="start_${index}" value="${r.start_time}">
          <span class="text-[--color-muted]">–</span>
          <input class="mf-input w-32" type="time" name="end_${index}" value="${r.end_time}">
        </div>`,
      )
      .join("");
    return `<div class="flex flex-col gap-2 border-t border-[--color-line] py-4 sm:flex-row sm:items-center">
      <p class="w-32 shrink-0 text-sm font-medium">${day}</p>
      <div class="flex flex-wrap gap-3">${inputs}</div>
    </div>`;
  }).join("");

  return layout({
    title: "Availability",
    nav: "host",
    activeNav: "/dashboard/availability",
    hostName: user.name,
    body: `
      <h1 class="mb-2 text-2xl font-semibold tracking-tight">Weekly availability</h1>
      <p class="mb-6 text-sm text-[--color-muted]">Times are in ${escapeHtml(user.timezone)}. Leave a day blank to be unavailable.</p>
      <form class="mf-card" method="post" action="/dashboard/availability">
        ${rows}
        <div class="pt-4"><button class="mf-btn" type="submit">Save availability</button></div>
      </form>`,
  });
}

export function bookingsPage(
  user: PublicUser,
  bookings: BookingWithEvent[],
  scope: string,
): string {
  const tab = (value: string, label: string) =>
    `<a href="/dashboard/bookings?scope=${value}" class="rounded-lg px-3 py-2 text-sm ${
      scope === value ? "bg-neutral-100 font-medium" : "text-[--color-muted] hover:bg-neutral-50"
    }">${label}</a>`;

  const rows = bookings.length
    ? bookings
        .map(
          (b) => `<tr class="border-t border-[--color-line] align-top">
            <td class="py-3 pr-4">
              <p class="font-medium">${escapeHtml(b.guest_name)}</p>
              <p class="text-sm text-[--color-muted]">${escapeHtml(b.guest_email)}</p>
              ${b.notes ? `<p class="mt-1 text-sm text-[--color-muted]">${escapeHtml(b.notes)}</p>` : ""}
            </td>
            <td class="py-3 pr-4 text-sm">${escapeHtml(b.event_name)}</td>
            <td class="py-3 pr-4 text-sm tabular-nums">${fmt(b.start_at, user.timezone)}</td>
            <td class="py-3 text-right">
              ${
                b.status === "confirmed"
                  ? `<form method="post" action="/dashboard/bookings/${b.id}/cancel">
                       <button class="mf-btn-ghost" type="submit">Cancel</button>
                     </form>`
                  : `<span class="text-sm text-[--color-muted]">${escapeHtml(b.status)}</span>`
              }
            </td>
          </tr>`,
        )
        .join("")
    : `<tr><td colspan="4" class="py-6 text-center text-sm text-[--color-muted]">Nothing here.</td></tr>`;

  return layout({
    title: "Bookings",
    nav: "host",
    activeNav: "/dashboard/bookings",
    hostName: user.name,
    body: `
      <h1 class="mb-4 text-2xl font-semibold tracking-tight">Bookings</h1>
      <div class="mb-4 flex gap-1">${tab("upcoming", "Upcoming")}${tab("past", "Past")}${tab("cancelled", "Cancelled")}</div>
      <div class="mf-card"><table class="w-full text-sm"><tbody>${rows}</tbody></table></div>`,
  });
}

export function settingsPage(user: PublicUser): string {
  return layout({
    title: "Settings",
    nav: "host",
    activeNav: "/dashboard/settings",
    hostName: user.name,
    body: `
      <h1 class="mb-6 text-2xl font-semibold tracking-tight">Settings</h1>
      <form class="mf-card grid max-w-md gap-4" method="post" action="/dashboard/settings">
        <div><label class="mf-label" for="name">Name</label>
          <input class="mf-input" id="name" name="name" value="${escapeHtml(user.name)}" required></div>
        <div><label class="mf-label" for="timezone">Timezone</label>
          <input class="mf-input" id="timezone" name="timezone" value="${escapeHtml(user.timezone)}" required></div>
        <div><p class="mf-label">Public page</p>
          <p class="text-sm text-[--color-muted]">/${escapeHtml(user.slug)}</p></div>
        <div><button class="mf-btn" type="submit">Save</button></div>
      </form>`,
  });
}
```

- [ ] **Step 8: Implement `src/views/publicBooking.ts`**

```ts
import { escapeHtml, layout } from "./layout";
import { utcToZonedParts } from "../lib/timezone";
import type { BookingRow, EventTypeRow, PublicUser } from "../types";

export function profilePage(host: PublicUser, eventTypes: EventTypeRow[]): string {
  const cards = eventTypes.length
    ? eventTypes
        .map(
          (e) => `<a class="mf-card block transition hover:-translate-y-0.5 hover:shadow-md"
                     href="/${escapeHtml(host.slug)}/${escapeHtml(e.slug)}">
            <p class="font-medium">${escapeHtml(e.name)}</p>
            <p class="text-sm text-[--color-muted]">${e.duration_minutes} min</p>
            ${e.description ? `<p class="mt-2 text-sm text-[--color-muted]">${escapeHtml(e.description)}</p>` : ""}
          </a>`,
        )
        .join("")
    : `<div class="mf-card text-sm text-[--color-muted]">No bookable events right now.</div>`;

  return layout({
    title: host.name,
    nav: "public",
    body: `
      <div class="mx-auto max-w-lg">
        <h1 class="mb-1 text-2xl font-semibold tracking-tight">${escapeHtml(host.name)}</h1>
        <p class="mb-8 text-sm text-[--color-muted]">${escapeHtml(host.timezone)}</p>
        <div class="grid gap-4">${cards}</div>
      </div>`,
  });
}

export function bookingPage(host: PublicUser, eventType: EventTypeRow): string {
  const data = {
    hostSlug: host.slug,
    hostName: host.name,
    hostTimezone: host.timezone,
    eventSlug: eventType.slug,
    eventName: eventType.name,
    durationMinutes: eventType.duration_minutes,
  };

  return layout({
    title: eventType.name,
    nav: "public",
    data,
    body: `
      <div class="mx-auto max-w-3xl" x-data="bookingWidget()" x-init="init()">
        <div class="mf-card grid gap-8 md:grid-cols-[280px_1fr]">
          <div class="md:border-r md:border-[--color-line] md:pr-8">
            <p class="text-sm text-[--color-muted]">${escapeHtml(host.name)}</p>
            <h1 class="mt-1 text-xl font-semibold tracking-tight">${escapeHtml(eventType.name)}</h1>
            <p class="mt-2 text-sm text-[--color-muted]">${eventType.duration_minutes} minutes</p>
            ${eventType.description ? `<p class="mt-4 text-sm text-[--color-muted]">${escapeHtml(eventType.description)}</p>` : ""}
            <p class="mt-4 text-xs text-[--color-muted]">Times shown in <span x-text="guestTimezone"></span></p>
          </div>

          <div x-show="step === 'slot'">
            <label class="mf-label" for="date">Pick a date</label>
            <input class="mf-input mb-4 max-w-xs" id="date" type="date" x-model="date" :min="today" @change="loadSlots()">

            <p x-show="loading" class="text-sm text-[--color-muted]">Loading times…</p>
            <p x-show="!loading && slots.length === 0" class="text-sm text-[--color-muted]">No times available on this date.</p>

            <div class="grid grid-cols-2 gap-2 sm:grid-cols-3" x-show="!loading">
              <template x-for="slot in slots" :key="slot.startAt">
                <button type="button" class="mf-btn-ghost" @click="choose(slot)" x-text="label(slot.startAt)"></button>
              </template>
            </div>
          </div>

          <div x-show="step === 'form'">
            <button type="button" class="mb-4 text-sm text-[--color-muted] underline" @click="step='slot'">← Change time</button>
            <p class="mb-4 font-medium" x-text="summary()"></p>
            <p x-show="error" class="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700" x-text="error"></p>
            <form class="grid gap-4" @submit.prevent="submit()">
              <div><label class="mf-label" for="guest_name">Name</label>
                <input class="mf-input" id="guest_name" x-model="guestName" required></div>
              <div><label class="mf-label" for="guest_email">Email</label>
                <input class="mf-input" id="guest_email" type="email" x-model="guestEmail" required></div>
              <div><label class="mf-label" for="notes">Notes (optional)</label>
                <textarea class="mf-input" id="notes" rows="3" x-model="notes"></textarea></div>
              <button class="mf-btn" type="submit" :disabled="submitting"
                      x-text="submitting ? 'Booking…' : 'Confirm booking'"></button>
            </form>
          </div>
        </div>
      </div>

      <script>
        function bookingWidget() {
          const cfg = JSON.parse(document.getElementById('page-data').textContent);
          return {
            ...cfg,
            guestTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            today: new Date().toISOString().slice(0, 10),
            date: new Date().toISOString().slice(0, 10),
            slots: [], loading: false, step: 'slot', selected: null,
            guestName: '', guestEmail: '', notes: '', error: '', submitting: false,

            init() { this.loadSlots(); },

            async loadSlots() {
              this.loading = true; this.slots = [];
              const url = '/api/public/' + this.hostSlug + '/' + this.eventSlug + '/slots?date=' + this.date;
              const res = await fetch(url);
              if (res.ok) { this.slots = (await res.json()).slots; }
              this.loading = false;
            },

            label(startAt) {
              return new Date(startAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            },

            summary() {
              if (!this.selected) return '';
              return new Date(this.selected.startAt).toLocaleString([], {
                weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit',
              });
            },

            choose(slot) { this.selected = slot; this.error = ''; this.step = 'form'; },

            async submit() {
              this.submitting = true; this.error = '';
              const res = await fetch('/api/public/' + this.hostSlug + '/' + this.eventSlug + '/book', {
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
                const { booking } = await res.json();
                window.location.href = '/booking/' + booking.id + '/confirmed';
                return;
              }
              const body = await res.json().catch(() => ({}));
              this.error = body.error || 'Something went wrong. Please try again.';
              if (res.status === 409) { this.step = 'slot'; this.loadSlots(); }
            },
          };
        }
      </script>`,
  });
}

export function confirmationPage(
  host: PublicUser,
  eventType: EventTypeRow,
  booking: BookingRow,
): string {
  const p = utcToZonedParts(new Date(booking.start_at), booking.timezone);
  const pad = (n: number) => String(n).padStart(2, "0");
  const when = `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;

  return layout({
    title: "Booking confirmed",
    nav: "public",
    body: `
      <div class="mx-auto max-w-md text-center">
        <div class="mf-card">
          <p class="text-3xl">✓</p>
          <h1 class="mt-2 text-xl font-semibold tracking-tight">Booking confirmed</h1>
          <p class="mt-4 text-sm text-[--color-muted]">
            ${escapeHtml(eventType.name)} with ${escapeHtml(host.name)}
          </p>
          <p class="mt-1 font-medium tabular-nums">${when}</p>
          <p class="mt-1 text-sm text-[--color-muted]">${escapeHtml(booking.timezone)}</p>
          <p class="mt-6 text-sm text-[--color-muted]">
            A copy is not emailed yet — please note the time down.
          </p>
        </div>
      </div>`,
  });
}
```

- [ ] **Step 9: Implement `src/routes/pages.ts`**

```ts
import { Hono } from "hono";
import { listRules, replaceRules, type RuleInput } from "../db/availability";
import { dashboardStats, getBookingById, listBookings } from "../db/bookings";
import {
  getPublicEventType,
  insertEventType,
  listEventTypes,
  listPublicEventTypes,
} from "../db/eventTypes";
import { findUserById, findUserBySlug, updateUserSettings } from "../db/users";
import { toMinutes } from "../lib/slots";
import { isoUtc, nowIso } from "../lib/time";
import { isValidTimeZone, zonedDateString, zonedToUtc } from "../lib/timezone";
import { isHhmm, isSlug } from "../lib/validate";
import { clearSession, issueSession, requireAuth } from "../middleware/auth";
import { AuthError, login, register } from "../services/auth";
import { BookingError, cancelOwnedBooking } from "../services/booking";
import { loginPage, registerPage } from "../views/auth";
import {
  availabilityPage,
  bookingsPage,
  dashboardPage,
  eventTypesPage,
  settingsPage,
} from "../views/dashboard";
import { bookingPage, confirmationPage, profilePage } from "../views/publicBooking";
import type { AppEnv } from "../types";

export const pageRoutes = new Hono<AppEnv>();

const html = (body: string, status = 200) =>
  new Response(body, { status, headers: { "content-type": "text/html; charset=utf-8" } });

pageRoutes.get("/", (c) => (c.get("user") ? c.redirect("/dashboard") : c.redirect("/login")));

pageRoutes.get("/login", (c) => (c.get("user") ? c.redirect("/dashboard") : html(loginPage())));
pageRoutes.get("/register", (c) => (c.get("user") ? c.redirect("/dashboard") : html(registerPage())));

pageRoutes.post("/login", async (c) => {
  const form = await c.req.parseBody();
  const user = await login(c.env.DB, String(form.email ?? ""), String(form.password ?? ""));
  if (!user) return html(loginPage("Invalid email or password"), 401);
  await issueSession(c, user.id);
  return c.redirect("/dashboard", 302);
});

pageRoutes.post("/register", async (c) => {
  const form = await c.req.parseBody();
  try {
    const user = await register(c.env.DB, {
      name: String(form.name ?? ""),
      email: String(form.email ?? ""),
      password: String(form.password ?? ""),
      slug: String(form.slug ?? ""),
      timezone: String(form.timezone ?? "UTC"),
    });
    await issueSession(c, user.id);
    return c.redirect("/dashboard", 302);
  } catch (err) {
    if (err instanceof AuthError) return html(registerPage(err.message), err.status as 400);
    throw err;
  }
});

pageRoutes.post("/logout", (c) => {
  clearSession(c);
  return c.redirect("/login", 302);
});

// --- Host dashboard ---------------------------------------------------------

const dashboard = new Hono<AppEnv>();

dashboard.use("*", async (c, next) => {
  if (!c.get("user")) return c.redirect("/login", 302);
  await next();
});

dashboard.get("/", async (c) => {
  const user = c.get("user");
  const now = new Date();
  const today = zonedDateString(now, user.timezone);
  const dayStart = zonedToUtc(today, "00:00", user.timezone);
  const stats = await dashboardStats(
    c.env.DB,
    user.id,
    isoUtc(now),
    isoUtc(dayStart),
    isoUtc(new Date(dayStart.getTime() + 86_400_000)),
  );
  const recent = (await listBookings(c.env.DB, user.id, "upcoming", nowIso())).slice(0, 5);
  return html(dashboardPage(user, stats, recent));
});

dashboard.get("/event-types", async (c) => {
  const user = c.get("user");
  return html(eventTypesPage(user, await listEventTypes(c.env.DB, user.id)));
});

dashboard.post("/event-types", async (c) => {
  const user = c.get("user");
  const form = await c.req.parseBody();
  const slug = String(form.slug ?? "").toLowerCase();
  const duration = Number(form.duration_minutes);
  if (isSlug(slug) && Number.isInteger(duration) && duration >= 5 && duration <= 480) {
    try {
      await insertEventType(c.env.DB, {
        userId: user.id,
        name: String(form.name ?? "").trim(),
        slug,
        description: form.description ? String(form.description).trim() : null,
        durationMinutes: duration,
        now: nowIso(),
      });
    } catch (err) {
      if (!String(err).includes("UNIQUE")) throw err;
    }
  }
  return c.redirect("/dashboard/event-types", 302);
});

dashboard.get("/availability", async (c) => {
  const user = c.get("user");
  return html(availabilityPage(user, await listRules(c.env.DB, user.id)));
});

dashboard.post("/availability", async (c) => {
  const user = c.get("user");
  const form = await c.req.parseBody({ all: true });
  const rules: RuleInput[] = [];

  for (let day = 0; day <= 6; day++) {
    const starts = ([] as unknown[]).concat(form[`start_${day}`] ?? []);
    const ends = ([] as unknown[]).concat(form[`end_${day}`] ?? []);
    for (let i = 0; i < starts.length; i++) {
      const start = String(starts[i] ?? "");
      const end = String(ends[i] ?? "");
      if (!start || !end) continue;
      if (!isHhmm(start) || !isHhmm(end)) continue;
      if (toMinutes(start) >= toMinutes(end)) continue;
      rules.push({ dayOfWeek: day, startTime: start, endTime: end });
    }
  }

  await replaceRules(c.env.DB, user.id, rules, nowIso());
  return c.redirect("/dashboard/availability", 302);
});

dashboard.get("/bookings", async (c) => {
  const user = c.get("user");
  const raw = c.req.query("scope") ?? "upcoming";
  const scope = raw === "past" || raw === "cancelled" ? raw : "upcoming";
  const bookings = await listBookings(c.env.DB, user.id, scope, nowIso());
  return html(bookingsPage(user, bookings, scope));
});

dashboard.post("/bookings/:id/cancel", async (c) => {
  try {
    await cancelOwnedBooking(c.env.DB, Number(c.req.param("id")), c.get("user").id);
  } catch (err) {
    if (!(err instanceof BookingError)) throw err;
  }
  return c.redirect("/dashboard/bookings", 302);
});

dashboard.get("/settings", (c) => html(settingsPage(c.get("user"))));

dashboard.post("/settings", async (c) => {
  const user = c.get("user");
  const form = await c.req.parseBody();
  const timezone = String(form.timezone ?? user.timezone);
  const name = String(form.name ?? user.name).trim();
  if (name && isValidTimeZone(timezone)) {
    await updateUserSettings(c.env.DB, user.id, { name, timezone, now: nowIso() });
  }
  return c.redirect("/dashboard/settings", 302);
});

pageRoutes.route("/dashboard", dashboard);

// --- Public -----------------------------------------------------------------

pageRoutes.get("/booking/:id/confirmed", async (c) => {
  const booking = await getBookingById(c.env.DB, Number(c.req.param("id")));
  if (!booking) return html("<h1>Not found</h1>", 404);
  const host = await findUserById(c.env.DB, booking.user_id);
  const eventType = await c.env.DB
    .prepare("SELECT * FROM event_types WHERE id = ?")
    .bind(booking.event_type_id)
    .first<import("../types").EventTypeRow>();
  if (!host || !eventType) return html("<h1>Not found</h1>", 404);
  return html(confirmationPage(host, eventType, booking));
});

pageRoutes.get("/:username", async (c) => {
  const host = await findUserBySlug(c.env.DB, c.req.param("username").toLowerCase());
  if (!host) return html("<h1>Not found</h1>", 404);
  return html(profilePage(host, await listPublicEventTypes(c.env.DB, host.id)));
});

pageRoutes.get("/:username/:eventSlug", async (c) => {
  const host = await findUserBySlug(c.env.DB, c.req.param("username").toLowerCase());
  if (!host) return html("<h1>Not found</h1>", 404);
  const eventType = await getPublicEventType(c.env.DB, host.id, c.req.param("eventSlug").toLowerCase());
  if (!eventType) return html("<h1>Not found</h1>", 404);
  return html(bookingPage(host, eventType));
});
```

- [ ] **Step 10: Mount pages last in `src/index.ts`**

The catch-all `/:username` route must be registered after every API route:

```ts
import { pageRoutes } from "./routes/pages";
// ... after all app.route("/api/...") calls:
app.route("/", pageRoutes);
```

- [ ] **Step 11: Build the CSS and run the tests**

```bash
npm run css
npm test
```

Expected: `public/app.css` is written, and all suites including `pages` pass.

- [ ] **Step 12: Commit**

```bash
git add -A
git commit -m "feat(ui): add Tailwind shell, host dashboard and public booking page"
```

---

## Phase 6 — Ship

### Task 17: End-to-end check in `wrangler dev`

**Files:**
- Create: `README.md`

- [ ] **Step 1: Set a local session secret**

Create `.dev.vars` (already gitignored):

```text
SESSION_SECRET=local-dev-secret-change-me
```

- [ ] **Step 2: Apply migrations locally and start the dev server**

```bash
npm run db:migrate:local
npm run dev
```

Expected: `Ready on http://localhost:8787`.

- [ ] **Step 3: Walk the Definition of Done by hand**

At `http://localhost:8787`:

1. Register a host (`wan`, `Asia/Kuala_Lumpur`).
2. Create an event type `consultation`, 30 minutes.
3. Set Monday `09:00–12:00`.
4. Open `http://localhost:8787/wan/consultation` in a private window.
5. Pick the next Monday, book `09:00` as a guest.
6. Confirm the confirmation page shows the right local time.
7. Reload the slot list — `09:00` is gone.
8. In the host dashboard, see the booking, cancel it.
9. Reload the guest slot list — `09:00` is back.

- [ ] **Step 4: Write `README.md`**

````markdown
# MeetFlow

Cal.com-style scheduling on Cloudflare Workers + D1. See [PRD.md](PRD.md) and [ERD.md](ERD.md).

## Develop

```bash
npm install
echo "SESSION_SECRET=local-dev-secret-change-me" > .dev.vars
npm run db:migrate:local
npm run dev
```

## Test

```bash
npm test
```

Tests run inside `workerd` with a real local D1 via `@cloudflare/vitest-pool-workers`.

## Deploy

```bash
npx wrangler d1 create meetflow-db          # once; copy the id into wrangler.jsonc
npx wrangler secret put SESSION_SECRET      # a long random string
npm run db:migrate:remote
npm run deploy
```

## Layout

- `src/lib/` — pure, dependency-free logic (time, timezone, slots, crypto, validation)
- `src/db/` — the only files containing SQL
- `src/services/` — business rules
- `src/routes/` — HTTP surface
- `src/views/` — HTML strings
````

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "docs: add README with dev, test and deploy instructions"
```

---

### Task 18: Deploy to Cloudflare

**Files:**
- Modify: `wrangler.jsonc` (nothing if Task 2 already set the id)

- [ ] **Step 1: Set the production secret**

```bash
npx wrangler secret put SESSION_SECRET
```

Paste a long random value. Generate one with:

```bash
node -e "console.log(crypto.randomUUID() + crypto.randomUUID())"
```

- [ ] **Step 2: Apply migrations to the remote D1**

```bash
npm run db:migrate:remote
```

Expected: `🚣 1 migration(s) applied`.

- [ ] **Step 3: Deploy**

```bash
npm run deploy
```

Expected: a `https://meetflow.<subdomain>.workers.dev` URL.

- [ ] **Step 4: Smoke-test production**

```bash
curl -s https://meetflow.<subdomain>.workers.dev/healthz
```

Expected: `{"ok":true}`. Then repeat the Task 17 Step 3 walkthrough against the deployed URL.

- [ ] **Step 5: Verify no secrets leaked into the bundle**

```bash
grep -r "SESSION_SECRET=" public/ 2>/dev/null; echo "exit=$?"
```

Expected: no matches (`exit=1`).

- [ ] **Step 6: Commit**

```bash
git add -A
git commit -m "chore: deploy MeetFlow MVP to Cloudflare Workers"
```

---

## Deferred — do not build in this plan

These are explicitly out of scope (PRD §24) and must not be pulled forward:

- Emails of any kind (needs Queues; the booking service is already the right seam for it)
- Guest self-service reschedule/cancel links
- Date-specific availability overrides, holidays, buffers, minimum notice
- KV caching, R2 uploads, Cron triggers
- Calendar integrations, payments, teams

**One item worth doing right after the MVP:** rate-limit `POST /api/public/:username/:eventSlug/book`
with the Workers Rate Limiting binding. It is a single binding in `wrangler.jsonc` plus three lines
in the route, and the endpoint is unauthenticated. PRD §20 calls for it "when practical" — it is
practical, it is just not on the critical path to a working booking.
