# MeetFlow MVP — Entity Relationship Diagram

## 1. Overview

MeetFlow uses Cloudflare D1 as the primary relational database.

The MVP contains five tables:

```text
users
event_types
availability_rules
bookings
saved_locations
```

Relationship:

```text
users
  |
  +----< event_types
  |
  +----< availability_rules
  |
  +----< bookings
  |          |
  |          +---- event_types
  |
  +----< saved_locations
```

Rendered diagram: [erd.png](erd.png)

---

## 2. Mermaid ERD

```mermaid
erDiagram

    USERS ||--o{ EVENT_TYPES : creates
    USERS ||--o{ AVAILABILITY_RULES : defines
    USERS ||--o{ BOOKINGS : hosts
    USERS ||--o{ SAVED_LOCATIONS : remembers
    EVENT_TYPES ||--o{ BOOKINGS : receives

    USERS {
        INTEGER id PK
        TEXT name
        TEXT email UK
        TEXT password_hash
        TEXT slug UK
        TEXT timezone
        TEXT avatar_key
        TEXT created_at
        TEXT updated_at
    }

    EVENT_TYPES {
        INTEGER id PK
        INTEGER user_id FK
        TEXT name
        TEXT slug
        TEXT description
        INTEGER duration_minutes
        INTEGER buffer_minutes
        TEXT location_type
        TEXT location_value
        INTEGER is_active
        TEXT created_at
        TEXT updated_at
    }

    AVAILABILITY_RULES {
        INTEGER id PK
        INTEGER user_id FK
        INTEGER day_of_week
        TEXT start_time
        TEXT end_time
        INTEGER is_active
        TEXT created_at
        TEXT updated_at
    }

    BOOKINGS {
        INTEGER id PK
        INTEGER user_id FK
        INTEGER event_type_id FK
        TEXT guest_name
        TEXT guest_email
        TEXT start_at
        TEXT end_at
        TEXT timezone
        TEXT status
        TEXT notes
        TEXT reminder_sent_at
        TEXT created_at
        TEXT updated_at
    }

    SAVED_LOCATIONS {
        INTEGER id PK
        INTEGER user_id FK
        TEXT location_type
        TEXT location_value
        TEXT created_at
    }
```

---

## 3. `users`

Stores host accounts.

| Column        | Type    | Required | Description                     |
| ------------- | ------- | -------- | ------------------------------- |
| id            | INTEGER | Yes      | Primary key                     |
| name          | TEXT    | Yes      | Host name                       |
| email         | TEXT    | Yes      | Login email (stored lowercased) |
| password_hash | TEXT    | Yes      | Secure password hash            |
| slug          | TEXT    | Yes      | Public username                 |
| timezone      | TEXT    | Yes      | IANA timezone                   |
| avatar_key    | TEXT    | No       | R2 object key (null = monogram) |
| created_at    | TEXT    | Yes      | Creation timestamp              |
| updated_at    | TEXT    | Yes      | Last update timestamp           |

Constraints:

```sql
PRIMARY KEY (id)
UNIQUE (email)
UNIQUE (slug)
```

`password_hash` format (PBKDF2-SHA256 via Web Crypto):

```text
pbkdf2$<iterations>$<salt-base64>$<hash-base64>
```

Example:

```text
id: 1
name: Wan
email: wan@example.com
slug: wan
timezone: Asia/Kuala_Lumpur
```

Public profile:

```text
/wan
```

---

## 4. `event_types`

Defines meetings that the host offers.

| Column           | Type    | Required | Description                                         |
| ---------------- | ------- | -------- | --------------------------------------------------- |
| id               | INTEGER | Yes      | Primary key                                         |
| user_id          | INTEGER | Yes      | Host                                                |
| name             | TEXT    | Yes      | Event name                                          |
| slug             | TEXT    | Yes      | Public URL slug                                     |
| description      | TEXT    | No       | Event description                                   |
| duration_minutes | INTEGER | Yes      | Meeting duration                                    |
| buffer_minutes   | INTEGER | Yes      | Gap after each booking (0–120, default 0)           |
| location_type    | TEXT    | Yes      | `none`, `google_meet`, `zoom`, `in_person`, `phone` |
| location_value   | TEXT    | No       | Meet/Zoom URL, address, or phone                    |
| is_active        | INTEGER | Yes      | 1 = active, 0 = inactive                            |
| created_at       | TEXT    | Yes      | Creation timestamp                                  |
| updated_at       | TEXT    | Yes      | Last update timestamp                               |

