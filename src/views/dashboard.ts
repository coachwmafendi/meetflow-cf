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
import type { AvailabilityRuleRow, EventTypeRow, PublicUser } from "../types";
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
          "<\/script>",
          "<!-- MeetFlow element-click embed code ends -->",
          "",
          "<!-- Add data-meetflow-link to any element; clicking it opens the popup. -->",
          '<button data-meetflow-link="' + link + '">Book now</button>',
        ].join("\n");
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

      window.createEventTypeForm = function () {
        return {
          name: '',
          slug: '',
          duration: 30,
          buffer: 0,
          description: '',
          locationType: 'none',
          locationValue: '',
          savedLink: '__new__',
          savedLinks: [],
          error: '',
          submitting: false,

          loadSaved() {
            this.savedLinks = [];
            this.savedLink = '__new__';
            if (this.locationType !== 'google_meet' && this.locationType !== 'zoom') return;
            var self = this;
            fetch('/api/event-types/locations?type=' + this.locationType)
              .then(function (res) { return res.ok ? res.json() : { locations: [] }; })
              .then(function (body) {
                self.savedLinks = body.locations || [];
                if (self.savedLinks.length) self.savedLink = self.savedLinks[0];
              })
              .catch(function () {});
          },

          locationLabel() {
            var labels = {
              google_meet: 'Meeting link',
              zoom: 'Meeting link',
              in_person: 'Address',
              phone: 'Phone number',
            };
            return labels[this.locationType] || 'Location';
          },

          locationPlaceholder() {
            var placeholders = {
              google_meet: 'https://meet.google.com/…',
              zoom: 'https://zoom.us/j/…',
              in_person: 'Office address',
              phone: '+60 …',
            };
            return placeholders[this.locationType] || '';
          },

          locationValueToSend() {
            if (this.locationType === 'google_meet' || this.locationType === 'zoom') {
              return this.savedLink === '__new__' ? this.locationValue.trim() : this.savedLink;
            }
            return this.locationValue.trim();
          },

          async submit() {
            this.submitting = true;
            this.error = '';
            try {
              var res = await fetch('/api/event-types', {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({
                  name: this.name.trim(),
                  slug: this.slug.trim().toLowerCase(),
                  duration_minutes: Number(this.duration),
                  buffer_minutes: Number(this.buffer),
                  description: this.description.trim() || null,
                  location_type: this.locationType,
                  location_value: this.locationValueToSend() || null,
                }),
              });
              if (res.status === 201) {
                window.location.href = '/dashboard/event-types?toast=' +
                  encodeURIComponent('Event type created');
                return;
              }
              var body = await res.json().catch(function () { return {}; });
              this.error = body.error || 'Could not create the event type.';
              this.submitting = false;
            } catch (e) {
              this.error = 'Could not create the event type. Please try again.';
              this.submitting = false;
            }
          },
        };
      };

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
          if (popupCode) popupCode.value = popupSnippet(url, path.replace(/^\//, ""));
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
  const rows = recent.map((b) => [
    `<div class="font-medium text-ink">${escapeHtml(b.guest_name)}</div>
     <div class="text-[0.8125rem] text-muted">${escapeHtml(b.guest_email)}</div>`,
    `<span class="text-body">${escapeHtml(b.event_name)}</span>`,
    whenCell(b.start_at, user.timezone),
  ]);

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
          columns: [{ label: "Guest" }, { label: "Event type" }, { label: "When" }],
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
               :class="open ? 'z-30' : ''" x-data="{ open: false }" @click.outside="open = false"
               x-show="matches(items[${i}])"
               style="animation-delay:${Math.min(i, 8) * 32}ms">
        <div class="min-w-0">
          <div class="flex flex-wrap items-center gap-2">
            <h3 class="truncate text-sm font-semibold text-ink">${escapeHtml(e.name)}</h3>
            ${e.is_active ? "" : badge("neutral", "Inactive", false)}
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
          <form method="post" action="/dashboard/event-types/${e.id}/toggle" class="shrink-0">
            <button type="submit" class="ui-switch" role="switch"
                    aria-checked="${e.is_active ? "true" : "false"}"
                    aria-label="${e.is_active ? "Deactivate" : "Activate"} ${escapeHtml(e.name)}"
                    title="${e.is_active ? "Deactivate — hide from your public page" : "Activate — publish to your public page"}">
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
        actionHtml: `<button type="button" class="ui-btn ui-btn-primary ui-btn-sm"
                             data-dialog-open="create-event-type">
          ${icon("plus", "size-4")}<span>New event type</span>
        </button>`,
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
        actionsHtml: `<button type="button" class="ui-btn ui-btn-primary ui-btn-sm"
                              data-dialog-open="create-event-type">
          ${icon("plus", "size-4")}<span>New event type</span>
        </button>`,
      })}

      ${list}

      <dialog id="create-event-type" class="ui-dialog" aria-labelledby="create-event-type-title">
        <div class="ui-dialog-body" x-data="createEventTypeForm()">
          <div class="flex items-center justify-between gap-4">
            <h3 id="create-event-type-title" class="text-sm font-semibold text-ink">
              Create event type
            </h3>
            <button type="button" class="ui-btn ui-btn-ghost ui-btn-sm px-2"
                    data-dialog-close aria-label="Close">
              ${icon("x", "size-4")}
            </button>
          </div>

          <template x-if="error">
            <div class="ui-alert ui-alert-danger mt-3" role="alert">
              ${icon("alert", "size-4 shrink-0 mt-px")}<span x-text="error"></span>
            </div>
          </template>

          <form class="mt-4 space-y-4" @submit.prevent="submit()">
            <div class="ui-fieldset">
              <label class="ui-label" for="et_name">Name</label>
              <input class="ui-input" id="et_name" x-model="name" placeholder="Consultation" required>
            </div>
            <div class="ui-fieldset">
              <label class="ui-label" for="et_slug">URL slug</label>
              <input class="ui-input font-mono" id="et_slug" x-model="slug" placeholder="consultation"
                     pattern="[a-z0-9]([a-z0-9-]{0,58}[a-z0-9])?" required>
              <p class="ui-hint">Public link: /${escapeHtml(user.slug)}/…</p>
            </div>
            <div class="ui-fieldset">
              <label class="ui-label" for="et_duration">Duration</label>
              <input class="ui-input font-mono" id="et_duration" type="number" x-model="duration"
                     min="5" max="480" step="5" required>
              <p class="ui-hint">Minutes. Slots are generated on this interval.</p>
            </div>
            <div class="ui-fieldset">
              <label class="ui-label" for="et_buffer">Buffer after meeting</label>
              <input class="ui-input font-mono" id="et_buffer" type="number" x-model="buffer"
                     min="0" max="120" step="5">
              <p class="ui-hint">Minutes of breathing room after each booking. 0 = back-to-back.</p>
            </div>
            <div class="ui-fieldset">
              <label class="ui-label" for="et_description">
                Description <span class="font-normal text-muted">(optional)</span>
              </label>
              <textarea class="ui-input resize-y" id="et_description" rows="3" x-model="description"
                        placeholder="A 30-minute intro call"></textarea>
            </div>
            <div class="ui-fieldset">
              <label class="ui-label" for="et_location_type">Location</label>
              <select class="ui-select" id="et_location_type" x-model="locationType" @change="loadSaved()">
                <option value="none">No location</option>
                <option value="google_meet">Google Meet</option>
                <option value="zoom">Zoom</option>
                <option value="in_person">In person</option>
                <option value="phone">Phone</option>
              </select>
            </div>
            <div class="ui-fieldset" x-show="locationType !== 'none'">
              <template x-if="locationType === 'google_meet' || locationType === 'zoom'">
                <div>
                  <label class="ui-label" for="et_location_value">Meeting link</label>
                  <select class="ui-select" id="et_location_value" x-model="savedLink" required>
                    <option value="__new__">Use a new link…</option>
                    <template x-for="link in savedLinks" :key="link">
                      <option :value="link" x-text="link"></option>
                    </template>
                  </select>
                  <input class="ui-input mt-2" x-show="savedLink === '__new__'" x-model="locationValue"
                         :required="savedLink === '__new__'"
                         placeholder="https://meet.google.com/…" id="et_new_link">
                </div>
              </template>
              <template x-if="locationType === 'in_person' || locationType === 'phone'">
                <div>
                  <label class="ui-label" for="et_location_value_alt" x-text="locationLabel()"></label>
                  <input class="ui-input" id="et_location_value_alt" x-model="locationValue"
                         :placeholder="locationPlaceholder()" required>
                </div>
              </template>
            </div>
            <div class="flex justify-end gap-2 pt-1">
              <button type="button" class="ui-btn ui-btn-ghost ui-btn-sm" data-dialog-close>Cancel</button>
              <button class="ui-btn ui-btn-primary ui-btn-sm" type="submit" :disabled="submitting">
                <span x-text="submitting ? 'Creating…' : 'Create'"></span>
              </button>
            </div>
          </form>
        </div>
      </dialog>
      ${EMBED_SCRIPT}`,
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
        actionsHtml: `${
          active ? badge("success", "Active") : badge("neutral", "Inactive", false)
        }${button({ label: "Preview", href: path, variant: "secondary", size: "sm", icon: "link" })}`,
      })}

      ${error ? `<div class="mb-4">${alert("danger", error)}</div>` : ""}

      <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
        <form class="ui-card ui-card-pad space-y-4" method="post"
              action="/dashboard/event-types/${eventType.id}">
          ${field({ name: "name", label: "Name", value: eventType.name })}
          ${field({
            name: "slug",
            label: "URL slug",
            value: eventType.slug,
            hint: `Changing this breaks any link already shared as ${path}.`,
          })}
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
      </div>`,
  });
}

/* -------------------------------------------------------------------------- */

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

  const rows = bookings.map((b) => [
    `<div class="font-medium text-ink">${escapeHtml(b.guest_name)}</div>
     <div class="text-[0.8125rem] text-muted">${escapeHtml(b.guest_email)}</div>
     ${
       b.notes
         ? `<p class="mt-1.5 max-w-sm border-l-2 border-line pl-2.5 text-[0.8125rem] text-muted">${escapeHtml(
             b.notes,
           )}</p>`
         : ""
     }`,
    `<span class="text-body">${escapeHtml(b.event_name)}</span>`,
    whenCell(b.start_at, user.timezone),
    statusBadge(b.status),
    b.status === "confirmed"
      ? `<form method="post" action="/dashboard/bookings/${b.id}/cancel">
           ${button({ label: "Cancel", variant: "danger", size: "sm" })}
         </form>`
      : "",
  ]);

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
