import { escapeHtml, layout } from "./layout";
import { utcToZonedParts } from "../lib/timezone";
import { zoneDisplay } from "../lib/timezoneList";
import { avatar, badge, button, emptyState, icon } from "./ui";
import type { BookingRow, EventTypeRow, PublicUser } from "../types";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function profilePage(host: PublicUser, eventTypes: EventTypeRow[]): string {
  const cards = eventTypes
    .map(
      (e, i) => `<a class="ui-card ui-rise group block p-5 transition-all duration-200
                     hover:-translate-y-px hover:border-line-strong hover:shadow-md"
             style="animation-delay:${Math.min(i, 8) * 40}ms"
             href="/${escapeHtml(host.slug)}/${escapeHtml(e.slug)}">
        <div class="flex items-start justify-between gap-4">
          <div class="min-w-0">
            <h2 class="text-sm font-semibold text-ink">${escapeHtml(e.name)}</h2>
            <p class="mt-1 flex items-center gap-1.5 text-[0.8125rem] text-muted">
              ${icon("clock", "size-3.5")}<span class="ui-time">${e.duration_minutes} min</span>
            </p>
            ${
              e.description
                ? `<p class="mt-2.5 text-[0.8125rem] leading-relaxed text-muted">${escapeHtml(
                    e.description,
                  )}</p>`
                : ""
            }
          </div>
          <span class="mt-0.5 shrink-0 text-muted transition-transform duration-200 group-hover:translate-x-0.5 group-hover:text-ink">
            ${icon("chevronRight", "size-4")}
          </span>
        </div>
      </a>`,
    )
    .join("");

  return layout({
    title: host.name,
    nav: "public",
    width: "md",
    body: `
      <div class="mx-auto max-w-lg">
        <div class="mb-8 flex flex-col items-center text-center">
          ${avatar(host.name, host.avatar_key, "size-14", "text-lg")}
          <h1 class="mt-3.5 text-xl font-semibold tracking-[-0.02em] text-ink">${escapeHtml(
            host.name,
          )}</h1>
          <p class="mt-1 flex items-center gap-1.5 text-[0.8125rem] text-muted">
            ${icon("globe", "size-3.5")}<span>${escapeHtml(zoneDisplay(host.timezone))}</span>
          </p>
        </div>

        ${
          eventTypes.length
            ? `<div class="grid gap-3">${cards}</div>`
            : `<div class="ui-card">${emptyState({
                icon: "calendar",
                title: "Nothing bookable right now",
                body: `${host.name} has not published any event types yet.`,
              })}</div>`
        }
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
    width: "md",
    data,
    body: `
      <div class="mx-auto max-w-3xl ui-rise" x-data="bookingWidget()" x-init="init()">
        <div class="ui-card overflow-hidden shadow-sm">
          <div class="grid md:grid-cols-[17rem_1fr]">

            <!-- Event summary -->
            <aside class="border-b border-line p-5 sm:p-6 md:border-r md:border-b-0">
              <div class="flex items-center gap-2.5">
                ${avatar(host.name, host.avatar_key, "size-10", "text-sm")}
                <div class="min-w-0">
                  <p class="truncate text-[0.8125rem] text-muted">${escapeHtml(host.name)}</p>
                </div>
              </div>

              <h1 class="mt-4 text-lg font-semibold tracking-[-0.02em] text-ink">${escapeHtml(
                eventType.name,
              )}</h1>

              <dl class="mt-3.5 space-y-2 text-[0.8125rem] text-muted">
                <div class="flex items-center gap-2">
                  ${icon("clock", "size-4 shrink-0")}
                  <dd class="ui-time">${eventType.duration_minutes} minutes</dd>
                </div>
                <div class="flex items-center gap-2">
                  ${icon("globe", "size-4 shrink-0")}
                  <dd class="truncate" x-text="timezoneLabel"></dd>
                </div>
                <template x-if="selected">
                  <div class="flex items-start gap-2 text-ink">
                    ${icon("calendar", "size-4 shrink-0 mt-0.5")}
                    <dd class="ui-time font-medium" x-text="summary()"></dd>
                  </div>
                </template>
              </dl>

              ${
                eventType.description
                  ? `<p class="mt-4 border-t border-line pt-4 text-[0.8125rem] leading-relaxed text-muted">${escapeHtml(
                      eventType.description,
                    )}</p>`
                  : ""
              }
            </aside>

            <!-- Step 1: pick a slot -->
            <section class="p-5 sm:p-6" x-show="step === 'slot'">
              <div class="mb-4 flex items-end justify-between gap-3">
                <div class="w-full max-w-[13rem]">
                  <label class="ui-label" for="date">Select a date</label>
                  <input class="ui-input font-mono" id="date" type="date"
                         x-model="date" :min="today" @change="loadSlots()">
                </div>
                <p class="pb-2 text-[0.8125rem] text-muted" x-show="!loading && slots.length">
                  <span class="ui-time" x-text="slots.length"></span> open
                </p>
              </div>

              <!-- Loading skeleton: keeps layout stable instead of flashing empty -->
              <div class="grid grid-cols-2 gap-2 sm:grid-cols-3" x-show="loading" x-cloak>
                <template x-for="n in 6" :key="n">
                  <div class="h-[42px] animate-pulse rounded-md border border-line bg-subtle"></div>
                </template>
              </div>

              <div class="grid grid-cols-2 gap-2 sm:grid-cols-3" x-show="!loading">
                <template x-for="slot in slots" :key="slot.startAt">
                  <button type="button" class="ui-slot" @click="choose(slot)"
                          x-text="label(slot.startAt)"></button>
                </template>
              </div>

              <div x-show="!loading && slots.length === 0" x-cloak
                   class="rounded-lg border border-dashed border-line-strong px-6 py-10 text-center">
                <p class="text-sm font-medium text-ink">No times on this date</p>
                <p class="mt-1 text-[0.8125rem] text-muted">Try another day.</p>
              </div>
            </section>

            <!-- Step 2: details -->
            <section class="p-5 sm:p-6" x-show="step === 'form'" x-cloak>
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

          </div>
        </div>

        <p class="mt-4 text-center text-[0.75rem] text-muted">
          Powered by <span class="font-medium text-body">MeetFlow</span>
        </p>
      </div>

      <style>[x-cloak]{display:none!important}</style>
      <script>
        function bookingWidget() {
          const cfg = JSON.parse(document.getElementById('page-data').textContent);
          return {
            ...cfg,
            guestTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            // Mirrors zoneDisplay() on the server: people read "Kuala Lumpur
            // (GMT+8)", never "Asia/Kuala_Lumpur".
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
            today: new Date().toISOString().slice(0, 10),
            date: new Date().toISOString().slice(0, 10),
            slots: [], loading: true, step: 'slot', selected: null,
            guestName: '', guestEmail: '', notes: '', error: '', submitting: false,

            init() { this.loadSlots(); },

            async loadSlots() {
              this.loading = true; this.slots = [];
              const url = '/api/public/' + this.hostSlug + '/' + this.eventSlug + '/slots?date=' + this.date;
              try {
                const res = await fetch(url);
                if (res.ok) this.slots = (await res.json()).slots;
              } finally {
                this.loading = false;
              }
            },

            label(startAt) {
              return new Date(startAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
            },

            summary() {
              if (!this.selected) return '';
              return new Date(this.selected.startAt).toLocaleString([], {
                weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
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
              if (res.status === 409 || res.status === 422) { this.step = 'slot'; this.loadSlots(); }
            },
          };
        }
      </script>`,
  });
}

/** Shown when a guest follows their signed link. Cancelling is a POST from here. */
export function cancelConfirmPage(
  host: PublicUser,
  eventType: EventTypeRow,
  booking: BookingRow,
  token: string,
): string {
  const when = formatBookingWhen(booking);

  return layout({
    title: "Cancel booking",
    nav: "public",
    width: "md",
    body: `
      <div class="mx-auto max-w-md ui-rise">
        <div class="ui-card ui-card-pad">
          <h1 class="text-lg font-semibold tracking-[-0.02em] text-ink">Cancel this booking?</h1>
          <p class="mt-1.5 text-[0.8125rem] text-muted">
            This frees the slot for someone else. It cannot be undone — you would need to book again.
          </p>

          <dl class="ui-divide mt-5 border-t border-line">
            ${detailRow("Event", escapeHtml(eventType.name))}
            ${detailRow("Host", escapeHtml(host.name))}
            ${detailRow("When", `<span class="ui-time">${escapeHtml(when.date)}</span>`)}
            ${detailRow("Time", `<span class="ui-time font-medium">${escapeHtml(when.time)}</span>`)}
            ${detailRow("Timezone", escapeHtml(when.zone))}
          </dl>

          <div class="mt-6 flex flex-wrap items-center gap-2">
            <form method="post" action="/booking/${booking.id}/cancel">
              <input type="hidden" name="token" value="${escapeHtml(token)}">
              ${button({ label: "Cancel booking", variant: "danger" })}
            </form>
            ${button({
              label: "Keep it",
              href: `/${escapeHtml(host.slug)}`,
              variant: "ghost",
            })}
          </div>
        </div>
      </div>`,
  });
}

/** Terminal page after a guest cancels, and for an already-cancelled booking. */
export function cancelledPage(host: PublicUser, eventType: EventTypeRow): string {
  return layout({
    title: "Booking cancelled",
    nav: "public",
    width: "md",
    body: `
      <div class="mx-auto max-w-md ui-rise text-center">
        <div class="ui-card ui-card-pad">
          <span class="mx-auto flex size-11 items-center justify-center rounded-full bg-subtle text-muted">
            ${icon("x", "size-5")}
          </span>
          <h1 class="mt-4 text-lg font-semibold tracking-[-0.02em] text-ink">Booking cancelled</h1>
          <p class="mt-1.5 text-[0.8125rem] text-muted">
            ${escapeHtml(eventType.name)} with ${escapeHtml(host.name)} has been cancelled.
            ${escapeHtml(host.name)} has been notified.
          </p>
          <div class="mt-6">
            ${button({
              label: `Book another time with ${host.name}`,
              href: `/${escapeHtml(host.slug)}`,
              variant: "secondary",
              size: "sm",
            })}
          </div>
        </div>
      </div>`,
  });
}

/** Shown when a cancellation link is invalid, or the meeting already happened. */
export function cancelUnavailablePage(message: string): string {
  return layout({
    title: "Cannot cancel",
    nav: "public",
    width: "md",
    body: `
      <div class="mx-auto max-w-md ui-rise text-center">
        <div class="ui-card ui-card-pad">
          <span class="mx-auto flex size-11 items-center justify-center rounded-full bg-warning-soft text-warning">
            ${icon("alert", "size-5")}
          </span>
          <h1 class="mt-4 text-lg font-semibold tracking-[-0.02em] text-ink">Cannot cancel</h1>
          <p class="mt-1.5 text-[0.8125rem] text-muted">${escapeHtml(message)}</p>
        </div>
      </div>`,
  });
}

function detailRow(label: string, valueHtml: string): string {
  return `<div class="flex items-baseline justify-between gap-4 py-2.5">
      <dt class="text-[0.8125rem] text-muted">${escapeHtml(label)}</dt>
      <dd class="text-right text-sm text-ink">${valueHtml}</dd>
    </div>`;
}

function formatBookingWhen(booking: BookingRow): { date: string; time: string; zone: string } {
  const p = utcToZonedParts(new Date(booking.start_at), booking.timezone);
  const e = utcToZonedParts(new Date(booking.end_at), booking.timezone);
  const pad2 = (n: number) => String(n).padStart(2, "0");
  const weekday = DAY_NAMES[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()]!;
  return {
    date: `${weekday}, ${p.day} ${MONTHS[p.month - 1]} ${p.year}`,
    time: `${pad2(p.hour)}:${pad2(p.minute)} – ${pad2(e.hour)}:${pad2(e.minute)}`,
    zone: zoneDisplay(booking.timezone),
  };
}

export function confirmationPage(
  host: PublicUser,
  eventType: EventTypeRow,
  booking: BookingRow,
  cancelHref?: string,
): string {
  const p = utcToZonedParts(new Date(booking.start_at), booking.timezone);
  const end = utcToZonedParts(new Date(booking.end_at), booking.timezone);
  const pad = (n: number) => String(n).padStart(2, "0");
  const weekday = DAY_NAMES[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()]!;
  const dateLine = `${weekday}, ${p.day} ${MONTHS[p.month - 1]} ${p.year}`;
  const timeLine = `${pad(p.hour)}:${pad(p.minute)} – ${pad(end.hour)}:${pad(end.minute)}`;

  const row = (label: string, valueHtml: string) =>
    `<div class="flex items-baseline justify-between gap-4 py-2.5">
       <dt class="text-[0.8125rem] text-muted">${escapeHtml(label)}</dt>
       <dd class="text-right text-sm text-ink">${valueHtml}</dd>
     </div>`;

  return layout({
    title: "Booking confirmed",
    nav: "public",
    width: "md",
    body: `
      <div class="mx-auto max-w-md ui-rise">
        <div class="ui-card overflow-hidden">
          <div class="flex flex-col items-center border-b border-line px-6 py-8 text-center">
            <span class="flex size-11 items-center justify-center rounded-full bg-success-soft text-success">
              ${icon("check", "size-5")}
            </span>
            <h1 class="mt-4 text-lg font-semibold tracking-[-0.02em] text-ink">Booking confirmed</h1>
            <p class="mt-1 text-[0.8125rem] text-muted">
              ${escapeHtml(eventType.name)} with ${escapeHtml(host.name)}
            </p>
          </div>

          <dl class="ui-divide px-5 py-1 sm:px-6">
            ${row("Date", `<span class="ui-time">${escapeHtml(dateLine)}</span>`)}
            ${row("Time", `<span class="ui-time font-medium">${escapeHtml(timeLine)}</span>`)}
            ${row("Timezone", escapeHtml(zoneDisplay(booking.timezone)))}
            ${row("Duration", `<span class="ui-time">${eventType.duration_minutes} min</span>`)}
            ${row("Status", badge("success", "Confirmed"))}
          </dl>

          <div class="border-t border-line bg-subtle/60 px-5 py-4 sm:px-6">
            <p class="text-[0.8125rem] text-muted">
              A confirmation has been sent to ${escapeHtml(booking.guest_email)}.
            </p>
          </div>
        </div>

        <div class="mt-4 flex flex-wrap justify-center gap-2">
          ${button({
            label: `Book another with ${host.name}`,
            href: `/${host.slug}`,
            variant: "secondary",
            size: "sm",
          })}
          ${
            cancelHref
              ? button({ label: "Cancel booking", href: cancelHref, variant: "ghost", size: "sm" })
              : ""
          }
        </div>
      </div>`,
  });
}
