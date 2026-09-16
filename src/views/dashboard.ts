import { escapeHtml, layout } from "./layout";
import { TIMEZONE_SCRIPT, timezoneSelect } from "./timezoneSelect";
import {
  alert,
  avatar,
  badge,
  button,
  emptyState,
  field,
  icon,
  pageHeader,
  statTile,
  table,
  time,
} from "./ui";
import type { BookingWithEvent, DashboardStats } from "../db/bookings";
import type { AvailabilityRuleRow, BookingAttendeeRow, EventTypeRow, PublicUser } from "../types";
import { utcToZonedParts } from "../lib/timezone";
import { zoneDisplay } from "../lib/timezoneList";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const pad = (n: number) => String(n).padStart(2, "0");

/**
 * Opens the per-card embed dialog, fills it with an iframe snippet for the
 * booking page (absolute URL from the current origin), and handles copying
 * the snippet. Backdrop clicks close the dialog.
 */
const EMBED_SCRIPT = `
  <script>
    (function () {
      function snippet(url) {
        return '<iframe src="' + url + '" width="100%" height="600" style="border:0" loading="lazy" title="Booking page"></iframe>';
      }

      function popupSnippet(url, link) {
        var scriptUrl = new URL("/embed.js", url).href;
        return [
          "<!-- MeetFlow element-click embed code begins -->",
          "<script>",
          "(function (d, s, u) {",
          "  var js = d.createElement(s);",
          "  js.src = u; js.async = true;",
          "  d.getElementsByTagName(s)[0].parentNode.insertBefore(js, d.getElementsByTagName(s)[0]);",
          '})(document, "script", "' + scriptUrl + '");',
          "<\\/script>",
          "<!-- MeetFlow element-click embed code ends -->",
          "",
          "<!-- Add data-meetflow-link to any element; clicking it opens the popup. -->",
          '<button data-meetflow-link="' + link + '">Book now</button>',
        ].join("\\n");
      }

      function activateTab(dialog, name) {
        var tabs = dialog.querySelectorAll("[data-embed-tab]");
        Array.prototype.forEach.call(tabs, function (btn) {
          var active = btn.getAttribute("data-embed-tab") === name;
          btn.classList.toggle("ui-embed-tab-active", active);
          btn.setAttribute("aria-selected", active ? "true" : "false");
        });
        var codes = dialog.querySelectorAll("[data-embed-code]");
        Array.prototype.forEach.call(codes, function (code) {
          code.hidden = code.getAttribute("data-embed-code-tab") !== name;
        });
      }

      document.addEventListener("click", function (event) {
        var dialogBtn = event.target.closest("[data-dialog-open]");
        if (dialogBtn) {
          var target = document.getElementById(dialogBtn.getAttribute("data-dialog-open"));
          if (target) target.showModal();
          return;
        }

        var openBtn = event.target.closest("[data-embed-open]");
        if (openBtn) {
          var dialog = document.getElementById(openBtn.getAttribute("data-embed-open"));
          if (!dialog) return;
          var path = openBtn.getAttribute("data-path");
          var url = new URL(path, window.location.origin).href;
          var inlineCode = dialog.querySelector('[data-embed-code-tab="inline"]');
          var popupCode = dialog.querySelector('[data-embed-code-tab="popup"]');
          if (inlineCode) inlineCode.value = snippet(url);
          if (popupCode) popupCode.value = popupSnippet(url, path.replace(/^\\//, ""));
          activateTab(dialog, "inline");
          dialog.showModal();
          return;
        }

        var tabBtn = event.target.closest("[data-embed-tab]");
        if (tabBtn) {
          activateTab(tabBtn.closest("dialog"), tabBtn.getAttribute("data-embed-tab"));
          return;
        }

        var closeBtn = event.target.closest("[data-dialog-close]");
        if (closeBtn) {
          closeBtn.closest("dialog").close();
          return;
        }

        var copyBtn = event.target.closest("[data-embed-copy]");
        if (copyBtn) {
          var dialog = copyBtn.closest("dialog");
          var code = dialog.querySelector("[data-embed-code]:not([hidden])");
          var url = code ? code.value : "";
          if (!url) return;

          function done() {
            var original = copyBtn.innerHTML;
            copyBtn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="size-4"><path d="m4.5 12.5 5 5 10-11"/></svg><span>Copied</span>';
            window.setTimeout(function () { copyBtn.innerHTML = original; }, 1600);
          }

          function fallback() {
            var ta = document.createElement("textarea");
            ta.value = url;
            ta.style.position = "fixed";
            ta.style.opacity = "0";
            document.body.appendChild(ta);
            ta.select();
            try { document.execCommand("copy"); } catch (e) {}
            document.body.removeChild(ta);
            done();
          }

          if (navigator.clipboard && navigator.clipboard.writeText) {
            navigator.clipboard.writeText(url).then(done, fallback);
          } else {
            fallback();
          }
        }
      });

      Array.prototype.forEach.call(document.querySelectorAll("dialog.ui-dialog"), function (dialog) {
        dialog.addEventListener("click", function (event) {
          if (event.target === dialog) dialog.close();
        });
      });
    })();
  </script>`;

/** "Mon 14 Sep · 09:00" — weekday first, because hosts scan by day. */
function whenParts(iso: string, timeZone: string): { day: string; clock: string } {
  const p = utcToZonedParts(new Date(iso), timeZone);
  const weekday = DAY_NAMES[new Date(Date.UTC(p.year, p.month - 1, p.day)).getUTCDay()]!.slice(
    0,
    3,
  );
  return {
    day: `${weekday} ${pad(p.day)} ${MONTHS[p.month - 1]}`,
    clock: `${pad(p.hour)}:${pad(p.minute)}`,
  };
}

function whenCell(iso: string, timeZone: string): string {
  const { day, clock } = whenParts(iso, timeZone);
  return `<div class="whitespace-nowrap">
      ${time(clock, "text-ink font-medium")}
      <span class="ui-time ml-2 text-[0.8125rem] text-muted">${escapeHtml(day)}</span>
    </div>`;
}

/* -------------------------------------------------------------------------- */

export function dashboardPage(
  user: PublicUser,
  stats: DashboardStats,
  recent: BookingWithEvent[],
  toast = "",
): string {
  const rows = recent.map((b) => {
    const isGroup = b.seats_total > 1;
    const manageTickets = `/dashboard/event-types/${String(b.event_type_id)}/tickets`;
    const seatsLeft = b.seats_total - b.seats_taken;

    const guestCell = isGroup
      ? `<div class="font-medium text-ink">${escapeHtml(b.event_name)}</div>
         <div class="mt-1 flex flex-wrap items-center gap-2">
           <span class="inline-flex items-center gap-1 rounded border border-line bg-subtle px-1.5 py-0.5 text-[0.75rem] font-medium text-body">
             ${b.seats_taken}/${b.seats_total} seats
           </span>
           ${
             seatsLeft === 0
               ? badge("danger", "Sold out", false)
               : seatsLeft <= 5
                 ? `<span class="rounded border border-warning/20 bg-warning-soft px-1.5 py-0.5 text-[0.75rem] font-medium text-warning">${seatsLeft} left</span>`
                 : ""
           }
         </div>
         <a href="${manageTickets}" class="mt-1 inline-flex items-center gap-1 text-[0.75rem] text-accent hover:underline">
            Manage tickets ${icon("chevronRight", "size-3.5")}
         </a>`
      : `<div class="font-medium text-ink">${escapeHtml(b.guest_name)}</div>
         <div class="text-[0.8125rem] text-muted">${escapeHtml(b.guest_email)}</div>`;

    const typeCell = isGroup
      ? badge("neutral", "Group event", true)
      : `<span class="text-body">${escapeHtml(b.event_name)}</span>`;

    return [guestCell, typeCell, whenCell(b.start_at, user.timezone)];
  });

  const firstName = user.name.split(" ")[0] ?? user.name;

  return layout({
    title: "Dashboard",
    nav: "host",
    activeNav: "/dashboard",
    hostName: user.name,
    hostAvatarKey: user.avatar_key,
    hostSlug: user.slug,
    toast,
    body: `
      ${pageHeader({
        eyebrow: "Overview",
        title: `Good day, ${firstName}`,
        subtitle: `Your booking page is live at /${user.slug}`,
        actionsHtml: `<a class="ui-btn ui-btn-secondary ui-btn-sm" href="/${escapeHtml(user.slug)}"
                     target="_blank" rel="noopener">
          ${icon("external", "size-4")}<span>View public page</span>
        </a>`,
      })}

      <div class="mb-6 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        ${statTile("Upcoming", stats.upcoming, "calendar")}
        ${statTile("Today", stats.today, "clock")}
        ${statTile("Total bookings", stats.total, "inbox")}
        ${statTile("Active event types", stats.activeEventTypes, "layers")}
      </div>

      <section class="ui-card overflow-hidden">
        <div class="flex items-center justify-between border-b border-line px-5 py-3.5">
          <h2 class="text-sm font-semibold text-ink">Upcoming bookings</h2>
          ${button({ label: "All bookings", href: "/dashboard/bookings", variant: "ghost", size: "sm", iconAfter: "chevronRight" })}
        </div>
        ${table({
          columns: [{ label: "Booking / Event" }, { label: "Type" }, { label: "When" }],
          rowsHtml: rows,
          emptyHtml: emptyState({
            icon: "calendar",
            title: "No upcoming bookings",
            body: "Once someone books a slot on your public page it will show up here.",
            actionHtml: `<a class="ui-btn ui-btn-secondary ui-btn-sm" href="/${escapeHtml(user.slug)}"
                              target="_blank" rel="noopener">
          ${icon("external", "size-4")}<span>Open public page</span>
        </a>`,
          }),
        })}
      </section>`,
  });
}

