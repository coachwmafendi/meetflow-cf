# Design: Guest rescheduling

Date: 2026-09-14 · Status: approved by user

Guests can move a booking to a different slot of the **same event type** via a
signed link, without creating a second booking. Hosts keep today's cancel-only
dashboard.

## Links and tokens

- Reuses the existing HMAC token scheme (`src/lib/cancelToken.ts`): a token
  signs exactly one booking id under the `booking-cancel` purpose. A token
  holder may manage that booking — cancel or reschedule. Old confirmation
  emails' cancel links therefore also work on the reschedule page; this is
  acceptable (the link is the authorisation, whoever holds it).
- New helpers `reschedulePath(bookingId, secret)` and
  `rescheduleUrl(appUrl, bookingId, secret)` mirror `cancelPath`/`cancelUrl`.
- Confirmation page renders a **Reschedule** button next to "Cancel booking";
  the guest confirmation email gains a secondary "Reschedule" link.

## Pages

- `GET /booking/:id/reschedule?token=…` (rate-limited like guest cancel):
  resolves the token; rejects cancelled and past bookings with the existing
  friendly error page; otherwise renders the booking page in **reschedule
  mode** — same three-panel layout, with the currently-booked time shown in the
  left rail and a "Currently: …" banner.
- The booking widget gains an optional `reschedule` config
  (`{ bookingId, token, oldStartAt, oldTimezone }`): picking a slot opens the
  form step with a "Confirm new time" button; submit POSTs
  `/booking/:id/reschedule` with `{ token, start_at, timezone }` instead of the
  public book endpoint; success redirects to the new booking's confirmation
  page.
- Slot validation is identical to booking: on the grid, free (buffer-aware),
  in the future. 409/422 returns to the slot step with an error and refreshed
  slots, exactly like the book flow.

## Service

`rescheduleBooking(db, { bookingId, token, secret, newStartAt, guestTimezone,
nowMs })` in `src/services/booking.ts`:

1. Verify token → booking id must match path id.
2. Load booking: must be `confirmed` and `end_at > now`.
3. Re-derive host-local date and validate the new start against
   `getDaySlots` (grid + free) with the event type's buffer.
4. Call `rescheduleBookingIfFree` (new, in `src/db/bookings.ts`) — a **D1
   batch**, atomic:
   - Statement 1: conditional INSERT of the new booking (same
     `NOT EXISTS` guards as `insertBookingIfFree`, including the buffered
     same-type guard), `RETURNING *`.
   - Statement 2: `UPDATE … SET status='cancelled' WHERE id = old AND
status='confirmed' RETURNING id`.
   - Outcomes: insert row + cancel row → success. No insert row → 409 (slot
     gone; old booking untouched). Insert row but no cancel row (old booking
     was cancelled in a race) → compensating cancel of the new booking, then 409.
5. The new booking copies `guest_name`, `guest_email`, `notes` from the old
   one; `timezone` is the guest's current zone.

## Emails

- Route queues `queueBookingCreated(newBookingId)` — the guest gets a fresh
  confirmation and the host a new-booking notification (host sees the change;
  no "rescheduled" wording in v1). The old booking is cancelled silently.
- `BookingEmailContext` gains `rescheduleUrl?: string`; `loadContext` computes
  it for guest-facing `booking_confirmed` jobs. `render()` gains an optional
  secondary `cta2` rendered as a text link; `guestConfirmation` shows
  "Reschedule" beside the cancel CTA.

## Guards and errors

- Invalid/foreign token → "This reschedule link is not valid." error page (404).
- Cancelled or past booking → same friendly error page (409 wording unchanged).
- Rescheduling does not touch `reminder_sent_at` of the old booking (it is
  cancelled, so the sweep skips it); the new booking gets its own reminder
  normally.

## Files

- `src/lib/cancelToken.ts` — `reschedulePath` / `rescheduleUrl`
- `src/db/bookings.ts` — `rescheduleBookingIfFree` (D1 batch)
- `src/services/booking.ts` — `rescheduleBooking`
- `src/routes/pages.ts` — GET/POST reschedule routes, confirmation page href
- `src/views/publicBooking.ts` — reschedule mode in `bookingPage` + widget;
  `confirmationPage` gains a Reschedule button
- `src/services/email.ts`, `src/lib/emailTemplates.ts` — reschedule link in
  guest confirmation email
- tests: `reschedule.service.test.ts` (new), `pages.test.ts`, `emailTemplates.test.ts`

## Out of scope

- Host-initiated rescheduling from the dashboard.
- Changing event type, name, email or notes during reschedule.
- "Rescheduled" wording in the host email (they receive a standard new-booking
  notification).

## Testing

- Service: happy path (new booking created, old cancelled, details copied);
  invalid token; cancelled booking; past booking; slot off-grid → 422; slot
  taken → 409 with old booking untouched; buffered slot rejected; race
  compensation (old already cancelled → new rolled back, 409).
- Pages: reschedule page renders for a valid link; 404/409 for invalid/past;
  confirmation page shows the Reschedule button.
- Templates: guest confirmation includes the reschedule link when present;
  host mail does not.
