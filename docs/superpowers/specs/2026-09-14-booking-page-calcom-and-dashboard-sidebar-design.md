# Design: cal.com-style booking page + dashboard sidebar

Date: 2026-09-14 · Status: approved by user

Two UI changes, independent of each other:

1. **Public booking page** — rebuilt to match cal.com's booking UX
   (reference: https://cal.com/wmafendi/30min?overlayCalendar=true&month=2026-10).
2. **Host dashboard** — navigation moves from a top bar to a left sidebar with icons.

---

## Part 1 — Public booking page (cal.com style)

### Architecture

**Endpoint (new):** `GET /api/public/:username/:eventSlug/month?year=YYYY&month=M`

- `M` is 1-based (1–12).
- Response: `{ "days": ["2026-10-05", "2026-10-12", ...] }` — host-local dates with at
  least one free slot, sorted ascending.
- Validation reuses the existing `resolvePublicTarget` and returns the same
  `BookingError` JSON shapes on failure.
- Cost control: exactly **2 D1 queries** per request —
  - `listRules(db, hostId)` (already exists: all active weekly rules), and
  - `listConfirmedBetween(db, hostId, monthStartUtc, monthEndExclusiveUtc)`
    (already exists; range = first slot start of the 1st through last slot end of
    the last day).
  - Per-day slot generation runs in JS (reuse `generateSlotStarts`, `zonedToUtc`,
    `removeBusy`, `removePast` from `src/lib/slots.ts` / `src/lib/timezone.ts`).
  - Clamp the range to the current month going forward: months fully in the past
    return `{ days: [] }` cheaply.
- Lives in `src/services/availability.ts` as `getMonthFreeDays(db, q)` and is
  wired in `src/routes/api.public.ts`.

The existing `GET /:username/:eventSlug/slots` endpoint is unchanged and still
drives the time list.

### Page structure (desktop)

One card, three columns (cal.com's proportions):

| Column | Width | Content |
|---|---|---|
| Left rail | ~17rem | Avatar → host name (links to `/:slug`), event title, `30m` duration chip, timezone `<select>` |
| Middle | flexible | Month calendar |
| Right | ~15rem | Selected-day header, 12h/24h toggle, vertical time list |

- **Timezone select** is the guest's timezone (autodetect to browser zone). It is
  functional: changing it re-renders time labels in that zone and is submitted
  as `timezone` on booking. Built from the existing `timezoneSelect()` +
  `TIMEZONE_SCRIPT` (the select is not a plain `<select name>`; it is an Alpine
  model, so the population script needs a tiny opt-out: pass a `data-timezone`
  control whose option list is filled by `TIMEZONE_SCRIPT`, then `@change` reads
  `select.value` into Alpine state — verified in implementation).
- **Calendar**: header `October 2026` with prev/next chevron buttons; Sun–Sat
  weekday row; 6×7 grid of day buttons.
  - Past days: `disabled`, muted.
  - Future days with no free slots (per month endpoint): `disabled`, muted.
  - Days with slots: enabled, hover affordance.
  - Selected: filled (primary background), high contrast.
  - Today: ring/outline.
- **Time list** (right column): header shows the selected weekday + ordinal
  ("Thu 1st"). Below it a segmented 12h/24h control. Slots render as a vertical
  list of full-width time buttons (cal.com list style, max-height with scroll),
  labelled in the selected guest timezone.
- Clicking a time advances to the existing **form step** (name/email/notes,
  confirm) — unchanged behaviour, still rendered inside the card.
- Empty states: "No times on this date" when a day has slots but the fetch
  returns none (transient), same styling as today.
- Footer: keep the centered "Powered by MeetFlow" text. Public header (wordmark)
  stays.

### Mobile

Stacks: user info → calendar → time list below the calendar. The 12h/24h toggle
stays with the time list. Day grid cells get a slightly larger tap target.

### Widget behaviour (Alpine)

State: `viewYear`, `viewMonth` (0-based), `days` (array from month endpoint),
`selectedDate`, `slots`, `hour12` (defaults from browser locale), `guestTimezone`.

- `init()`: load current month's availability; preselect nothing.
- `prevMonth()` / `nextMonth()`: clamp so users cannot navigate into the past
  before the current month; re-fetch availability; clear day selection.
- `pickDay(date)`: sets `selectedDate`, fetches slots for that date, shows the
  right column.
- `toggleHour12()`: re-renders labels only (no re-fetch).
- Timezone change: re-renders labels only (slot instants are UTC; display
  changes, set is identical).
- Booking submit keeps `timezone: this.guestTimezone` (now the select's value).

### Explicitly out of scope

- "Overlay my calendar" toggle (needs external calendar sync).
- Weekly / column view switchers.
- Location chips (Google Meet etc.) — no video integration exists.
- Any change to availability rules, booking flow, or emails.

### Files

- `src/services/availability.ts` — add `getMonthFreeDays`.
- `src/routes/api.public.ts` — add `GET .../month`.
- `src/views/publicBooking.ts` — rewrite `bookingPage()` + widget script.
- `src/views/ui.ts` — add `chevronLeft` icon (calendar prev); possibly `menu` icon
  (see Part 2).
- `src/styles/app.css` — calendar grid, day states, time list, segmented toggle,
  three-column booking card.

---

## Part 2 — Dashboard left sidebar with icons

### Architecture

`layout({ nav: "host", ... })` renders a persistent app shell instead of the
current sticky top header:

```
<body>
  <div class="app-shell">        ← flex, min-h-full
    <aside class="sidebar">      ← fixed width ~15rem, full height, border-r
      wordmark
      nav links (icons + labels)
      spacer
      theme toggle + avatar/name + sign out
    </aside>
    <div class="app-main">       ← flex-1, scrollable
      <main>…existing width-constrained body…</main>
    </div>
  </div>
</body>
```

### Navigation

Each item: icon + label, rounded, `ui-nav-link` styling reused, active item
filled (`ui-nav-link-active` + icon emphasized).

| Item | Icon (SVG, new or existing) |
|---|---|
| Dashboard | grid (new 4-square icon) |
| Event Types | `layers` (existing) |
| Availability | `clock` (existing) |
| Bookings | `calendar` (existing) |
| Settings | `settings` (existing) |

Bottom block: existing theme toggle button, avatar + host name (non-link,
display only), sign-out button (`logOut` icon, label "Sign out").

### Responsive

- **≥ md**: sidebar visible, fixed; main content stays centered at `max-w-5xl`.
- **< md**: sidebar hidden. A slim top bar shows the wordmark + hamburger
  (new `menu` icon). Tapping opens the sidebar as a slide-in drawer with a
  backdrop (Alpine state in the shell; closes on link tap or backdrop tap).
  The existing mobile nav row is removed.

### Behaviour notes

- Theme toggle script keeps working unchanged (it targets `#theme-toggle`).
- Active state comes from the existing `activeNav` option — no page changes.
- The sign-out stays a small `POST /logout` form.

### Files

- `src/views/layout.ts` — replace `hostNav()` with sidebar shell + mobile drawer.
- `src/views/ui.ts` — add `menu` and grid icons.
- `src/styles/app.css` — sidebar, nav item, drawer styles.

---

## Cross-cutting

- Icons are inline SVGs from `ICON_PATHS` in `src/views/ui.ts`; no icon library.
- All new markup must match existing class conventions (`ui-*` components,
  semantic tokens only, no raw colour values).
- Typecheck: `npm run typecheck` · Tests: `npm test` · CSS: `npm run css`.
- Both parts ship together in one deployment.

## Testing

- Unit (Vitest): `getMonthFreeDays` — past month → empty; month with rules →
  correct free days; days partially booked → excluded; month boundaries
  (28/30/31 days, leap February).
- Manual: booking page on desktop + mobile widths, prev/next clamp, timezone
  change relabels times, 12h/24h toggle, full booking E2E still works.
- Manual: dashboard sidebar on desktop, drawer on mobile, theme toggle in both.