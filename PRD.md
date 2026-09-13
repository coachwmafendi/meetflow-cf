# MeetFlow MVP — Product Requirements Document

## 1. Product Overview

MeetFlow is a lightweight scheduling and booking SaaS inspired by Cal.com.

The MVP allows a host to:

- Create an account
- Create public event types
- Define weekly availability
- Publish a public booking page
- Let guests select available time slots
- Accept bookings
- View bookings
- Cancel bookings

The product should be built Cloudflare-native and optimized for a simple AI-assisted development workflow.

---

## 2. Product Goal

Build a working scheduling application that proves the core Cal.com-style booking experience without attempting to clone Cal.com.

The first version should prioritize:

1. Simple architecture
2. Reliable booking logic
3. Good UX
4. Cloudflare Free compatibility
5. Easy AI-assisted development
6. Clean code that can be extended later

---

## 3. Target Users

### Host

A person who wants people to book appointments with them.

Examples:

- Consultant
- Freelancer
- Digital marketer
- Salesperson
- Tutor
- Coach
- Agency

### Guest

A visitor who wants to book an appointment.

Guests do not need an account in the MVP.

---

## 4. Technology Stack

### Backend

- TypeScript
- Cloudflare Workers
- Hono

### Database

- Cloudflare D1
- SQLite-compatible SQL

### Frontend

- TypeScript
- Server-rendered HTML (Hono `html` templates)
- Tailwind CSS (built with the Tailwind CLI into `public/app.css`)
- Alpine.js for the interactive date/slot picker

Avoid React/Next.js unless there is a clear technical reason.

### Static assets

Served by the same Worker through the Workers Assets binding (`assets.directory = "./public"`).
No Cloudflare Pages project is required.

### Tooling

- `wrangler` (config in `wrangler.jsonc`)
- `vitest` + `@cloudflare/vitest-pool-workers` (real `workerd` + real local D1 in tests)

### Cloudflare Services

#### Required initially

- Workers
- D1
- Workers Assets
- Durable Objects (SQLite-backed; rate limits the public booking endpoint)
- R2 (host avatars)
- Queues (transactional email)
- Cron Triggers (booking reminders)

#### Add when needed

- KV

The MVP should not add Cloudflare services simply for the sake of using them.

---

## 5. Cloudflare Architecture

```text
                    Browser
                       |
                       v
              Cloudflare Worker
                       |
          +------------+-------------+
          |            |             |
          v            v             v
        Hono       Scheduling      Auth
        Routes       Service       Service
          |            |             |
          +------------+-------------+
                       |
                       v
                      D1
                       |
          +------------+-------------+
          |            |             |
        Users      Event Types    Bookings
                       |
                 Availability
```

Future:

```text
Worker
  |
  +---- D1       -> primary database
  +---- KV       -> cache
  +---- R2       -> files
  +---- Queues   -> background jobs
  +---- Cron     -> scheduled jobs
```

---

## 6. MVP Features

### 6.1 Authentication

Host can:

- Register
- Login
- Logout

Registration fields:

- Name
- Email
- Password
- Username/slug
- Timezone

Example:

```text
Name: Wan
Email: wan@example.com
Username: wan
Timezone: Asia/Kuala_Lumpur
```

Public URL:

```text
/wan
```

#### Implementation constraints (Workers-specific)

- Password hashing uses **PBKDF2-SHA256 via Web Crypto** (`crypto.subtle`). `bcrypt`/`argon2`
  are native modules and do not run on Workers.
- Sessions are **stateless signed cookies** (HMAC-SHA256 over `userId.expiresAt`), signed with
  the `SESSION_SECRET` secret. No `sessions` table in the MVP.
- Cookie flags: `HttpOnly`, `Secure`, `SameSite=Lax`, `Path=/`.

---

## 7. Event Types

A host can create multiple event types.

Example:

```text
Consultation
30 minutes
```

or:

```text
Digital Marketing Consultation
60 minutes
```

Each event type contains:

- Name
- Slug
- Description
- Duration
- Active/inactive status

Example:

```text
Name: Consultation
Slug: consultation
Duration: 30
Description: A 30-minute consultation
```

Public URL:

```text
/wan/consultation
```

---

## 8. Availability

Host defines recurring weekly availability.

Example:

```text
Monday
09:00 - 12:00
14:00 - 17:00

Tuesday
09:00 - 12:00

Wednesday
14:00 - 17:00

Thursday
09:00 - 12:00

Friday
09:00 - 12:00
```

Multiple availability periods may exist on the same day.