Foreign key:

```text
event_types.user_id
    ->
users.id
```

Constraint:

```sql
UNIQUE(user_id, slug)
```

Example:

```text
name: Consultation
slug: consultation
duration_minutes: 30
```

Public URL:

```text
/wan/consultation
```

`buffer_minutes` is a gap added **after** each meeting of this type. It affects only bookings of
the same event type: those busy intervals are expanded by the buffer when generating slots and
when guarding inserts. Bookings of other event types block by their raw duration. See §9.

`location_type` / `location_value` describe where the meeting happens. `none` means unset.
For `google_meet` and `zoom`, a bare domain is normalised to `https://…` and the value is
remembered in `saved_locations` so later forms can offer it as a choice.

---

## 5. `availability_rules`

Stores recurring weekly availability, expressed in the host's timezone.

| Column      | Type    | Required | Description           |
| ----------- | ------- | -------- | --------------------- |
| id          | INTEGER | Yes      | Primary key           |
| user_id     | INTEGER | Yes      | Host                  |
| day_of_week | INTEGER | Yes      | 0–6                   |
| start_time  | TEXT    | Yes      | HH:MM                 |
| end_time    | TEXT    | Yes      | HH:MM                 |
| is_active   | INTEGER | Yes      | 1 = active            |
| created_at  | TEXT    | Yes      | Creation timestamp    |
| updated_at  | TEXT    | Yes      | Last update timestamp |

Day mapping:

```text
0 = Sunday
1 = Monday
2 = Tuesday
3 = Wednesday
4 = Thursday
5 = Friday
6 = Saturday
```

Example:

```text
Monday
09:00 - 12:00

Monday
14:00 - 17:00
```

These are two rows.

Rules are validated server-side: `start_time < end_time`, both matching `^([01]\d|2[0-3]):[0-5]\d$`,
and `day_of_week BETWEEN 0 AND 6`.

---

## 6. `bookings`

Stores appointments.

| Column           | Type    | Required | Description                                        |
| ---------------- | ------- | -------- | -------------------------------------------------- |
| id               | INTEGER | Yes      | Primary key                                        |
| user_id          | INTEGER | Yes      | Host                                               |
| event_type_id    | INTEGER | Yes      | Event type                                         |
| guest_name       | TEXT    | Yes      | Guest name                                         |
| guest_email      | TEXT    | Yes      | Guest email                                        |
| start_at         | TEXT    | Yes      | UTC start                                          |
| end_at           | TEXT    | Yes      | UTC end                                            |
| timezone         | TEXT    | Yes      | Guest/booking timezone                             |
| status           | TEXT    | Yes      | Booking status                                     |
| notes            | TEXT    | No       | Guest notes                                        |
| reminder_sent_at | TEXT    | No       | When the 24h reminder was queued (null = not sent) |
| created_at       | TEXT    | Yes      | Creation timestamp                                 |
| updated_at       | TEXT    | Yes      | Last update timestamp                              |

Foreign keys:

```text
bookings.user_id
    ->
users.id

bookings.event_type_id
    ->
event_types.id
```

Status values:

```text
confirmed
cancelled
completed
```

`start_at` / `end_at` / `created_at` / `updated_at` are fixed-width ISO-8601 UTC strings:

```text
YYYY-MM-DDTHH:MM:SSZ
```

Fixed width matters: SQLite compares TEXT lexicographically, and this format makes lexicographic
order equal chronological order. Never store a variant with milliseconds or an offset suffix.

`reminder_sent_at` is stamped in the same statement that selects due rows, so overlapping cron
runs cannot send the same guest two reminders.

---

## 7. `saved_locations`

Remembers meeting links a host has used (a Google Meet room, a Zoom URL) so the event-type form
can offer them as a dropdown instead of forcing the host to retype the same URL. Reusing a link
bumps its `created_at` rather than inserting a duplicate.

| Column         | Type    | Required | Description                        |
| -------------- | ------- | -------- | ---------------------------------- |
| id             | INTEGER | Yes      | Primary key                        |
| user_id        | INTEGER | Yes      | Host                               |
| location_type  | TEXT    | Yes      | `google_meet` or `zoom`            |
| location_value | TEXT    | Yes      | The URL                            |
| created_at     | TEXT    | Yes      | Last-used timestamp (newest first) |