/* -------------------------------------------------------------------------- */

export function eventTypesPage(user: PublicUser, eventTypes: EventTypeRow[], toast = ""): string {
  const cards = eventTypes
    .map((e, i) => {
      const path = `/${user.slug}/${e.slug}`;
      return `<article class="ui-card ui-rise group flex items-center justify-between gap-4 p-4 sm:p-5
                     transition-shadow duration-200 hover:shadow-md"
               :class="open ? 'z-30' : ''"
               x-data="{
          open: false,
          active: ${e.is_active ? "true" : "false"},
          busy: false,
          msg: '',
          name: ${escapeHtml(JSON.stringify(e.name))},
          async toggle() {
            if (this.busy) return;
            this.busy = true;
            try {
              var res = await fetch('/dashboard/event-types/${e.id}/toggle', {
                method: 'POST',
                headers: { accept: 'application/json' },
              });
              if (res.ok) {
                var data = await res.json();
                this.active = data.is_active === 1;
                this.msg = this.active ? 'Activated' : 'Deactivated';
                var self = this;
                clearTimeout(this._t);
                this._t = setTimeout(function () { self.msg = ''; }, 2200);
              }
            } finally {
              this.busy = false;
            }
          }
        }"
               @click.outside="open = false"
               x-show="matches(items[${i}])"
               style="animation-delay:${Math.min(i, 8) * 32}ms">
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="truncate text-sm font-semibold text-ink">${escapeHtml(e.name)}</h3>
            ${
              e.seats_total > 1
                ? `<span class="ui-badge ui-badge-neutral">Group · ${e.seats_total} seats</span>`
                : ""
            }
            <span class="ui-badge" :class="active ? 'ui-badge-success' : 'ui-badge-neutral'"
                  x-text="active ? 'Active' : 'Inactive'">Active</span>
          </div>
          <p class="mt-1 flex items-center gap-1.5 text-[0.8125rem] text-muted">
            ${icon("clock", "size-3.5")}
            <span class="ui-time">${e.duration_minutes} min</span>
          </p>
          ${
            e.description
              ? `<p class="mt-2 line-clamp-2 max-w-prose text-[0.8125rem] text-muted">${escapeHtml(
                  e.description,
                )}</p>`
              : ""
          }
          <p class="mt-2.5 truncate font-mono text-[0.75rem] text-muted">${escapeHtml(path)}</p>
        </div>
        <div class="relative flex shrink-0 items-center gap-2">
          <span x-cloak x-show="msg" x-transition.opacity.duration.150ms
                class="pointer-events-none absolute -top-9 left-0 z-20 whitespace-nowrap rounded-full border px-2 py-0.5 text-[0.75rem] font-medium"
                :class="active ? 'border-success/20 bg-success-soft text-success' : 'border-line bg-subtle text-muted'"
                x-text="msg"></span>
          <form method="post" action="/dashboard/event-types/${e.id}/toggle" class="shrink-0"
                @submit.prevent="toggle()">
            <button type="submit" class="ui-switch" role="switch"
                    aria-checked="${e.is_active ? "true" : "false"}"
                    :aria-checked="active ? 'true' : 'false'"
                    :aria-label="(active ? 'Deactivate ' : 'Activate ') + name"
                    :title="active ? 'Deactivate — hide from your public page' : 'Activate — publish to your public page'"
                    :disabled="busy" :class="busy ? 'opacity-50' : ''">
              <span class="ui-switch-knob"></span>
            </button>
          </form>
          <a class="ui-btn ui-btn-ghost ui-btn-sm" href="${escapeHtml(path)}"
             target="_blank" rel="noopener">
            ${icon("external", "size-4")}<span>Open</span>
          </a>
          ${button({
            label: "Edit",
            href: `/dashboard/event-types/${e.id}`,
            variant: "secondary",
            size: "sm",
          })}
          <button type="button" class="ui-btn ui-btn-ghost ui-btn-sm px-2" aria-label="More actions"
                  title="More actions"
                  :aria-expanded="open ? 'true' : 'false'" @click="open = !open">
            ${icon("menu", "size-4")}
          </button>

          <div x-show="open" x-cloak x-transition.opacity.duration-100
               class="ui-menu absolute right-0 top-full z-20 mt-1 min-w-[11rem]">
            <button type="button" class="ui-menu-item" data-copy="${escapeHtml(path)}">
              ${icon("copy", "size-4")}<span>Copy link</span>
            </button>
            <button type="button" class="ui-menu-item" data-embed-open="embed-${e.id}"
                    data-path="${escapeHtml(path)}">
              ${icon("code", "size-4")}<span>Embed</span>
            </button>
            <form method="post" action="/dashboard/event-types/${e.id}/clone">
              <button type="submit" class="ui-menu-item">
                ${icon("plus", "size-4")}<span>Clone</span>
              </button>
            </form>
            <form method="post" action="/dashboard/event-types/${e.id}/delete"
                  onsubmit="return confirm('Delete this event type? Event types with bookings are deactivated instead.')">
              <button type="submit" class="ui-menu-item ui-menu-item-danger">
                ${icon("x", "size-4")}<span>Delete</span>
              </button>
            </form>
          </div>
        </div>

        <dialog id="embed-${e.id}" class="ui-dialog" aria-labelledby="embed-${e.id}-title">
          <div class="ui-dialog-body">
            <div class="flex items-center justify-between gap-4">
              <h3 id="embed-${e.id}-title" class="text-sm font-semibold text-ink">
                Embed this booking page
              </h3>
              <button type="button" class="ui-btn ui-btn-ghost ui-btn-sm px-2"
                      data-dialog-close aria-label="Close">
                ${icon("x", "size-4")}
              </button>
            </div>
            <p class="mt-1 text-[0.8125rem] text-muted">
              Paste this snippet into your website where the booking page should appear.
            </p>
            <div class="mt-3 flex gap-1 border-b border-line" role="tablist" aria-label="Embed type">
              <button type="button" class="ui-embed-tab ui-embed-tab-active" role="tab"
                      aria-selected="true" data-embed-tab="inline">Inline</button>
              <button type="button" class="ui-embed-tab" role="tab" aria-selected="false"
                      data-embed-tab="popup">Popup</button>
            </div>
            <textarea class="ui-input mt-3 resize-none font-mono text-[0.75rem]" rows="4"
                      readonly data-embed-code data-embed-code-tab="inline"></textarea>
            <textarea class="ui-input mt-3 resize-none font-mono text-[0.75rem]" rows="8"
                      readonly data-embed-code data-embed-code-tab="popup" hidden></textarea>
            <div class="mt-3 flex justify-end">
              <button type="button" class="ui-btn ui-btn-secondary ui-btn-sm" data-embed-copy>
                ${icon("copy", "size-4")}<span>Copy code</span>
              </button>
            </div>
          </div>
        </dialog>
      </article>`;
    })
    .join("");

  const items = eventTypes.map((e) => ({
    name: e.name,
    slug: e.slug,
    description: e.description ?? "",
  }));

  const list = eventTypes.length
    ? `<div class="mb-8" x-data="{
        q: '',
        items: ${escapeHtml(JSON.stringify(items))},
        matches(item) {
          var haystack = (item.name + ' ' + item.slug + ' ' + item.description).toLowerCase();
          return haystack.includes(this.q.trim().toLowerCase());
        },
        noMatches() {
          return this.q.trim() !== '' && !this.items.some((item) => this.matches(item));
        }
      }">
        <div class="relative mb-4 max-w-xs">
          <span class="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-muted">
            ${icon("search", "size-4")}
          </span>
          <input type="search" class="ui-input pl-9" placeholder="Search event types…"
                 aria-label="Search event types" x-model="q">
        </div>
        <div class="grid gap-3">${cards}</div>
        <div class="ui-card" x-show="noMatches()" x-cloak>
          ${emptyState({
            icon: "search",
            title: "No event types match",
            body: "Nothing matches your search. Try different words or clear it.",
            actionHtml: `<button type="button" class="ui-btn ui-btn-secondary ui-btn-sm" @click="q = ''">
              Clear search
            </button>`,
          })}
        </div>
      </div>`
    : `<div class="ui-card mb-8">${emptyState({
        icon: "layers",
        title: "No event types yet",
        body: "An event type is a meeting people can book — a name, a length, and a URL.",
        actionHtml: `${button({
          label: "New event type",
          href: "/dashboard/event-types/new",
          variant: "primary",
          size: "sm",
          icon: "plus",
        })}`,
      })}</div>`;

  return layout({
    title: "Event Types",
    nav: "host",
    activeNav: "/dashboard/event-types",
    hostName: user.name,
    hostAvatarKey: user.avatar_key,
    hostSlug: user.slug,
    toast,
    body: `
      ${pageHeader({
        eyebrow: "Bookable meetings",
        title: "Event types",
        subtitle: "Each one gets its own public booking link.",
        actionsHtml: `${button({
          label: "New event type",
          href: "/dashboard/event-types/new",
          variant: "primary",
          size: "sm",
          icon: "plus",
        })}`,
      })}

      ${list}

      ${EMBED_SCRIPT}`,
  });
}

