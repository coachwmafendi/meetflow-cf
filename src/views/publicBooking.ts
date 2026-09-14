import { escapeHtml, layout } from "./layout";
import { utcToZonedParts } from "../lib/timezone";
import { zoneDisplay } from "../lib/timezoneList";
import { avatar, badge, button, emptyState, icon } from "./ui";
import { TIMEZONE_SCRIPT } from "./timezoneSelect";
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

  const WEEKDAY_HEAD = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"]
    .map((d) => `<span class="py-1 text-center text-[0.75rem] font-medium text-muted">${d}</span>`)
    .join("");

  return layout({
    title: eventType.name,
    nav: "none",
    width: "lg",
    data,
    body: `
      <div class="mx-auto max-w-5xl ui-rise" x-data="bookingWidget()" x-init="init()">
        <div class="ui-card overflow-hidden shadow-sm">
          <div class="grid lg:grid-cols-[17rem_minmax(0,1fr)_15rem]">

            <!-- Host + event summary -->
            <aside class="border-b border-line p-5 sm:p-6 lg:border-b-0 lg:border-r">
              <a href="/${escapeHtml(host.slug)}" class="group flex items-center gap-2.5">
                ${avatar(host.name, host.avatar_key, "size-10", "text-sm")}
                <span class="min-w-0">
                  <span class="block truncate text-sm font-medium text-ink group-hover:underline">
                    ${escapeHtml(host.name)}
                  </span>
                  <span class="block text-[0.75rem] text-muted">View public page</span>
                </span>
              </a>

              <h1 class="mt-4 text-lg font-semibold tracking-[-0.02em] text-ink">${escapeHtml(
                eventType.name,
              )}</h1>

              <div class="mt-3">
                <span class="ui-badge ui-badge-neutral">
                  <span class="ui-time">${eventType.duration_minutes}m</span>
                </span>
              </div>

              <div class="mt-3.5">
                <label class="ui-label" for="guest-timezone">Timezone</label>
                <select class="ui-select" id="guest-timezone" x-model="guestTimezone"
                        data-timezone data-timezone-autodetect></select>
              </div>

              <template x-if="selected">
                <div class="mt-4 border-t border-line pt-4">
                  <p class="flex items-center gap-2 text-[0.8125rem] text-ink">
                    ${icon("calendar", "size-4 shrink-0")}
                    <span class="ui-time font-medium" x-text="summary()"></span>
                  </p>
                </div>
              </template>

              ${
                eventType.description
                  ? `<p class="mt-4 border-t border-line pt-4 text-[0.8125rem] leading-relaxed text-muted">${escapeHtml(
                      eventType.description,
                    )}</p>`
                  : ""
              }
            </aside>

            <!-- Step 1a: month calendar -->
            <section class="border-b border-line p-5 sm:p-6 lg:border-b-0" x-show="step === 'slot'">
              <div class="mb-3 flex items-center justify-between">
                <p class="text-sm font-semibold text-ink">
                  <span x-text="monthName()"></span>&nbsp;<span x-text="viewYear"></span>
                </p>
                <div class="flex items-center gap-1">
                  <button type="button" class="ui-btn ui-btn-ghost ui-btn-sm px-2"
                          :disabled="atEarliestMonth()" @click="prevMonth()"
                          aria-label="Previous month">
                    ${icon("chevronLeft", "size-4")}
                  </button>
                  <button type="button" class="ui-btn ui-btn-ghost ui-btn-sm px-2"
                          @click="nextMonth()" aria-label="Next month">
                    ${icon("chevronRight", "size-4")}
                  </button>
                </div>
              </div>

              <div class="mb-1 grid grid-cols-7">${WEEKDAY_HEAD}</div>

              <div class="grid grid-cols-7 gap-1">
                <template x-for="cell in cells()" :key="cell.key">
                  <div class="aspect-square">
                    <button type="button" class="ui-day"
                            x-show="!cell.blank"
                            :class="{
                              'ui-day-selected': cell.selected,
                              'ui-day-today': cell.today,
                            }"
                            :disabled="!cell.enabled"
                            @click="pickDay(cell.date)">
                      <span x-text="cell.label"></span>
                    </button>
                    <div x-show="cell.blank" x-cloak></div>
                  </div>
                </template>
              </div>
            </section>

            <!-- Step 1b: guest details -->
            <section class="border-b border-line p-5 sm:p-6 lg:border-b-0" x-show="step === 'form'" x-cloak>
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

            <!-- Step 2a: time list -->
            <section class="p-5 sm:p-6" x-show="step === 'slot'" x-ref="times">
              <div x-show="!selectedDate">
                <p class="text-sm font-semibold text-ink">Select a date</p>
                <p class="mt-1 text-[0.8125rem] text-muted">
                  Pick a day on the calendar to see available times.
                </p>
              </div>

              <div x-show="selectedDate">
                <div class="mb-3 flex items-center justify-between gap-2">
                  <p class="text-sm font-semibold text-ink" x-text="selectedDayLabel()"></p>
                  <div class="ui-seg" role="group" aria-label="Time format">
                    <button type="button" :class="hour12 ? 'ui-seg-active' : ''"
                            :aria-pressed="hour12 ? 'true' : 'false'"
                            @click="hour12 = true">12h</button>
                    <button type="button" :class="!hour12 ? 'ui-seg-active' : ''"
                            :aria-pressed="!hour12 ? 'true' : 'false'"
                            @click="hour12 = false">24h</button>
                  </div>
                </div>

                <div class="space-y-2" x-show="loading" x-cloak>
                  <template x-for="n in 5" :key="n">
                    <div class="h-[42px] animate-pulse rounded-md border border-line bg-subtle"></div>
                  </template>
                </div>

                <div class="max-h-[19rem] space-y-2 overflow-y-auto pr-1"
                     x-show="!loading && slots.length">
                  <template x-for="slot in slots" :key="slot.startAt">
                    <button type="button" class="ui-slot w-full" @click="choose(slot)"
                            x-text="label(slot.startAt)"></button>
                  </template>
                </div>

                <div x-show="!loading && slots.length === 0" x-cloak
                     class="rounded-lg border border-dashed border-line-strong px-4 py-8 text-center">
                  <p class="text-sm font-medium text-ink">No times on this date</p>
                  <p class="mt-1 text-[0.8125rem] text-muted">Try another day.</p>
                </div>
              </div>
            </section>

            <!-- Step 2b: chosen time summary -->
            <section class="p-5 sm:p-6" x-show="step === 'form'" x-cloak>
              <template x-if="selected">
                <div>
                  <p class="ui-eyebrow">Your booking</p>
                  <p class="ui-time mt-2 text-base font-semibold text-ink" x-text="summary()"></p>
                  <p class="mt-1 text-[0.8125rem] text-muted" x-text="timezoneLabel"></p>
                </div>
              </template>
            </section>

          </div>
        </div>

        <p class="mt-4 text-center text-[0.75rem] text-muted">
          Powered by <span class="font-medium text-body">MeetFlow</span>
        </p>
      </div>

      <script>
        function bookingWidget() {
          function offsetMinutes(zone, now) {
            var parts = new Intl.DateTimeFormat('en-US', {
              timeZone: zone, hour12: false,
              year: 'numeric', month: '2-digit', day: '2-digit',
              hour: '2-digit', minute: '2-digit', second: '2-digit'
            }).formatToParts(now);
            var get = function (t) {
              for (var i = 0; i < parts.length; i++) if (parts[i].type === t) return Number(parts[i].value);
              return 0;
            };
            var asUtc = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour') % 24, get('minute'), get('second'));
            return (asUtc - Math.floor(now.getTime() / 1000) * 1000) / 60000;
          }
          var cfg = JSON.parse(document.getElementById('page-data').textContent);
          var now = new Date();
          var pad2 = function (n) { return String(n).padStart(2, '0'); };
          var todayYmd = now.getFullYear() + '-' + pad2(now.getMonth() + 1) + '-' + pad2(now.getDate());
          var hour12Default = (function () {
            var opt = Intl.DateTimeFormat().resolvedOptions().hour12;
            return opt === undefined ? true : opt;
          })();

          return {
            ...cfg,
            guestTimezone: Intl.DateTimeFormat().resolvedOptions().timeZone,
            hour12: hour12Default,
            today: todayYmd,
            todayYear: now.getFullYear(),
            todayMonth: now.getMonth(),
            viewYear: now.getFullYear(),
            viewMonth: now.getMonth(),
            days: [],
            selectedDate: null,
            slots: [],
            loading: false,
            step: 'slot',
            selected: null,
            guestName: '',
            guestEmail: '',
            notes: '',
            error: '',
            submitting: false,
            monthReq: 0,
            slotReq: 0,

            get timezoneLabel() {
              var zone = this.guestTimezone;
              var city = zone.split('/').pop().replace(/_/g, ' ');
              var mins = offsetMinutes(zone, new Date());
              if (mins === 0) return city + ' (GMT)';
              var sign = mins < 0 ? '-' : '+';
              var abs = Math.abs(mins);
              var rest = abs % 60;
              return city + ' (GMT' + sign + Math.floor(abs / 60) +
                (rest ? ':' + String(rest).padStart(2, '0') : '') + ')';
            },

            init() { this.loadMonth(); },

            monthName() {
              var names = ['January', 'February', 'March', 'April', 'May', 'June',
                           'July', 'August', 'September', 'October', 'November', 'December'];
              return names[this.viewMonth];
            },

            atEarliestMonth() {
              return this.viewYear === this.todayYear && this.viewMonth === this.todayMonth;
            },

            async loadMonth() {
              this.days = [];
              var req = ++this.monthReq;
              var url = '/api/public/' + this.hostSlug + '/' + this.eventSlug +
                '/month?year=' + this.viewYear + '&month=' + (this.viewMonth + 1);
              try {
                var res = await fetch(url);
                if (req !== this.monthReq) return;
                if (res.ok) this.days = (await res.json()).days;
              } catch (e) {}
            },

            prevMonth() {
              if (this.atEarliestMonth()) return;
              this.selectedDate = null;
              this.slots = [];
              if (this.viewMonth === 0) { this.viewMonth = 11; this.viewYear -= 1; }
              else this.viewMonth -= 1;
              this.loadMonth();
            },

            nextMonth() {
              this.selectedDate = null;
              this.slots = [];
              if (this.viewMonth === 11) { this.viewMonth = 0; this.viewYear += 1; }
              else this.viewMonth += 1;
              this.loadMonth();
            },

            cells() {
              var firstDow = new Date(Date.UTC(this.viewYear, this.viewMonth, 1)).getUTCDay();
              var count = new Date(Date.UTC(this.viewYear, this.viewMonth + 1, 0)).getUTCDate();
              var out = [];
              for (var i = 0; i < 42; i++) {
                var d = i - firstDow + 1;
                if (d < 1 || d > count) { out.push({ blank: true, key: 'b' + i }); continue; }
                var date = this.viewYear + '-' + pad2(this.viewMonth + 1) + '-' + pad2(d);
                out.push({
                  blank: false,
                  key: date,
                  date: date,
                  label: d,
                  enabled: date >= this.today && this.days.indexOf(date) !== -1,
                  selected: date === this.selectedDate,
                  today: date === this.today,
                });
              }
              return out;
            },

            async pickDay(date) {
              this.selectedDate = date;
              this.error = '';
              this.loading = true;
              this.slots = [];
              var req = ++this.slotReq;
              var url = '/api/public/' + this.hostSlug + '/' + this.eventSlug + '/slots?date=' + date;
              try {
                var res = await fetch(url);
                if (req !== this.slotReq) return;
                if (res.ok) this.slots = (await res.json()).slots;
              } catch (e) {
              } finally {
                if (req !== this.slotReq) return;
                this.loading = false;
                var self = this;
                this.$nextTick(function () {
                  if (window.matchMedia('(max-width: 63.9rem)').matches) {
                    var el = self.$refs.times;
                    if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
                  }
                });
              }
            },

            label(startAt) {
              // 'en-US' keeps the suffix deterministic ("10:00 AM"), which the
              // replace below turns into cal.com's compact "10:00am".
              return new Date(startAt).toLocaleTimeString('en-US', {
                hour: '2-digit',
                minute: '2-digit',
                hour12: this.hour12,
                timeZone: this.guestTimezone,
              }).replace(/\\s?[AP]M/, function (m) { return m.trim().toLowerCase(); });
            },

            selectedDayLabel() {
              if (!this.selectedDate) return '';
              var d = new Date(this.selectedDate + 'T12:00:00Z');
              var weekday = d.toLocaleDateString('en-US', { weekday: 'short', timeZone: this.guestTimezone });
              var dayNum = Number(this.selectedDate.slice(8, 10));
              var s = ['th', 'st', 'nd', 'rd'];
              var v = dayNum % 100;
              var suffix = s[(v - 20) % 10] || s[v] || s[0];
              return weekday + ' ' + dayNum + suffix;
            },

            summary() {
              if (!this.selected) return '';
              return new Date(this.selected.startAt).toLocaleString('en-US', {
                weekday: 'short',
                day: 'numeric',
                month: 'short',
                hour: '2-digit',
                minute: '2-digit',
                hour12: this.hour12,
                timeZone: this.guestTimezone,
              });
            },

            choose(slot) {
              this.selected = slot;
              this.error = '';
              this.step = 'form';
            },

            async submit() {
              this.submitting = true;
              this.error = '';
              var res = await fetch('/api/public/' + this.hostSlug + '/' + this.eventSlug + '/book', {
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
                var created = await res.json();
                window.location.href = '/booking/' + created.booking.id + '/confirmed';
                return;
              }
              var body = await res.json().catch(function () { return {}; });
              this.error = body.error || 'Something went wrong. Please try again.';
              if (res.status === 409 || res.status === 422) {
                this.step = 'slot';
                if (this.selectedDate) this.pickDay(this.selectedDate);
              }
            },
          };
        }
      </script>
      ${TIMEZONE_SCRIPT}`,
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