Foreign key:

```text
saved_locations.user_id
    ->
users.id
```

Constraint:

```sql
UNIQUE(user_id, location_type, location_value)
```

Only link types are stored here; `in_person` and `phone` values are not remembered.

---

## 8. SQL Schema

Initial D1 schema and subsequent migrations (`migrations/0001_initial.sql` … `0006_buffer_minutes.sql`):

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

-- 0002_avatars.sql
ALTER TABLE users ADD COLUMN avatar_key TEXT;

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

    FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,

    UNIQUE(user_id, slug)
);

-- 0004_event_type_location.sql
ALTER TABLE event_types ADD COLUMN location_type TEXT NOT NULL DEFAULT 'none';
ALTER TABLE event_types ADD COLUMN location_value TEXT;

-- 0006_buffer_minutes.sql
ALTER TABLE event_types ADD COLUMN buffer_minutes INTEGER NOT NULL DEFAULT 0;

CREATE TABLE availability_rules (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    day_of_week INTEGER NOT NULL,
    start_time TEXT NOT NULL,
    end_time TEXT NOT NULL,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT NOT NULL,

    FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE
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

    FOREIGN KEY (user_id)
        REFERENCES users(id),

    FOREIGN KEY (event_type_id)
        REFERENCES event_types(id)
);

-- 0003_reminders.sql
ALTER TABLE bookings ADD COLUMN reminder_sent_at TEXT;

-- 0005_saved_locations.sql
CREATE TABLE saved_locations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id INTEGER NOT NULL,
    location_type TEXT NOT NULL,
    location_value TEXT NOT NULL,
    created_at TEXT NOT NULL,

    FOREIGN KEY (user_id)
        REFERENCES users(id)
        ON DELETE CASCADE,

    UNIQUE(user_id, location_type, location_value)
);
```

---

## 9. Indexes

```sql
CREATE INDEX idx_event_types_user_id
ON event_types(user_id);

CREATE INDEX idx_availability_rules_user_id
ON availability_rules(user_id);

CREATE INDEX idx_availability_rules_user_day
ON availability_rules(user_id, day_of_week);

CREATE INDEX idx_bookings_user_id
ON bookings(user_id);

CREATE INDEX idx_bookings_event_type_id
ON bookings(event_type_id);

CREATE INDEX idx_bookings_start_at
ON bookings(start_at);

CREATE INDEX idx_bookings_user_start
ON bookings(user_id, start_at);

-- Race guard: a host can never hold two confirmed bookings starting at the same instant.
CREATE UNIQUE INDEX idx_bookings_unique_confirmed_start
ON bookings(user_id, start_at)
WHERE status = 'confirmed';

-- Reminder sweep: confirmed bookings still needing a reminder, by start time.
CREATE INDEX idx_bookings_reminder_due
ON bookings(start_at)
WHERE status = 'confirmed' AND reminder_sent_at IS NULL;

CREATE INDEX idx_saved_locations_user
ON saved_locations(user_id, location_type);
```

---

## 10. Booking Overlap

A booking overlaps another booking when:

```text
existing.start_at < requested.end_at
AND
existing.end_at > requested.start_at
```

SQL:

```sql
SELECT id
FROM bookings
WHERE user_id = ?
  AND status = 'confirmed'
  AND start_at < ?   -- requested end_at
  AND end_at > ?     -- requested start_at