Example:

```text
Monday 09:00 - 12:00
Monday 14:00 - 17:00
```

Availability times are expressed in the **host's** timezone.

---

## 9. Booking Flow

### Guest

1. Open public event URL
2. See event information
3. Select date
4. See available time slots
5. Select time
6. Enter:
   - Name
   - Email
   - Optional notes
7. Confirm booking
8. See confirmation page

Example:

```text
Digital Marketing Consultation

30 minutes

Monday, 21 September

Available times:

09:00
09:30
10:00
10:30
11:00

Guest information:

Name
Email
Notes

[ Confirm Booking ]
```

---

## 10. Booking Rules

The system MUST:

- Only show slots inside availability
- Never show slots in the past
- Respect event duration
- Respect host timezone
- Prevent overlapping bookings
- Re-check availability when booking is submitted
- Store booking timestamps consistently
- Store timestamps in UTC
- Display times in the appropriate timezone

---

## 11. Slot Generation

Example:

Event duration:

```text
30 minutes
```

Availability:

```text
09:00 - 11:00
```

Generated slots:

```text
09:00
09:30
10:00
10:30
```

Do not generate:

```text
11:00
```

because a 30-minute event would finish at 11:30.

Slot step size equals the event duration in the MVP.

---

## 12. Double Booking Protection

The system must never rely only on frontend availability.

When a guest submits a booking:

1. Validate event type
2. Validate host
3. Validate requested time
4. Validate timezone
5. Check host availability
6. Check existing bookings
7. Check overlap
8. Create booking
9. Return confirmation

The booking must be revalidated immediately before insertion.

Overlap logic:

```text
existing.start_at < requested.end_at
AND
existing.end_at > requested.start_at
```

If an overlapping confirmed booking exists:

```text
This time slot is no longer available.
```

### Race-condition strategy (Workers-specific)

D1 has no interactive transactions, so a `SELECT` then `INSERT` from two concurrent requests can
both pass the check. The MVP closes the race with two mechanisms:

1. **Conditional insert** — one atomic statement:
   `INSERT INTO bookings (...) SELECT ?,?,... WHERE NOT EXISTS (<overlap query>)`.
   `meta.changes === 0` means the slot was taken.
2. **Partial unique index** — `UNIQUE(user_id, start_at) WHERE status = 'confirmed'`, which makes an
   exact-start duplicate impossible even if the conditional insert is ever bypassed.

If a future version needs strict serialization across variable-duration events, promote the
per-host booking write path to a Durable Object. Not required for the MVP.

---

## 13. Timezone

Each host has a default timezone.

Example:

```text
Asia/Kuala_Lumpur
```

Bookings are stored in UTC.

Example:

```text
2026-09-21T01:00:00Z
```

The UI converts the timestamp for display.

Do not manually add/subtract timezone offsets.
Use a proper timezone-aware implementation.

### Implementation

Workers ships full ICU, so no timezone library is needed.
Conversion uses `Intl.DateTimeFormat` with `timeZone` + `formatToParts` to derive the real UTC
offset at a given instant (DST included). See `src/lib/timezone.ts` in the implementation plan.

Timestamps are stored as fixed-width ISO-8601 UTC strings (`YYYY-MM-DDTHH:MM:SSZ`, no
milliseconds) so that SQLite lexicographic string comparison equals chronological comparison.

---

## 14. Dashboard

Host dashboard navigation:

```text
Dashboard
Event Types
Availability
Bookings
Settings
```

Dashboard should show:

- Upcoming bookings
- Today's bookings
- Total bookings
- Active event types

Example:

```text
Good morning, Wan

Upcoming
3 bookings

Today
2 bookings

Event Types
4 active

Recent Bookings
--------------------------------
Ahmad     Consultation    10:00
Ali       Consultation    14:30
Sarah     Demo            16:00
```

---

## 15. Event Type Management

Host can:

- Create event type
- Edit event type (`/dashboard/event-types/:id`)
- Activate event type
- Deactivate event type
- Delete event type
- Copy public URL

Delete is safe by construction: an event type with bookings is deactivated instead of removed,
so historical bookings keep their event name. The button text says which will happen.

Event type card:

```text
Consultation
30 min

/wan/consultation

[Copy Link] [Edit]
```

---

## 16. Booking Management

Host can view:

- Upcoming bookings
- Past bookings
- Cancelled bookings

Booking information:

- Guest name
- Guest email
- Event type
- Start time
- End time
- Timezone
- Status
- Notes

Statuses:

```text
confirmed
cancelled
completed
```

---

## 17. Cancellation

Host can cancel a booking.

For MVP:

```http
POST /api/bookings/:id/cancel
```

Cancelled bookings remain in the database.
Do not physically delete booking records.

---

## 18. Public Booking Page

The public booking page should have a premium modern SaaS aesthetic.

Design inspiration:

- Cal.com
- Stripe
- Linear
- modern SaaS dashboards

Avoid:

- Default Laravel styling
- Generic Bootstrap appearance
- Excessive gradients
- Overly complicated UI

The page should be:

- Responsive
- Fast
- Accessible
- Mobile friendly

### Theming

Light and dark are both supported and follow the visitor's OS preference. Hosts additionally
get a toggle in the dashboard header that cycles light → dark → follow-the-OS and persists in
`localStorage`; guests follow their OS only, to keep the booking page uncluttered.

Dark mode is a pure design-token swap — there are no `dark:` variants in the markup.

---

## 19. API

### Authentication

```http
POST /api/auth/register
POST /api/auth/login
POST /api/auth/logout
```

### Event Types

```http
GET    /api/event-types
POST   /api/event-types
GET    /api/event-types/:id
PATCH  /api/event-types/:id
DELETE /api/event-types/:id
```

### Availability

```http
GET /api/availability
PUT /api/availability
```

### Public Booking

```http
GET  /api/public/:username/:eventSlug
GET  /api/public/:username/:eventSlug/slots?date=YYYY-MM-DD&tz=<IANA>
POST /api/public/:username/:eventSlug/book
```

### Bookings

```http
GET  /api/bookings
GET  /api/bookings/:id
POST /api/bookings/:id/cancel
```

### HTML pages

```text
GET /                       marketing / redirect to dashboard
GET /register
GET /login
GET /dashboard
GET /dashboard/event-types
GET /dashboard/availability
GET /dashboard/bookings
GET /dashboard/settings
GET /:username
GET /:username/:eventSlug
GET /booking/:id/confirmed
```

---

## 20. Security

The application must:

- Hash passwords securely
- Never return password hashes
- Validate all server-side input
- Protect authenticated routes
- Enforce ownership of resources
- Prevent cross-user data access
- Validate public booking requests
- Prevent manipulation of booking timestamps
- Use server-generated IDs
- Rate-limit public endpoints when practical

Unauthenticated endpoints are rate limited per client IP, keyed on `CF-Connecting-IP`
(edge-set, so a client cannot spoof it). Over the limit returns `429` with `Retry-After`.

| Action   | Limit       | Endpoints sharing the counter                |
| -------- | ----------- | -------------------------------------------- |
| Book     | 10 / minute | `POST /api/public/:username/:eventSlug/book` |
| Log in   | 10 / minute | `POST /api/auth/login`, `POST /login`        |
| Register | 5 / hour    | `POST /api/auth/register`, `POST /register`  |

The JSON API and the HTML form for one action **must** share a bucket, otherwise an attacker
doubles their budget by alternating entry points.

Limits are tunable per bucket via the `RATE_LIMIT_OVERRIDES` JSON variable (for example
`{"book":50}`). It is intentionally per-bucket rather than a single global number: raising one
endpoint must never quietly raise the auth limits. Malformed, unknown or non-positive entries
are ignored rather than treated as unlimited.

Auth limits are not only about credential stuffing: every login attempt runs PBKDF2 at 100k
iterations — including for an unknown email, because the lookup miss is deliberately
timing-equalised — so an unauthenticated caller can force expensive CPU work. The limit caps
that too. Throttled form posts re-render the page with the error rather than returning JSON.

This is implemented with the `RateLimiter` Durable Object, **not** the Workers Rate Limiting
binding. That binding was tried first: it configures cleanly and appears in `wrangler deploy`
output, but does not reject on this account — verified in production at `limit: 2, period: 60`
with 8 sequential requests from a single IP, all allowed.

A host must never be able to access another host's:

- Event types
- Availability
- Bookings
- Settings

Additional MVP requirements:

- `end_at` is always computed on the server from `start_at + duration_minutes`. The client never
  supplies `end_at`.
- The submitted `start_at` must land exactly on a generated slot boundary; arbitrary timestamps
  are rejected.
- Reserved usernames (`api`, `dashboard`, `login`, `register`, `booking`, `public`, `assets`,
  `static`, `admin`) may not be registered as a host slug.

---

## 21. Database

Core tables:

```text
users
event_types
availability_rules
bookings
```

See [ERD.md](ERD.md) for the complete schema.