/* -------------------------------------------------------------------------- */

export interface CreateEventTypeDraft {
  name: string;
  slug: string;
  description: string;
  durationMinutes: number;
  bufferMinutes: number;
  seatsTotal: number;
  scheduleMode: "weekly" | "dates";
  dates: Array<{ date: string; start: string; end: string }>;
  locationType: string;
  locationValue: string;
}

export function eventTypeCreatePage(
  user: PublicUser,
  draft?: CreateEventTypeDraft,
  error?: string,
  toast = "",
): string {
  const d = draft ?? {
    name: "",
    slug: "",
    description: "",
    durationMinutes: 30,
    bufferMinutes: 0,
    seatsTotal: 1,
    scheduleMode: "weekly" as const,
    dates: [],
    locationType: "none",
    locationValue: "",
  };
  const initialDates = d.dates.length
    ? d.dates
    : d.scheduleMode === "dates"
      ? [{ date: "", start: "", end: "" }]
      : [];
  const datesOnly = d.scheduleMode === "dates" ? 1 : 0;

  const dateRowsHtml = initialDates
    .map(
      (r, i) => `
    <div class="flex items-center gap-2" data-date-row>
      <input class="ui-input font-mono" type="date" name="ed_date_${i}" value="${escapeHtml(
        r.date,
      )}" aria-label="Date ${i + 1}">
      <input class="ui-input font-mono" type="time" name="ed_start_${i}" value="${escapeHtml(
        r.start,
      )}" aria-label="Start time ${i + 1}">
      <span class="text-[0.75rem] text-muted shrink-0">to</span>
      <input class="ui-input font-mono" type="time" name="ed_end_${i}" value="${escapeHtml(
        r.end,
      )}" aria-label="End time ${i + 1}">
      <button type="button" class="ui-btn ui-btn-ghost ui-btn-sm px-2 shrink-0"
              data-remove-date aria-label="Remove date">
        ${icon("x", "size-4")}
      </button>
    </div>`,
    )
    .join("");

  const locationOptions = ["none", "google_meet", "zoom", "in_person", "phone"]
    .map(
      (t) =>
        `<option value="${t}"${d.locationType === t ? " selected" : ""}>${
          {
            none: "No location",
            google_meet: "Google Meet",
            zoom: "Zoom",
            in_person: "In person",
            phone: "Phone",
          }[t]
        }</option>`,
    )
    .join("");

  const locationValueField =
    d.locationType === "google_meet" || d.locationType === "zoom"
      ? field({
          name: "location_value",
          label: "Meeting link",
          value: d.locationValue,
          required: false,
          placeholder: "https://meet.google.com/…",
        })
      : d.locationType === "in_person" || d.locationType === "phone"
        ? field({
            name: "location_value",
            label: d.locationType === "in_person" ? "Address" : "Phone number",
            value: d.locationValue,
            required: false,
            placeholder: d.locationType === "in_person" ? "Office address" : "+60 …",
          })
        : "";

  return layout({
    title: "New event type",
    nav: "host",
    activeNav: "/dashboard/event-types",
    hostName: user.name,
    hostAvatarKey: user.avatar_key,
    hostSlug: user.slug,
    toast,
    body: `
      <a href="/dashboard/event-types" class="ui-btn ui-btn-ghost ui-btn-sm -ml-2 mb-4">
        ${icon("arrowLeft", "size-4")}<span>Event types</span>
      </a>

      ${pageHeader({
        eyebrow: "Event type",
        title: "New event type",
        subtitle: "Create a bookable meeting or ticketed session.",
      })}

      ${error ? `<div class="mb-4">${alert("danger", error)}</div>` : ""}

      <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <form class="ui-card ui-card-pad space-y-4" method="post"
              action="/dashboard/event-types" enctype="multipart/form-data">
          ${field({ name: "name", label: "Name", value: d.name })}
          ${field({
            name: "slug",
            label: "URL slug",
            value: d.slug,
            hint: `Public link: /${escapeHtml(user.slug)}/…`,
          })}

          <div class="ui-fieldset">
            <label class="ui-label" for="image">
              Cover image <span class="font-normal text-muted">(optional)</span>
            </label>
            <div class="rounded-lg border border-line bg-subtle p-4" data-image-upload>
              <input type="file" id="image" name="image" accept="image/png,image/jpeg,image/webp,image/gif"
                     class="block w-full text-[0.8125rem] text-body file:mr-3 file:rounded-md file:border-0
                            file:bg-primary file:px-3 file:py-1.5 file:text-[0.8125rem] file:font-medium
                            file:text-on-primary hover:file:opacity-90">
              <div data-image-preview class="mt-3 hidden">
                <img src="" alt="Cover preview" class="aspect-video w-full max-w-sm rounded-lg border border-line object-cover">
                <button type="button" data-remove-image class="mt-2 text-[0.8125rem] text-danger hover:underline">
                  Remove image
                </button>
              </div>
              <p class="ui-hint mt-2">PNG, JPEG, WebP or GIF. Max 5 MB. 16:9 ratio looks best.</p>
            </div>
          </div>

          ${field({
            name: "description",
            label: "Description",
            required: false,
            value: d.description,
            attrsHtml: 'rows="3"',
          })}

          <div class="ui-fieldset">
            <label class="ui-label" for="seats_total">Booking style</label>
            <input class="ui-input font-mono" id="seats_total" name="seats_total" type="number"
                   value="${String(d.seatsTotal)}" min="1" max="100" step="1">
            <p class="ui-hint">1 = private booking. 2 or more = group/shared slot.</p>
          </div>

          <div class="ui-fieldset">
            <label class="ui-label" for="schedule_mode">Schedule</label>
            <select class="ui-select" id="schedule_mode" name="schedule_mode" data-schedule-mode>
              <option value="weekly"${datesOnly === 0 ? " selected" : ""}>Weekly schedule</option>
              <option value="dates"${datesOnly === 1 ? " selected" : ""}>Specific dates only</option>
            </select>
            <p class="ui-hint" data-hint-weekly>Slots follow your weekly availability rules.</p>
            <div data-dates-block class="mt-2 space-y-2" hidden>
              <p class="ui-hint">
                Each date runs as one session from start to end — add several rows on the same
                date for multiple sessions that day.
              </p>
              <div class="space-y-2" data-date-rows>
                ${
                  dateRowsHtml ||
                  `
                  <div class="flex items-center gap-2" data-date-row>
                    <input class="ui-input font-mono" type="date" name="ed_date_0" aria-label="Date 1">
                    <input class="ui-input font-mono" type="time" name="ed_start_0" aria-label="Start time 1">
                    <span class="text-[0.75rem] text-muted shrink-0">to</span>
                    <input class="ui-input font-mono" type="time" name="ed_end_0" aria-label="End time 1">
                    <button type="button" class="ui-btn ui-btn-ghost ui-btn-sm px-2 shrink-0"
                            data-remove-date aria-label="Remove date">
                      ${icon("x", "size-4")}
                    </button>
                  </div>
                `
                }
              </div>
              <input type="hidden" name="ed_count" data-date-count value="${initialDates.length}">
              <div>
                <button type="button" class="ui-btn ui-btn-secondary ui-btn-sm" data-add-date>
                  ${icon("plus", "size-4")}<span>Add date</span>
                </button>
              </div>
            </div>
          </div>

          <div data-weekly-block${datesOnly === 1 ? " hidden" : ""}>
            ${field({
              name: "duration_minutes",
              label: "Duration",
              type: "number",
              value: String(d.durationMinutes),
              hint: "Minutes. Slots are generated on this interval.",
              attrsHtml: 'min="5" max="480" step="5"',
            })}
            ${field({
              name: "buffer_minutes",
              label: "Buffer after meeting",
              type: "number",
              value: String(d.bufferMinutes),
              hint: "Minutes of breathing room after each booking. 0 = back-to-back.",
              attrsHtml: 'min="0" max="120" step="5"',
            })}
          </div>

          ${field({
            name: "location_type",
            label: "Location",
            required: false,
            controlHtml: `<select class="ui-select" id="location_type" name="location_type" data-location-type>
              ${locationOptions}
            </select>`,
          })}

          <div data-location-value-block${d.locationType === "none" ? " hidden" : ""}>
            ${locationValueField}
          </div>

          <div class="flex justify-end border-t border-line pt-4">
            ${button({ label: "Create event type", variant: "primary", icon: "check" })}
          </div>
        </form>

        <div class="space-y-4">
          <section class="ui-card ui-card-pad">
            <p class="ui-eyebrow mb-2">Preview</p>
            <div class="overflow-hidden rounded-lg border border-line">
              <div data-preview-image class="aspect-video bg-subtle hidden"></div>
              <div class="p-4">
                <p class="text-sm font-semibold text-ink" data-preview-name>${escapeHtml(d.name || "Event name")}</p>
                <p class="mt-1 text-[0.8125rem] text-muted" data-preview-description>
                  ${escapeHtml(d.description || "A short description of this event.")}
                </p>
                <p class="mt-3 flex items-center gap-1.5 text-[0.8125rem] text-muted">
                  ${icon("clock", "size-3.5")}
                  <span class="ui-time" data-preview-duration>${d.durationMinutes} min</span>
                </p>
              </div>
            </div>
          </section>
        </div>
      </div>

      <script>
        (function () {
          var mode = document.querySelector("[data-schedule-mode]");
          var block = document.querySelector("[data-dates-block]");
          var hint = document.querySelector("[data-hint-weekly]");
          var count = document.querySelector("[data-date-count]");
          var list = document.querySelector("[data-date-rows]");
          if (!mode || !block || !list || !count) return;

          function sync() {
            var dates = mode.value === "dates";
            block.hidden = !dates;
            hint.hidden = dates;
            var weeklyBlock = document.querySelector("[data-weekly-block]");
            if (weeklyBlock) weeklyBlock.hidden = dates;
            count.value = dates ? String(list.querySelectorAll("[data-date-row]").length) : "0";
          }

          function reindex() {
            var rows = list.querySelectorAll("[data-date-row]");
            rows.forEach(function (row, i) {
              row.querySelector('[name^="ed_date_"]').name = "ed_date_" + i;
              row.querySelector('[name^="ed_start_"]').name = "ed_start_" + i;
              row.querySelector('[name^="ed_end_"]').name = "ed_end_" + i;
              ["Date", "Start time", "End time"].forEach(function (label, k) {
                var input = row.querySelectorAll("input")[k];
                if (input) input.setAttribute("aria-label", label + " " + (i + 1));
              });
            });
            count.value = String(rows.length);
          }

          mode.addEventListener("change", sync);

          document.querySelector("[data-add-date]").addEventListener("click", function () {
            var rows = list.querySelectorAll("[data-date-row]");
            var clone = rows[rows.length - 1].cloneNode(true);
            clone.querySelectorAll("input").forEach(function (input) { input.value = ""; });
            list.appendChild(clone);
            reindex();
            clone.querySelector("input").focus();
          });

          list.addEventListener("click", function (event) {
            var btn = event.target.closest("[data-remove-date]");
            if (!btn) return;
            var rows = list.querySelectorAll("[data-date-row]");
            if (rows.length === 1) {
              rows[0].querySelectorAll("input").forEach(function (i) { i.value = ""; });
            } else {
              btn.closest("[data-date-row]").remove();
              reindex();
            }
          });

          sync();
        })();

        (function () {
          var fileInput = document.getElementById("image");
          var previewWrap = document.querySelector("[data-image-preview]");
          var previewImg = previewWrap ? previewWrap.querySelector("img") : null;
          var removeBtn = document.querySelector("[data-remove-image]");
          var previewName = document.querySelector("[data-preview-name]");
          var previewDesc = document.querySelector("[data-preview-description]");
          var nameInput = document.getElementById("name");
          var descInput = document.getElementById("description");
          var previewImageCard = document.querySelector("[data-preview-image]");

          if (previewName && nameInput) {
            nameInput.addEventListener("input", function () {
              previewName.textContent = nameInput.value.trim() || "Event name";
            });
          }
          if (previewDesc && descInput) {
            descInput.addEventListener("input", function () {
              previewDesc.textContent = descInput.value.trim() || "A short description of this event.";
            });
          }

          function clearPreview() {
            if (fileInput) fileInput.value = "";
            if (previewWrap) previewWrap.classList.add("hidden");
            if (previewImageCard) {
              previewImageCard.style.backgroundImage = "";
              previewImageCard.classList.add("hidden");
            }
          }

          if (fileInput && previewImg && previewWrap) {
            fileInput.addEventListener("change", function () {
              var file = fileInput.files && fileInput.files[0];
              if (!file) return clearPreview();
              var url = URL.createObjectURL(file);
              previewImg.src = url;
              previewWrap.classList.remove("hidden");
              if (previewImageCard) {
                previewImageCard.style.backgroundImage = 'url("' + url + '")';
                previewImageCard.style.backgroundSize = "cover";
                previewImageCard.style.backgroundPosition = "center";
                previewImageCard.classList.remove("hidden");
              }
            });
          }

          if (removeBtn) removeBtn.addEventListener("click", clearPreview);
        })();

        (function () {
          var locationType = document.getElementById("location_type");
          var valueBlock = document.querySelector("[data-location-value-block]");
          if (!locationType || !valueBlock) return;

          var placeholders = {
            google_meet: "https://meet.google.com/…",
            zoom: "https://zoom.us/j/…",
            in_person: "Office address",
            phone: "+60 …"
          };
          var labels = {
            google_meet: "Meeting link",
            zoom: "Meeting link",
            in_person: "Address",
            phone: "Phone number"
          };

          function syncLocation() {
            var type = locationType.value;
            if (type === "none") {
              valueBlock.hidden = true;
              return;
            }
            valueBlock.hidden = false;
            var input = valueBlock.querySelector("input");
            var label = valueBlock.querySelector(".ui-label");
            if (input) {
              input.placeholder = placeholders[type] || "";
              input.value = input.value || "";
            }
            if (label) label.textContent = labels[type] || "Location details";
          }

          locationType.addEventListener("change", syncLocation);
          syncLocation();
        })();
      </script>`,
  });
}

