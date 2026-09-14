# Design: Buffer time between meetings

Date: 2026-09-14 · Status: approved by user

A per-event-type gap added **after each meeting** so the host is never
back-to-back. One number (`buffer_minutes`, 0–120, default 0) configured on the
event type.

## Data model

- Migration `0006_buffer_minutes.sql`:
  `ALTER TABLE event_types ADD COLUMN buffer_minutes INTEGER NOT NULL DEFAULT 0;`
- `EventTypeRow.buffer_minutes: number`.
- `InsertEventTypeInput` / `UpdateEventTypeInput` gain `bufferMinutes`.

## Availability semantics

Buffer applies only to bookings **of the same event type**:

- `listConfirmedBetween` selects `event_type_id` alongside `start_at`/`end_at`
  (`BusyInterval` gains `event_type_id`).
- `getDaySlots` / `getMonthFreeDays` widen each busy interval of a same-type
  booking on **both sides** by `bufferMinutes` (`start − buffer` … `end +
buffer`). Symmetric with the insert guard, so the grid never shows a slot the
  guard would reject: a candidate must not start inside a prior meeting's
  trailing buffer, nor end inside a later meeting's leading buffer.
  Bookings of other types still block by their raw duration (the host is
  literally busy; the buffer is only a pacing preference).
- The slot grid itself stays dense (duration step) — slots disappear only
  around actual bookings, matching cal.com.
- `SlotQuery` and `MonthQuery` gain `bufferMinutes`; the routes pass
  `eventType.buffer_minutes`.

## Race safety on insert

`insertBookingIfFree` adds a second `NOT EXISTS` guard (same event type) that
rejects a new booking whose window lands inside an existing booking's buffer:

```
start_at < (newEnd + buffer) AND end_at > (newStart − buffer)
```

`InsertBookingInput` gains `bufferMinutes`; `createBooking` passes the event
type's value. Two concurrent guests can therefore never create meetings closer
than the buffer.

## API and forms

- `POST /api/event-types` and `PATCH /api/event-types/:id` accept
  `buffer_minutes` (integer 0–120, default 0). PATCH merge semantics: omitted
  means unchanged.
- Create modal: "Buffer after meeting" number input (min 0, max 120, step 5,
  default 0) next to Duration; submitted with the API payload.
- Edit page: same field; the POST route validates and keeps the draft value on
  error.
- Legacy create route, toggle, deactivate-delete and clone all preserve the
  stored value (clone copies it).

## Booking page

No change — availability is already computed with the buffer. Nothing new to
display.

## Out of scope

- Buffer **before** meetings (single after-only value).
- Per-weekday or per-user buffer settings.

## Files

- `migrations/0006_buffer_minutes.sql` (new)
- `src/types.ts`, `src/db/eventTypes.ts`, `src/db/bookings.ts`
- `src/services/availability.ts`, `src/services/booking.ts`
- `src/routes/api.eventTypes.ts`, `src/routes/api.public.ts`, `src/routes/pages.ts`
- `src/views/dashboard.ts` (create modal + edit page)
- tests: availability, booking insert, API, pages

## Testing

- Unit/integration: same-type booking expands buffer (a following slot inside
  the gap disappears); other-type booking does not expand; month free-days
  respect buffer; `insertBookingIfFree` rejects a slot inside another booking's
  buffer and accepts one exactly at the gap boundary; API validates range;
  PATCH merge leaves buffer unchanged when omitted; clone copies buffer.