LIMIT 1;
```

If a result exists:

```text
The requested slot is unavailable.
```

### Atomic conditional insert

D1 has no interactive transactions, so the check and the insert must be one statement.

The first `NOT EXISTS` is the plain overlap guard. The second is the **buffer guard**: it rejects a
new booking whose window lands inside an existing booking's buffer, but only for bookings of the
same event type (the buffer is a pacing preference, not real busyness).

```sql
INSERT INTO bookings (
    user_id, event_type_id, guest_name, guest_email,
    start_at, end_at, timezone, status, notes, created_at, updated_at
)
SELECT ?, ?, ?, ?, ?, ?, ?, 'confirmed', ?, ?, ?
WHERE NOT EXISTS (
    SELECT 1 FROM bookings
    WHERE user_id = ?
      AND status = 'confirmed'
      AND start_at < ?   -- requested end_at
      AND end_at > ?     -- requested start_at
)
AND NOT EXISTS (
    SELECT 1 FROM bookings
    WHERE user_id = ?
      AND event_type_id = ?   -- same type as the new booking
      AND status = 'confirmed'
      AND start_at < ?        -- requested end_at + buffer
      AND end_at > ?          -- requested start_at − buffer
);
```

`meta.changes === 0` means the slot was taken between slot listing and submission — return
`409 Conflict`. The partial unique index in section 9 is the second line of defence.

---

## 11. Booking Creation Logic

The application must NOT trust the availability returned to the browser.

When creating a booking:

```text
1. Load event type by (host slug, event slug)
2. Verify event type is active
3. Verify event type belongs to host
4. Parse requested date/time
5. Convert to UTC
6. Validate requested slot against availability
7. Check existing overlapping bookings
8. Create booking
9. Return confirmation
```

The availability and overlap checks must happen on the server.

`end_at` is always derived server-side as `start_at + duration_minutes`. The client never sends it.

---

## 12. Data Ownership

A host owns:

```text
users
  |
  +-- event_types
  |
  +-- availability_rules
  |
  +-- bookings
  |
  +-- saved_locations
```

Every authenticated request must verify ownership.

Example:

```sql
SELECT *
FROM event_types
WHERE id = ?
  AND user_id = ?;
```

Never load an event type only by ID for an authenticated operation.

---

## 13. Deletion Rules

### User

Do not physically delete users in the MVP unless required.

### Event Type

Prefer deactivation over deletion.

```text
is_active = 0
```

Historical bookings should remain intact.

### Availability

Availability rules may be deleted and recreated. `PUT /api/availability` replaces the full weekly
set for the host in one D1 `batch()` (delete-all + insert-all).

### Booking

Do not physically delete bookings.

Use:

```text
status = 'cancelled'
```

---

## 14. Timezone Strategy

Store booking timestamps in UTC.

Example:

```text
start_at:
2026-09-21T01:00:00Z

end_at:
2026-09-21T01:30:00Z
```

Store the relevant timezone separately:

```text
Asia/Kuala_Lumpur
```

Never implement timezone conversion manually using fixed offsets.
Use IANA timezone identifiers.

Examples:

```text
Asia/Kuala_Lumpur
Asia/Singapore
Asia/Bangkok
Asia/Jakarta
Europe/London
America/New_York
```

Conversion is done with `Intl.DateTimeFormat` + `formatToParts` (full ICU is available in
`workerd`), which handles DST correctly for zones like `Europe/London` and `America/New_York`.

---

## 15. Future Tables

Do NOT create these tables in the initial MVP unless the feature is actually being implemented:

```text
sessions
calendar_connections
calendar_events
availability_overrides
booking_questions
booking_answers
reminders
webhook_events
email_jobs
teams
team_members
```

Possible future structure:

```text
users
 |
 +-- event_types
 |
 +-- availability_rules
 |
 +-- availability_overrides
 |
 +-- calendar_connections
 |
 +-- bookings
       |
       +-- booking_questions
       +-- booking_answers
       +-- reminders
```

---

## 16. Cloudflare Service Mapping

### D1

Source of truth.

Store:

- Users
- Event types
- Availability
- Bookings
- Saved locations

### KV

Optional cache. Never use KV as the primary source of booking truth.

Potential use:

```text
Public event page cache
Availability cache
Rate limiting
Short-lived sessions
```

### R2

**In use** — host avatars. The `users.avatar_key` column stores the object key; the row remains
null while the host uses their monogram.

### Queues

**In use** — transactional email (booking confirmation, cancellation, reminder). Messages carry a
booking id only; the consumer re-reads D1 at send time.

### Cron

**In use** — hourly reminder sweep, de-duplicated with `bookings.reminder_sent_at`.

---

## 17. Database Principle

D1 is the source of truth.

Critical booking state must always exist in D1.

Do not store the only copy of:

- Booking status
- Booking time
- Availability
- Event configuration

in KV or R2.

---

## 18. MVP Database Philosophy

Keep the schema small.

Do not create tables for future features before they are required.

The database should remain:

```text
users
event_types
availability_rules
bookings
saved_locations
```

This keeps the project easy to understand, test and modify with AI coding agents.