/* -------------------------------------------------------------------------- */

export function eventTypeEditPage(
  user: PublicUser,
  eventType: EventTypeRow,
  bookingCount: number,
  error?: string,
  toast = "",
  savedLocations: string[] = [],
  dateRows: Array<{ date: string; start: string; end: string }> = [],
): string {
  const path = `/${user.slug}/${eventType.slug}`;
  const active = eventType.is_active === 1;

  // A type with history can never be hard-deleted, or its bookings lose their
  // event name. Say so on the button rather than surprising the host after.
  const destructive =
    bookingCount > 0
      ? {
          label: "Deactivate permanently",
          note: `${bookingCount} booking${bookingCount === 1 ? "" : "s"} reference this event type, so it is deactivated rather than deleted.`,
        }
      : {
          label: "Delete event type",
          note: "No bookings reference it, so it will be removed entirely.",
        };

  return layout({
    title: `Edit ${eventType.name}`,
    nav: "host",
    activeNav: "/dashboard/event-types",
    hostName: user.name,
    hostAvatarKey: user.avatar_key,
    hostSlug: user.slug,
    toast,
    body: `
      <a href="/dashboard/event-types" class="ui-btn ui-btn-ghost ui-btn-sm -ml-2 mb-4">
        ${icon("arrowLeft", "size-4")}<span>Event types</span>
      </a>

      ${pageHeader({
        eyebrow: "Event type",
        title: eventType.name,
        subtitle: path,
        actionsHtml: `${active ? badge("success", "Active") : badge("neutral", "Inactive", false)}${
          eventType.seats_total > 1
            ? button({
                label: "Tickets",
                href: `/dashboard/event-types/${eventType.id}/tickets`,
                variant: "secondary",
                size: "sm",
                icon: "check",
              })
            : ""
        }${button({ label: "Preview", href: path, variant: "secondary", size: "sm", icon: "link" })}`,
      })}

      ${error ? `<div class="mb-4">${alert("danger", error)}</div>` : ""}

      <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <form class="ui-card ui-card-pad space-y-4" method="post"
              action="/dashboard/event-types/${eventType.id}" enctype="multipart/form-data">
          ${field({ name: "name", label: "Name", value: eventType.name })}
          ${field({
            name: "slug",
            label: "URL slug",
            value: eventType.slug,
            hint: `Changing this breaks any link already shared as ${path}.`,
          })}

          <div class="ui-fieldset">
            <label class="ui-label" for="image">
              Cover image <span class="font-normal text-muted">(optional)</span>
            </label>
            <div class="rounded-lg border border-line bg-subtle p-4" data-image-upload>
              ${
                eventType.image_key
                  ? `<div data-current-image class="mb-3">
                       <img src="/${escapeHtml(eventType.image_key)}" alt="Current cover image"
                            class="aspect-video w-full max-w-sm rounded-lg border border-line object-cover">
                       <label class="mt-2 flex items-center gap-2 text-[0.8125rem] text-danger">
                         <input type="checkbox" name="remove_image" value="1">
                         Remove image
                       </label>
                     </div>`
                  : ""
              }
              <input type="file" id="image" name="image" accept="image/png,image/jpeg,image/webp,image/gif"
                     class="block w-full text-[0.8125rem] text-body file:mr-3 file:rounded-md file:border-0
                            file:bg-primary file:px-3 file:py-1.5 file:text-[0.8125rem] file:font-medium
                            file:text-on-primary hover:file:opacity-90">
              <div data-image-preview class="mt-3 hidden">
                <img src="" alt="New cover preview" class="aspect-video w-full max-w-sm rounded-lg border border-line object-cover">
                <button type="button" data-remove-image class="mt-2 text-[0.8125rem] text-danger hover:underline">
                  Remove new image
                </button>
              </div>
              <p class="ui-hint mt-2">PNG, JPEG, WebP or GIF. Max 5 MB. 16:9 ratio looks best.</p>
            </div>
          </div>

          <div data-weekly-block>
          ${field({
            name: "duration_minutes",
            label: "Duration",
            type: "number",
            value: String(eventType.duration_minutes),
            hint: "Minutes. Existing bookings keep their original length.",
            attrsHtml: 'min="5" max="480" step="5"',
          })}
          ${field({
            name: "buffer_minutes",
            label: "Buffer after meeting",
            type: "number",
            value: String(eventType.buffer_minutes),
            hint: "Minutes of breathing room after each booking.",
            attrsHtml: 'min="0" max="120" step="5"',
          })}
          </div>
          ${field({
            name: "seats_total",
            label: "Seats",
            type: "number",
            value: String(eventType.seats_total),
            hint:
              eventType.seats_total > 1
                ? `Group event — up to ${eventType.seats_total} guests share a slot.`
                : "1 = private booking. Raise it to run group events.",
            attrsHtml: 'min="1" max="100" step="1"',
          })}
          <div class="ui-fieldset">
            <label class="ui-label" for="schedule_mode">Schedule</label>
            <select class="ui-select" id="schedule_mode" name="schedule_mode" data-schedule-mode>
              <option value="weekly"${eventType.dates_only === 1 ? "" : " selected"}>
                Weekly schedule
              </option>
              <option value="dates"${eventType.dates_only === 1 ? " selected" : ""}>
                Specific dates only
              </option>
            </select>
            <p class="ui-hint" data-hint-weekly>Slots follow your weekly availability rules.</p>
            <div data-dates-block class="mt-2 space-y-2" hidden>
              <p class="ui-hint">
                Each date runs as one session from start to end — add several rows on the same
                date for multiple sessions that day.
              </p>
              <div class="space-y-2" data-date-rows>
                ${
                  dateRows.length
                    ? dateRows
                        .map(
                          (r, i) => `
                  <div class="flex items-center gap-2" data-date-row>
                    <input class="ui-input font-mono" type="date" name="ed_date_${i}"
                           value="${escapeHtml(r.date)}" aria-label="Date ${i + 1}">
                    <input class="ui-input font-mono" type="time" name="ed_start_${i}"
                           value="${escapeHtml(r.start)}" aria-label="Start time ${i + 1}">
                    <span class="text-[0.75rem] text-muted shrink-0">to</span>
                    <input class="ui-input font-mono" type="time" name="ed_end_${i}"
                           value="${escapeHtml(r.end)}" aria-label="End time ${i + 1}">
                    <button type="button" class="ui-btn ui-btn-ghost ui-btn-sm px-2 shrink-0"
                            data-remove-date aria-label="Remove date">
                      ${icon("x", "size-4")}
                    </button>
                  </div>`,
                        )
                        .join("")
                    : `<div class="flex items-center gap-2" data-date-row>
                    <input class="ui-input font-mono" type="date" name="ed_date_0" aria-label="Date 1">
                    <input class="ui-input font-mono" type="time" name="ed_start_0" aria-label="Start time 1">
                    <span class="text-[0.75rem] text-muted shrink-0">to</span>
                    <input class="ui-input font-mono" type="time" name="ed_end_0" aria-label="End time 1">
                    <button type="button" class="ui-btn ui-btn-ghost ui-btn-sm px-2 shrink-0"
                            data-remove-date aria-label="Remove date">
                      ${icon("x", "size-4")}
                    </button>
                  </div>`
                }
              </div>
              <input type="hidden" name="ed_count" data-date-count
                     value="${eventType.dates_only === 1 ? Math.max(1, dateRows.length) : 0}">
              <div>
                <button type="button" class="ui-btn ui-btn-secondary ui-btn-sm" data-add-date>
                  ${icon("plus", "size-4")}<span>Add date</span>
                </button>
              </div>
            </div>
          </div>
          ${field({
            name: "description",
            label: "Description",
            required: false,
            value: eventType.description ?? "",
          })}
          ${field({
            name: "location_type",
            label: "Location",
            required: false,
            controlHtml: `<select class="ui-select" id="location_type" name="location_type">
              ${["none", "google_meet", "zoom", "in_person", "phone"]
                .map(
                  (t) =>
                    `<option value="${t}"${eventType.location_type === t ? " selected" : ""}>${
                      {
                        none: "No location",
                        google_meet: "Google Meet",
                        zoom: "Zoom",
                        in_person: "In person",
                        phone: "Phone",
                      }[t]
                    }</option>`,
                )
                .join("")}
            </select>`,
          })}
          ${
            eventType.location_type === "google_meet" || eventType.location_type === "zoom"
              ? field({
                  name: "saved_location_value",
                  label: "Meeting link",
                  required: false,
                  controlHtml: `<select class="ui-select" id="saved_location_value" name="saved_location_value">
                    <option value="__custom__">Use a new link…</option>
                    ${savedLocations
                      .map(
                        (l) =>
                          `<option value="${escapeHtml(l)}"${
                            l === eventType.location_value ? " selected" : ""
                          }>${escapeHtml(l)}</option>`,
                      )
                      .join("")}
                    ${
                      eventType.location_value && !savedLocations.includes(eventType.location_value)
                        ? `<option value="${escapeHtml(eventType.location_value)}" selected>${escapeHtml(eventType.location_value)}</option>`
                        : ""
                    }
                  </select>`,
                })
              : ""
          }
          ${field({
            name: "location_value",
            label: "Location details",
            required: false,
            value: eventType.location_value ?? "",
            hint: "Meeting link, address or phone number — guests will see it on the booking page.",
          })}
          <div class="flex justify-end border-t border-line pt-4">
            ${button({ label: "Save changes", variant: "primary", icon: "check" })}
          </div>
        </form>

        <div class="space-y-4">
          <section class="ui-card ui-card-pad">
            <p class="ui-eyebrow mb-2">Visibility</p>
            <p class="text-[0.8125rem] text-muted">
              ${
                active
                  ? "Guests can see and book this event type."
                  : "Hidden from your public page. Existing bookings are unaffected."
              }
            </p>
            <form method="post" action="/dashboard/event-types/${eventType.id}/toggle" class="mt-3">
              ${button({
                label: active ? "Deactivate" : "Activate",
                variant: "secondary",
                size: "sm",
              })}
            </form>
          </section>

          <section class="ui-card ui-card-pad border-danger/25">
            <p class="ui-eyebrow mb-2 text-danger">Danger zone</p>
            <p class="text-[0.8125rem] text-muted">${escapeHtml(destructive.note)}</p>
            <form method="post" action="/dashboard/event-types/${eventType.id}/delete" class="mt-3"
                  onsubmit="return confirm('${escapeHtml(destructive.label)}? This cannot be undone.')">
              ${button({ label: destructive.label, variant: "danger", size: "sm" })}
            </form>
          </section>
        </div>
      </div>

      <script>
        (function () {
          var mode = document.querySelector("[data-schedule-mode]");
          var block = document.querySelector("[data-dates-block]");
          var hint = document.querySelector("[data-hint-weekly]");
          var count = document.querySelector("[data-date-count]");
          var list = document.querySelector("[data-date-rows]");
          if (!mode || !block || !list || !count) return;

          function sync() {
            var dates = mode.value === "dates";
            block.hidden = !dates;
            hint.hidden = dates;
            var weeklyBlock = document.querySelector("[data-weekly-block]");
            if (weeklyBlock) weeklyBlock.hidden = dates;
            count.value = dates ? String(list.querySelectorAll("[data-date-row]").length) : "0";
          }

          function reindex() {
            var rows = list.querySelectorAll("[data-date-row]");
            rows.forEach(function (row, i) {
              row.querySelector('[name^="ed_date_"]').name = "ed_date_" + i;
              row.querySelector('[name^="ed_start_"]').name = "ed_start_" + i;
              row.querySelector('[name^="ed_end_"]').name = "ed_end_" + i;
              ["Date", "Start time", "End time"].forEach(function (label, k) {
                var input = row.querySelectorAll("input")[k];
                if (input) input.setAttribute("aria-label", label + " " + (i + 1));
              });
            });
            count.value = String(rows.length);
          }

          mode.addEventListener("change", sync);

          document.querySelector("[data-add-date]").addEventListener("click", function () {
            var rows = list.querySelectorAll("[data-date-row]");
            var clone = rows[rows.length - 1].cloneNode(true);
            clone.querySelectorAll("input").forEach(function (input) { input.value = ""; });
            list.appendChild(clone);
            reindex();
            clone.querySelector("input").focus();
          });

          list.addEventListener("click", function (event) {
            var btn = event.target.closest("[data-remove-date]");
            if (!btn) return;
            var rows = list.querySelectorAll("[data-date-row]");
            if (rows.length === 1) {
              rows[0].querySelectorAll("input").forEach(function (i) { i.value = ""; });
            } else {
              btn.closest("[data-date-row]").remove();
              reindex();
            }
          });

          sync();
        })();

        (function () {
          var fileInput = document.getElementById("image");
          var previewWrap = document.querySelector("[data-image-preview]");
          var previewImg = previewWrap ? previewWrap.querySelector("img") : null;
          var removeBtn = document.querySelector("[data-remove-image]");
          var removeCheckbox = document.querySelector('input[name="remove_image"]');
          var currentImage = document.querySelector("[data-current-image]");

          function clearPreview() {
            if (fileInput) fileInput.value = "";
            if (previewWrap) previewWrap.classList.add("hidden");
            if (currentImage) {
              var removing = removeCheckbox ? removeCheckbox.checked : false;
              currentImage.classList.toggle("hidden", removing);
            }
          }

          if (fileInput && previewImg && previewWrap) {
            fileInput.addEventListener("change", function () {
              var file = fileInput.files && fileInput.files[0];
              if (!file) return clearPreview();
              if (removeCheckbox) removeCheckbox.checked = false;
              if (currentImage) currentImage.classList.add("hidden");
              previewImg.src = URL.createObjectURL(file);
              previewWrap.classList.remove("hidden");
            });
          }

          if (removeBtn) removeBtn.addEventListener("click", clearPreview);

          if (removeCheckbox && currentImage) {
            removeCheckbox.addEventListener("change", function () {
              currentImage.classList.toggle("hidden", removeCheckbox.checked);
            });
          }
        })();
      </script>`,
  });
}

