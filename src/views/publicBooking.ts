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
            <p class="text-sm text-muted">${e.duration_minutes} min</p>
            ${e.description ? `<p class="mt-2 text-sm text-muted">${escapeHtml(e.description)}</p>` : ""}
          </a>`,
        )
        .join("")
    : `<div class="mf-card text-sm text-muted">No bookable events right now.</div>`;

  return layout({
    title: host.name,
    nav: "public",
    body: `
      <div class="mx-auto max-w-lg">
        <h1 class="mb-1 text-2xl font-semibold tracking-tight">${escapeHtml(host.name)}</h1>
        <p class="mb-8 text-sm text-muted">${escapeHtml(host.timezone)}</p>
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
          <div class="md:border-r md:border-line md:pr-8">
            <p class="text-sm text-muted">${escapeHtml(host.name)}</p>
            <h1 class="mt-1 text-xl font-semibold tracking-tight">${escapeHtml(eventType.name)}</h1>
            <p class="mt-2 text-sm text-muted">${eventType.duration_minutes} minutes</p>
            ${
              eventType.description
                ? `<p class="mt-4 text-sm text-muted">${escapeHtml(eventType.description)}</p>`
                : ""
            }
            <p class="mt-4 text-xs text-muted">Times shown in <span x-text="guestTimezone"></span></p>
          </div>

          <div x-show="step === 'slot'">
            <label class="mf-label" for="date">Pick a date</label>
            <input class="mf-input mb-4 max-w-xs" id="date" type="date" x-model="date"
                   :min="today" @change="loadSlots()">

            <p x-show="loading" class="text-sm text-muted">Loading times…</p>
            <p x-show="!loading && slots.length === 0" class="text-sm text-muted">
              No times available on this date.
            </p>

            <div class="grid grid-cols-2 gap-2 sm:grid-cols-3" x-show="!loading">
              <template x-for="slot in slots" :key="slot.startAt">
                <button type="button" class="mf-btn-ghost" @click="choose(slot)"
                        x-text="label(slot.startAt)"></button>
              </template>
            </div>
          </div>

          <div x-show="step === 'form'">
            <button type="button" class="mb-4 text-sm text-muted underline" @click="step='slot'">
              ← Change time
            </button>
            <p class="mb-4 font-medium" x-text="summary()"></p>
            <p x-show="error" class="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700"
               x-text="error"></p>
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
          <p class="mt-4 text-sm text-muted">
            ${escapeHtml(eventType.name)} with ${escapeHtml(host.name)}
          </p>
          <p class="mt-1 font-medium tabular-nums">${when}</p>
          <p class="mt-1 text-sm text-muted">${escapeHtml(booking.timezone)}</p>
          <p class="mt-6 text-sm text-muted">
            A copy is not emailed yet — please note the time down.
          </p>
        </div>
      </div>`,
  });
}
