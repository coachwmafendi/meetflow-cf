import { escapeHtml, layout } from "./layout";
import { utcToZonedParts } from "../lib/timezone";
import { badge, button, emptyState, icon } from "./ui";
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

/** Circular monogram — a host page needs a face, and we have no avatars yet. */
function monogram(name: string): string {
  const initials = name
    .trim()
    .split(/\s+/)
    .slice(0, 2)
    .map((part) => part[0] ?? "")
    .join("")
    .toUpperCase();
  return `<span class="flex size-12 items-center justify-center rounded-full border border-line
                bg-subtle text-base font-semibold tracking-tight text-ink">${escapeHtml(
                  initials || "?",
                )}</span>`;
}

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
          ${monogram(host.name)}
          <h1 class="mt-3.5 text-xl font-semibold tracking-[-0.02em] text-ink">${escapeHtml(
            host.name,
          )}</h1>
          <p class="mt-1 flex items-center gap-1.5 text-[0.8125rem] text-muted">
            ${icon("globe", "size-3.5")}<span class="ui-time">${escapeHtml(host.timezone)}</span>
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
                ${monogram(host.name)}
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
                  <dd class="ui-time truncate" x-text="guestTimezone"></dd>
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

export function confirmationPage(
  host: PublicUser,
  eventType: EventTypeRow,
  booking: BookingRow,
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
            ${row("Timezone", `<span class="ui-time">${escapeHtml(booking.timezone)}</span>`)}
            ${row("Duration", `<span class="ui-time">${eventType.duration_minutes} min</span>`)}
            ${row("Status", badge("success", "Confirmed"))}
          </dl>

          <div class="border-t border-line bg-subtle/60 px-5 py-4 sm:px-6">
            <p class="text-[0.8125rem] text-muted">
              Email confirmations are not sent yet — please note the time down.
            </p>
          </div>
        </div>

        <div class="mt-4 flex justify-center">
          ${button({
            label: `Book another with ${host.name}`,
            href: `/${host.slug}`,
            variant: "secondary",
            size: "sm",
          })}
        </div>
      </div>`,
  });
}