/* -------------------------------------------------------------------------- */

/* -------------------------------------------------------------------------- */

export interface TicketManagerGuest {
  attendeeId: number;
  bookingId: number;
  name: string;
  email: string;
  code: string | null;
  checkedIn: boolean;
  cancelled: boolean;
  /** Session the guest is registered for, fixed-width UTC. */
  sessionStartAt: string;
  sessionLabel?: string;
}

export interface TicketManagerSession {
  /** Session start, fixed-width UTC; labelled by the view. */
  startAt: string;
  registered: number;
  checkedIn: number;
  /** Filled in by the view (host-local "When" label). */
  label?: string;
}

export interface TicketManagerData {
  capacity: number;
  registered: number;
  checkedIn: number;
  sessions: TicketManagerSession[];
  guests: TicketManagerGuest[];
  /** Public booking URL for sharing. */
  publicUrl: string;
}

const GUEST_ROW_SCRIPT = `
  <script>
    (function () {
      var search = document.querySelector("[data-guest-search]");
      var filter = document.body.getAttribute("data-guest-default-filter") || "all";
      function apply() {
        var q = (search && search.value || "").trim().toLowerCase();
        var visible = 0;
        document.querySelectorAll("[data-guest]").forEach(function (row) {
          var state = row.getAttribute("data-state");
          var okFilter = filter === "all" ||
            (filter === "in" && state === "in") ||
            (filter === "out" && state === "out");
          var okQ = !q || (row.getAttribute("data-text") || "").indexOf(q) !== -1;
          row.hidden = !(okFilter && okQ);
          if (!row.hidden) visible++;
        });
        var counter = document.querySelector("[data-guest-visible]");
        if (counter) counter.textContent = String(visible);
      }
      document.querySelectorAll("[data-guest-filter]").forEach(function (btn) {
        btn.addEventListener("click", function () {
          filter = btn.getAttribute("data-guest-filter");
          document.querySelectorAll("[data-guest-filter]").forEach(function (b) {
            b.classList.toggle("ui-seg-active", b === btn);
          });
          apply();
        });
      });
      if (search) search.addEventListener("input", apply);
      apply();
    })();
    (function () {
      var btn = document.querySelector("[data-copy-link]");
      if (!btn) return;
      btn.addEventListener("click", function () {
        var input = document.querySelector("[data-copy-value]");
        var value = input ? input.value : "";
        function done() {
          var original = btn.textContent;
          btn.textContent = "Copied";
          window.setTimeout(function () { btn.textContent = original; }, 1500);
        }
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(value).then(done);
        } else {
          input.select();
          try { document.execCommand("copy"); } catch (e) {}
          done();
        }
      });
    })();
  </script>`;

