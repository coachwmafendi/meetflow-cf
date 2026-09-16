# Global Search (Command Palette) Design

**Date:** 2026-09-15
**Status:** Approved (approach 1 — server-side search API)

## Goal

One search that finds anything in a host's workspace — bookings, event types, attendees —
plus quick navigation and actions, from anywhere in the host dashboard via a ⌘K command
palette (Cal.com-style).

## Scope

**In:**

- `⌘K` / `Ctrl+K` toggles a centered palette overlay on any host dashboard page; a search
  button in the sidebar does the same for mouse users.
- Results grouped: **Actions**, **Navigation**, then data results — **Bookings**,
  **Event types**, **Attendees** (≤5 each).
- Empty query shows Actions + Navigation + "Recent" (the 3 latest bookings).
- Keyboard: ↑/↓ move the selection, Enter opens it, Esc closes; mouse click works too.
- Server-side search endpoint with debounced fetch.

**Out:**

- Guest/public-page search (guests have nothing to search).
- Full-text relevance ranking, search-as-you-type caching beyond the request abort.
- Booking detail page (booking results link to the bookings page; a detail page may come later).

## UX

- Palette opens centered over a dark backdrop; backdrop click or Esc closes it; focus goes
  to the input, which is autofocused on open and cleared each open.
- Result rows: icon + primary label + secondary detail (e.g. booking: guest name + email;
  event type: name + slug; attendee: name + email).
- Click targets:
  - Booking / attendee → `/dashboard/bookings`
  - Event type → `/dashboard/event-types/:id` (edit page)
  - Navigation → the destination page
  - "New event type" action → `/dashboard/event-types` (the create modal lives there)
- Selected row is highlighted; selection follows ↑/↓ and wraps; Enter follows the target.
- While loading, results stay until replaced (no layout flash); a failed request shows a
  single "Search is unavailable right now" row. Fail-open, never an error overlay.

## API

`GET /api/search?q=<query>`

- Host session required (401 otherwise). Same auth middleware as the other `/api` routes.
- `q`: trimmed, max 100 chars. Empty (or missing) `q` returns the recents shape only.
- Response:

```json
{
  "bookings": [
    {
      "id": 1,
      "guestName": "Ahmad",
      "guestEmail": "a@b.co",
      "startAt": "…",
      "status": "confirmed",
      "eventTypeName": "Consultation"
    }
  ],
  "eventTypes": [{ "id": 2, "name": "Consultation", "slug": "consultation", "isActive": 1 }],
  "attendees": [{ "bookingId": 1, "guestName": "Sara", "guestEmail": "s@b.co" }]
}
```

- Bookings: `LIKE '%q%'` over `guest_name`, `guest_email`, `notes` (all statuses), newest
  first, joined to the event type name, `LIMIT 5`.
- Event types: `LIKE '%q%'` over `name`, `slug`, `description`, `LIMIT 5`.
- Attendees: `LIKE '%q%'` over `booking_attendees.guest_name` / `guest_email`, joined to
  `bookings` for host ownership, `LIMIT 5`.
- Recents (empty `q`): 3 latest bookings, same booking shape.
- `%` and `_` in `q` are escaped and the queries use `ESCAPE '\'`.
- Every query is scoped to the host's `user_id` — cross-host leakage is impossible.
- Rate limited like other endpoints (new `LIMITS.search`, generous — it's keystroke-driven).

## Frontend

- Markup + Alpine component live in `hostLayout` (host-only); guests never load it.
- `⌘K`/`Ctrl+K` window keydown listener toggles the overlay; sidebar search button too.
- Fetch fires ≥200ms after the last keystroke; an `AbortController` cancels the in-flight
  request when a new one starts or the palette closes.
- All dynamic strings are escaped with `escapeHtml`.
- No schema changes, no new indexes (`LIKE '%q%'` scans are fine at MVP scale).

## Testing

Integration (`test/integration/search.test.ts`):

- 401 for anonymous callers.
- Host isolation: host B's booking/event type never appears in host A's results.
- Finds a booking by guest name, email, and notes; by event type name and slug; by
  attendee name and email.
- Empty query returns 3 recent bookings and no match groups.
- `%` / `_` in the query are treated literally (escaped).
- Over-100-char query rejected (400).

Markup/pages test:

- Host layout contains the sidebar search button and the palette markup; guest-facing
  pages do not.

## Docs

- PRD: §14 Dashboard gains the palette; §19 API gains `GET /api/search`.
- ERD: unchanged (no schema changes).