---

## 22. Cloudflare Services Strategy

### Workers

Primary application runtime.

Used for:

- API
- authentication
- booking engine
- HTML rendering
- public pages

### D1

Source of truth for application data.

Used for:

- users
- event types
- availability
- bookings

### KV

Do not use initially.

Future use:

- Public booking cache
- Rate limits
- Short-lived cache
- Session-related cache

### R2

**In use** — host avatars. This is a deliberate departure from the original "do not use
initially" position, made at the product owner's request after the MVP shipped.

Objects are served back through the Worker rather than from a public bucket URL, so the
response carries the Content-Type sniffed at upload plus `nosniff` and a sandboxing CSP.
Uploads are validated by magic bytes, not by the declared Content-Type or filename, and SVG
is rejected outright because it can carry script.

Future use:

- Uploaded images
- Files

### Queues

Do not use initially.

Future use:

- Confirmation emails
- Reminder emails
- Calendar synchronization
- Webhook processing

### Cron Triggers

Do not use initially.

Future use:

- Booking reminders
- Maintenance
- Cleanup
- Calendar synchronization

---

## 23. Email

**Implemented** via Resend (REST, no SDK) with Cloudflare Queues for delivery and a Cron
trigger for reminders.

| Trigger               | Recipient | Template     |
| --------------------- | --------- | ------------ |
| Booking created       | Guest     | Confirmation |
| Booking created       | Host      | New booking  |
| Host cancels          | Guest     | Cancellation |
| 24 hours before start | Guest     | Reminder     |

Reschedule notification remains out of scope, since guests cannot reschedule yet.

Rules:

- Sending happens off the request path. A booking must never fail or hang because the mail
  provider is slow.
- Queue messages carry only a booking id. The consumer re-reads from D1 at send time, so state
  that changed after enqueue (a cancellation, a deletion) is respected.
- Transient failures (429, 5xx, network) are retried by the queue; permanent ones (4xx) are
  acked and logged so a single bad address cannot block a batch. Exhausted messages go to a
  dead-letter queue.
- Reminders are de-duplicated with `bookings.reminder_sent_at`, stamped in the same statement
  that selects the due rows so overlapping cron runs cannot double-send.
- With no `RESEND_API_KEY` configured the application behaves normally and sends nothing.

---

## 24. Out of Scope

Do NOT build these in MVP:

- Google Calendar
- Microsoft Outlook
- Apple Calendar
- Google Meet
- Zoom
- Microsoft Teams
- Stripe
- Payments
- SMS
- WhatsApp
- Team scheduling
- Round robin
- Group bookings
- Recurring meetings
- Custom domains
- Mobile apps
- Advanced analytics
- Workflow automation
- AI scheduling
- Calendar synchronization
- Guest self-service reschedule/cancel
- Date-specific availability overrides and holidays
- Buffers, minimum notice, daily booking limits

These may be added later.

---

## 25. Development Phases

### Phase 1 — Foundation

- Cloudflare Worker
- TypeScript
- Hono
- D1
- Database migrations
- Tailwind
- Application shell

### Phase 2 — Core engine

- Password hashing
- Session tokens
- Timezone conversion
- Slot generation

### Phase 3 — Host

- Registration
- Login
- Dashboard
- Event types
- Availability
- Settings

### Phase 4 — Guest

- Public profile
- Public event page
- Date selector
- Available slots
- Booking form
- Confirmation page

### Phase 5 — Reliability

- Double-booking protection
- Validation
- Error handling
- Timezone handling
- Ownership checks

### Phase 6 — Optional Cloudflare Services

Only after MVP works:

- Queues
- KV
- R2
- Cron
- Rate Limiting binding

---

## 26. Definition of Done

MVP is complete when:

- Host can register
- Host can log in
- Host can create an event type
- Host can define availability
- Host gets a public booking URL
- Guest can open the URL
- Guest can select a date
- Guest can select an available slot
- Guest can enter name and email
- Guest can submit booking
- Booking is stored in D1
- Booked slot becomes unavailable
- Double booking is prevented
- Host can see bookings
- Host can cancel bookings
- Timezones work correctly
- App runs on Cloudflare Workers
- App works without a traditional VPS
- `npm test` passes with the booking-engine tests green

---

## 27. Development Principle

Do not over-engineer.

Prefer:

```text
Simple
Explicit
Typed
Testable
Cloudflare-native
```

Avoid introducing a library unless it solves a real MVP problem.

The application should remain easy for an AI coding agent to understand and modify.