function whenLabel(iso: string, timeZone: string): string {
  const p = whenParts(iso, timeZone);
  return `${p.day} · ${p.clock}`;
}

function withSessionLabels(data: TicketManagerData, timeZone: string): TicketManagerData {
  return {
    ...data,
    sessions: data.sessions.map((s) => ({ ...s, label: whenLabel(s.startAt, timeZone) })),
    guests: data.guests.map((g) => ({ ...g, sessionLabel: whenLabel(g.sessionStartAt, timeZone) })),
  };
}

function ticketGuestRow(guest: TicketManagerGuest, backPath: string, compact = false): string {
  const state = guest.cancelled ? "cancelled" : guest.checkedIn ? "in" : "out";
  const back = encodeURIComponent(backPath);
  const control = guest.cancelled
    ? `<span class="ui-badge ui-badge-neutral shrink-0">Cancelled</span>`
    : `<form method="post"
           action="/dashboard/bookings/${guest.bookingId}/attendees/${guest.attendeeId}/check-in?back=${back}">
        <button type="submit" class="${
          guest.checkedIn
            ? "ui-badge ui-badge-success cursor-pointer hover:brightness-95"
            : compact
              ? "ui-btn ui-btn-primary ui-btn-sm"
              : "ui-btn ui-btn-secondary ui-btn-sm"
        }" ${guest.checkedIn ? 'title="Click to undo check-in"' : ""}>
          ${
            guest.checkedIn
              ? `${icon("check", "size-3.5")}<span>In</span>`
              : `${icon("check", "size-4")}<span>Check in</span>`
          }
        </button>
      </form>`;
  return `<li data-guest data-state="${state}"
        data-text="${escapeHtml(
          `${guest.name} ${guest.code ?? ""} ${guest.email}`.toLowerCase(),
        )}" class="py-2.5">
      <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
        <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
          <span class="text-[0.875rem] font-medium text-ink">${escapeHtml(guest.name)}</span>
          <span class="rounded border border-line bg-subtle px-1.5 py-0.5 font-mono text-[0.75rem] font-medium tracking-[0.06em] text-ink">${escapeHtml(
            guest.code ?? "—",
          )}</span>
          <span class="truncate text-[0.75rem] text-muted">${escapeHtml(guest.email)}</span>
          <span class="text-[0.6875rem] text-muted">· ${escapeHtml(guest.sessionLabel ?? "")}</span>
        </div>
        ${control}
      </div>
    </li>`;
}

function ticketGuestSection(
  guests: TicketManagerGuest[],
  backPath: string,
  opts: { compact?: boolean; defaultFilter?: string; autofocus?: boolean } = {},
): string {
  if (guests.length === 0) {
    return `<div class="ui-card ui-card-pad">${emptyState({
      icon: "user",
      title: "No registrations yet",
      body: "Share the public link — guests appear here the moment they take a seat.",
    })}</div>`;
  }
  const filters = opts.compact
    ? ""
    : `<div class="ui-seg" role="group" aria-label="Filter guests">
        <button type="button" data-guest-filter="all">All</button>
        <button type="button" data-guest-filter="out">Not in</button>
        <button type="button" data-guest-filter="in">In</button>
      </div>`;
  return `<div class="ui-card ui-card-pad">
      <div class="flex flex-wrap items-center justify-between gap-3">
        ${filters}
        <div class="flex min-w-0 items-center gap-2">
          <span class="text-[0.75rem] text-muted" data-guest-visible></span>
          <input type="search" data-guest-search ${opts.autofocus ? "autofocus" : ""}
                 placeholder="Search name, code or email"
                 class="ui-input w-full max-w-xs py-1.5 text-[0.8125rem]">
        </div>
      </div>
      <ul class="mt-2 divide-y divide-line">${guests
        .map((g) => ticketGuestRow(g, backPath, opts.compact))
        .join("")}</ul>
    </div>`;
}

/** Full manager for one ticketed event type. */
export function eventTicketsPage(
  user: PublicUser,
  eventType: EventTypeRow,
  data: TicketManagerData,
  toast = "",
): string {
  const backPath = `/dashboard/event-types/${eventType.id}/tickets`;
  const labelled = withSessionLabels(data, user.timezone);
  const sessionRows = labelled.sessions
    .map(
      (s) => `<tr>
        <td class="text-[0.8125rem]"><span class="font-medium text-ink">${escapeHtml(s.label ?? "")}</span></td>
        <td class="text-[0.8125rem] text-body font-mono">${s.registered}/${data.capacity}</td>
        <td class="text-[0.8125rem] text-body font-mono">${s.checkedIn}</td>
        <td>${
          s.registered >= data.capacity
            ? badge("danger", "Full", false)
            : s.registered === 0
              ? badge("neutral", "Open", false)
              : badge("success", "Selling", false)
        }</td>
      </tr>`,
    )
    .join("");

  return layout({
    title: `Tickets — ${eventType.name}`,
    nav: "host",
    activeNav: "/dashboard/event-types",
    hostName: user.name,
    hostAvatarKey: user.avatar_key,
    hostSlug: user.slug,
    toast,
    body: `
      <a href="/dashboard/event-types" class="ui-btn ui-btn-ghost ui-btn-sm -ml-2 mb-4">
        ${icon("arrowLeft", "size-4")}<span>Event types</span>
      </a>

      ${pageHeader({
        eyebrow: "Ticket manager",
        title: eventType.name,
        subtitle: `${data.capacity} seats per session`,
        actionsHtml: `${button({
          label: "Door mode",
          href: `${backPath}?door=1`,
          variant: "secondary",
          size: "sm",
          icon: "search",
        })}${button({ label: "Preview", href: data.publicUrl, variant: "ghost", size: "sm", icon: "link" })}`,
      })}

      <div class="mb-4 grid gap-3 sm:grid-cols-3">
        ${statTile("Registered", String(data.registered), "user")}
        ${statTile("Checked in", String(data.checkedIn), "check")}
        ${statTile("Seats left", String(data.capacity - data.registered), "calendar")}
      </div>

      <div class="ui-card ui-card-pad mb-4">
        <p class="ui-eyebrow mb-2">Public link</p>
        <div class="flex items-center gap-2">
          <input readonly data-copy-value class="ui-input font-mono text-[0.75rem]" value="${escapeHtml(
            data.publicUrl,
          )}">
          <button type="button" data-copy-link class="ui-btn ui-btn-secondary ui-btn-sm shrink-0">
            ${icon("copy", "size-4")}<span>Copy</span>
          </button>
        </div>
      </div>

      <div class="ui-card ui-card-pad mb-4">
        <p class="ui-eyebrow mb-3">Sessions</p>
        ${
          data.sessions.length === 0
            ? `<p class="text-[0.8125rem] text-muted">No sessions on the books yet.</p>`
            : `<table class="ui-table w-full">
                <thead><tr><th>When</th><th>Registered</th><th>Checked in</th><th></th></tr></thead>
                <tbody>${sessionRows}</tbody>
              </table>`
        }
      </div>

      <p class="ui-eyebrow mb-2">Guests</p>
      ${ticketGuestSection(labelled.guests, backPath)}
      ${GUEST_ROW_SCRIPT}`,
  });
}

/** Fullscreen check-in console for the door screen. */
export function doorModePage(
  user: PublicUser,
  eventType: EventTypeRow,
  data: TicketManagerData,
): string {
  const backPath = `/dashboard/event-types/${eventType.id}/tickets`;
  return layout({
    title: `Door — ${eventType.name}`,
    nav: "none",
    activeNav: "",
    hostName: user.name,
    hostAvatarKey: user.avatar_key,
    hostSlug: user.slug,
    body: `
      <div class="mx-auto max-w-3xl ui-rise">
        <div class="mb-4 flex items-center justify-between gap-3">
          <div>
            <p class="ui-eyebrow">Door check-in</p>
            <h1 class="text-lg font-semibold tracking-[-0.02em] text-ink">${escapeHtml(eventType.name)}</h1>
          </div>
          <div class="flex items-center gap-2">
            <span class="ui-badge ui-badge-neutral">${data.checkedIn}/${data.registered} in</span>
            <a href="${backPath}" class="ui-btn ui-btn-ghost ui-btn-sm">Exit door mode</a>
          </div>
        </div>

        ${ticketGuestSection(withSessionLabels(data, user.timezone).guests, backPath, {
          compact: true,
          defaultFilter: "out",
          autofocus: true,
        })}
        ${GUEST_ROW_SCRIPT}`,
  });
}

export function availabilityPage(
  user: PublicUser,
  rules: AvailabilityRuleRow[],
  toast = "",
): string {
  const rows = DAY_NAMES.map((day, index) => {
    const dayRules = rules.filter((r) => r.day_of_week === index);
    const active = dayRules.length > 0;

    const slotRow = (start: string, end: string, removable: boolean) => `
      <div class="flex items-center gap-2" data-window>
        <input class="ui-input w-[9.5rem] font-mono" type="time" name="start_${index}"
               value="${start}" aria-label="${day} start time">
        <span class="text-muted" aria-hidden="true">–</span>
        <input class="ui-input w-[9.5rem] font-mono" type="time" name="end_${index}"
               value="${end}" aria-label="${day} end time">
        <button type="button" data-remove-window
                class="ui-btn ui-btn-ghost ui-btn-sm px-1.5 text-muted hover:text-danger ${
                  removable ? "" : "invisible"
                }"
                aria-label="Remove this ${day} window">${icon("x", "size-4")}</button>
      </div>`;

    // Server renders existing windows plus one blank, so the page works with no
    // JavaScript. The Add button below clones a row for anyone who has it.
    const inputs =
      dayRules.map((r) => slotRow(r.start_time, r.end_time, true)).join("") +
      slotRow("", "", dayRules.length > 0);

    return `<div class="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:gap-6"
                 data-day="${index}">
      <div class="flex w-32 shrink-0 items-center gap-2 pt-2">
        <span class="size-1.5 rounded-full ${active ? "bg-success" : "bg-line-strong"}"></span>
        <span class="text-sm font-medium ${active ? "text-ink" : "text-muted"}">${day}</span>
      </div>
      <div class="flex flex-col gap-2">
        <div class="flex flex-col gap-2" data-windows>${inputs}</div>
        <div>
          <button type="button" data-add-window
                  class="ui-btn ui-btn-ghost ui-btn-sm -ml-1.5 text-muted hover:text-ink">
            ${icon("plus", "size-3.5")}<span>Add a window</span>
          </button>
        </div>
      </div>
    </div>`;
  }).join("");

  return layout({
    title: "Availability",
    nav: "host",
    activeNav: "/dashboard/availability",
    hostName: user.name,
    hostAvatarKey: user.avatar_key,
    hostSlug: user.slug,
    toast,
    body: `
      ${pageHeader({
        eyebrow: "Weekly schedule",
        title: "Availability",
        subtitle: `Times are in ${zoneDisplay(user.timezone)}. Leave a day blank to be unavailable.`,
      })}

      <form method="post" action="/dashboard/availability">
        <div class="ui-card ui-divide overflow-hidden">${rows}</div>
        <div class="mt-4 flex justify-end">
          ${button({ label: "Save availability", variant: "primary", icon: "check" })}
        </div>
      </form>

      <script>
        (function () {
          // Blank rows are ignored by the server, so adding and clearing rows
          // needs no round trip and no extra validation.
          document.querySelectorAll("[data-day]").forEach(function (day) {
            var list = day.querySelector("[data-windows]");

            function refresh() {
              var rows = list.querySelectorAll("[data-window]");
              rows.forEach(function (row, i) {
                var remove = row.querySelector("[data-remove-window]");
                // The final row is the spare; keep its remove button hidden
                // unless it is the only thing standing between empty and not.
                remove.classList.toggle("invisible", rows.length === 1);
                void i;
              });
            }

            day.querySelector("[data-add-window]").addEventListener("click", function () {
              var rows = list.querySelectorAll("[data-window]");
              var clone = rows[rows.length - 1].cloneNode(true);
              clone.querySelectorAll("input").forEach(function (input) { input.value = ""; });
              list.appendChild(clone);
              refresh();
              clone.querySelector("input").focus();
            });

            list.addEventListener("click", function (event) {
              var btn = event.target.closest("[data-remove-window]");
              if (!btn) return;
              var rows = list.querySelectorAll("[data-window]");
              if (rows.length === 1) {
                rows[0].querySelectorAll("input").forEach(function (i) { i.value = ""; });
              } else {
                btn.closest("[data-window]").remove();
              }
              refresh();
            });

            refresh();
          });
        })();
      </script>`,
  });
}

/* -------------------------------------------------------------------------- */

export function bookingsPage(
  user: PublicUser,
  bookings: BookingWithEvent[],
  scope: "upcoming" | "past" | "cancelled",
  toast = "",
  attendeesByBooking: Map<number, BookingAttendeeRow[]> = new Map(),
): string {
  const tab = (value: string, label: string) =>
    `<a href="/dashboard/bookings?scope=${value}" class="ui-nav-link ${
      scope === value ? "ui-nav-link-active" : ""
    }"${scope === value ? ' aria-current="page"' : ""}>${label}</a>`;

  const statusBadge = (status: string) =>
    status === "confirmed"
      ? badge("success", "Confirmed")
      : status === "cancelled"
        ? badge("danger", "Cancelled")
        : badge("neutral", status, false);

  const rows = bookings.map((b) => {
    const attendees = attendeesByBooking.get(b.id) ?? [];
    const noteBlock = b.notes
      ? `<p class="mt-1.5 max-w-sm border-l-2 border-line pl-2.5 text-[0.8125rem] text-muted">${escapeHtml(
          b.notes,
        )}</p>`
      : "";

    let guestCell: string;
    if (b.seats_total > 1 && attendees.length > 0) {
      const primary = attendees.find((a) => a.guest_email === b.guest_email) ?? attendees[0]!;
      const others = attendees.length - 1;
      const confirmed = attendees.filter((a) => a.status === "confirmed");
      const checkedIn = confirmed.filter((a) => a.checked_in_at).length;
      const summary =
        escapeHtml(primary.guest_name) +
        (others > 0 ? ` +${others} more` : "") +
        ` · ${confirmed.length}/${b.seats_total} seats · ${checkedIn} in`;
      const attendeeRow = (a: BookingAttendeeRow) => {
        const checked = a.checked_in_at !== null;
        const control =
          a.status !== "confirmed"
            ? `<span class="ui-badge ui-badge-neutral shrink-0">Cancelled</span>`
            : `<form method="post"
                   action="/dashboard/bookings/${b.id}/attendees/${a.id}/check-in">
                <button type="submit" class="${
                  checked
                    ? "ui-badge ui-badge-success cursor-pointer hover:brightness-95"
                    : "ui-btn ui-btn-secondary ui-btn-sm"
                }" ${checked ? 'title="Click to undo check-in"' : ""}>
                  ${
                    checked
                      ? `${icon("check", "size-3.5")}<span>In</span>`
                      : `${icon("check", "size-4")}<span>Check in</span>`
                  }
                </button>
              </form>`;
        return `<li class="py-2">
            <div class="flex flex-wrap items-center justify-between gap-x-3 gap-y-1">
              <div class="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
                <span class="text-[0.8125rem] font-medium text-ink">${escapeHtml(a.guest_name)}</span>
                <span class="rounded border border-line bg-subtle px-1.5 py-0.5 font-mono text-[0.75rem] font-medium tracking-[0.06em] text-ink">${escapeHtml(
                  a.ticket_code ?? "—",
                )}</span>
                <span class="truncate text-[0.75rem] text-muted">${escapeHtml(a.guest_email)}</span>
              </div>
              ${control}
            </div>
            ${a === primary && b.notes ? noteBlock : ""}
          </li>`;
      };
      guestCell = `<details>
          <summary class="cursor-pointer text-[0.8125rem] font-medium text-body hover:text-ink">
            ${summary}
          </summary>
          <ul class="mt-1 divide-y divide-line">${attendees.map(attendeeRow).join("")}</ul>
        </details>`;
    } else {
      // Private booking (or a legacy group row without attendee records).
      guestCell = `<div class="font-medium text-ink">${escapeHtml(b.guest_name)}</div>
       <div class="text-[0.8125rem] text-muted">${escapeHtml(b.guest_email)}</div>
       ${b.seats_total > 1 ? `<p class="mt-1 text-[0.75rem] text-muted">Group — ${b.seats_taken} of ${b.seats_total} seats taken</p>` : ""}
       ${noteBlock}`;
    }

    const actionCell =
      b.status !== "confirmed"
        ? ""
        : b.seats_total > 1
          ? button({
              label: "Manage tickets",
              href: `/dashboard/event-types/${b.event_type_id}/tickets`,
              variant: "secondary",
              size: "sm",
            })
          : `<form method="post" action="/dashboard/bookings/${b.id}/cancel">
               ${button({ label: "Cancel", variant: "danger", size: "sm" })}
             </form>`;

    return [
      guestCell,
      `<span class="text-body">${escapeHtml(b.event_name)}</span>`,
      whenCell(b.start_at, user.timezone),
      statusBadge(b.status),
      actionCell,
    ];
  });

  const emptyCopy: Record<string, string> = {
    upcoming: "Nothing on the calendar yet. Share your booking link to get started.",
    past: "Completed meetings will be listed here.",
    cancelled: "Cancelled bookings are kept for your records — none so far.",
  };

  return layout({
    title: "Bookings",
    nav: "host",
    activeNav: "/dashboard/bookings",
    hostName: user.name,
    hostAvatarKey: user.avatar_key,
    hostSlug: user.slug,
    toast,
    body: `
      ${pageHeader({
        eyebrow: "Your calendar",
        title: "Bookings",
        subtitle: `Shown in ${zoneDisplay(user.timezone)}.`,
      })}

      <div class="mb-4 inline-flex rounded-lg border border-line bg-surface p-1 shadow-xs">
        ${tab("upcoming", "Upcoming")}${tab("past", "Past")}${tab("cancelled", "Cancelled")}
      </div>

      <section class="ui-card overflow-hidden">
        ${table({
          columns: [
            { label: "Guest" },
            { label: "Event type" },
            { label: "When" },
            { label: "Status" },
            { label: "", align: "right" },
          ],
          rowsHtml: rows,
          emptyHtml: emptyState({
            icon: "inbox",
            title: `No ${scope} bookings`,
            body: emptyCopy[scope] ?? "Nothing here.",
          }),
        })}
      </section>`,
  });
}

/* -------------------------------------------------------------------------- */

export interface CalendarSettings {
  configured: boolean;
  googleEmail: string | null;
}

export function settingsPage(
  user: PublicUser,
  error?: string,
  toast = "",
  calendar: CalendarSettings = { configured: false, googleEmail: null },
): string {
  return layout({
    title: "Settings",
    nav: "host",
    activeNav: "/dashboard/settings",
    hostName: user.name,
    hostAvatarKey: user.avatar_key,
    hostSlug: user.slug,
    toast,
    body: `
      ${pageHeader({
        eyebrow: "Account",
        title: "Settings",
        subtitle: "How you appear to guests, and the timezone your availability is in.",
      })}

      ${error ? `<div class="mb-4">${alert("danger", error)}</div>` : ""}

      <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <div class="space-y-4">
        <section class="ui-card ui-card-pad">
          <p class="ui-eyebrow mb-3">Profile photo</p>
          <div class="flex flex-wrap items-center gap-4">
            ${avatar(user.name, user.avatar_key, "size-16", "text-xl")}
            <div class="min-w-0 flex-1">
              <form method="post" action="/dashboard/settings/avatar"
                    enctype="multipart/form-data" class="flex flex-wrap items-center gap-2">
                <input class="ui-input max-w-[15rem] py-1.5 text-[0.8125rem]
                              file:mr-3 file:rounded file:border-0 file:bg-subtle
                              file:px-2 file:py-1 file:text-[0.8125rem] file:text-ink"
                       type="file" name="avatar" accept="image/png,image/jpeg,image/webp,image/gif"
                       aria-label="Choose a profile photo" required>
                ${button({ label: "Upload", variant: "secondary", size: "sm" })}
              </form>
              <p class="ui-hint">PNG, JPEG, WebP or GIF. Up to 2 MB.</p>
            </div>
            ${
              user.avatar_key
                ? `<form method="post" action="/dashboard/settings/avatar/remove">
                     ${button({ label: "Remove", variant: "ghost", size: "sm" })}
                   </form>`
                : ""
            }
          </div>
        </section>

        ${
          calendar.configured
            ? `<section class="ui-card ui-card-pad">
                <p class="ui-eyebrow mb-3">Calendar</p>
                <div class="flex flex-wrap items-center gap-4">
                  <div class="min-w-0 flex-1">
                    ${
                      calendar.googleEmail
                        ? `<p class="text-sm font-medium text-ink">Connected as
                             <span class="font-mono text-[0.8125rem]">${escapeHtml(calendar.googleEmail)}</span></p>
                           <p class="ui-hint">Slots overlapping Google Calendar events are hidden from your booking page.</p>`
                        : `<p class="ui-hint">Connect Google Calendar (read-only) to hide slots that overlap events already in your Google Calendar.</p>`
                    }
                  </div>
                  ${
                    calendar.googleEmail
                      ? `<form method="post" action="/dashboard/settings/calendar/disconnect">
                           ${button({ label: "Disconnect", variant: "ghost", size: "sm" })}
                         </form>`
                      : `<a class="ui-btn ui-btn-secondary ui-btn-sm" href="/oauth/google/authorize">
                           ${icon("calendar", "size-4")}<span>Connect Google Calendar</span>
                         </a>`
                  }
                </div>
              </section>`
            : ""
        }

        <form class="ui-card ui-card-pad space-y-4" method="post" action="/dashboard/settings">
          ${field({ name: "name", label: "Name", value: user.name })}
          ${field({
            name: "timezone",
            label: "Timezone",
            hint: "Availability and booking times are interpreted in this zone.",
            controlHtml: timezoneSelect({ name: "timezone", selected: user.timezone }),
          })}
          <div class="flex justify-end border-t border-line pt-4">
            ${button({ label: "Save changes", variant: "primary", icon: "check" })}
          </div>
        </form>
        </div>

        <aside class="ui-card ui-card-pad h-fit">
          <p class="ui-eyebrow mb-2">Public page</p>
          <p class="font-mono text-[0.8125rem] break-all text-ink">/${escapeHtml(user.slug)}</p>
          <p class="mt-2 text-[0.8125rem] text-muted">
            Your username is permanent for now — existing booking links depend on it.
          </p>
          <div class="mt-4">
            <a class="ui-btn ui-btn-secondary ui-btn-sm" href="/${escapeHtml(user.slug)}"
               target="_blank" rel="noopener">
              ${icon("external", "size-4")}<span>Open</span>
            </a>
          </div>
        </aside>
      </div>
      ${TIMEZONE_SCRIPT}`,
  });
}
