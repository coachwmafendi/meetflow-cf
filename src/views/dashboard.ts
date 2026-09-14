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
 * Copies the URL in a `data-copy` attribute when its button is clicked, then
 * swaps the button content for a "Copied" state. Delegated: works for any
 * button rendered anywhere on the page. Clipboard API with an execCommand
 * fallback for older browsers.
 */
const COPY_LINK_SCRIPT = `
  <script>
    (function () {
      document.addEventListener("click", function (event) {
        var btn = event.target.closest("[data-copy]");
        if (!btn) return;
        var url = new URL(btn.getAttribute("data-copy"), window.location.origin).href;

        function done() {
          var original = btn.innerHTML;
          btn.innerHTML = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="size-4"><path d="m4.5 12.5 5 5 10-11"/></svg><span>Copied</span>';
          window.setTimeout(function () { btn.innerHTML = original; }, 1600);
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
    toast,
    body: `
      ${pageHeader({
        eyebrow: "Overview",
        title: `Good day, ${firstName}`,
        subtitle: `Your booking page is live at /${user.slug}`,
        actionsHtml: button({
          label: "View public page",
          href: `/${user.slug}`,
          icon: "globe",
          size: "sm",
        }),
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
            actionHtml: button({
              label: "Open public page",
              href: `/${user.slug}`,
              variant: "secondary",
              size: "sm",
              icon: "globe",
            }),
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
        <div class="flex shrink-0 items-center gap-2">
          <a class="ui-btn ui-btn-ghost ui-btn-sm" href="${escapeHtml(path)}"
             target="_blank" rel="noopener">
            ${icon("external", "size-4")}<span>Open</span>
          </a>
          <button type="button" class="ui-btn ui-btn-ghost ui-btn-sm"
                  data-copy="${escapeHtml(path)}" aria-label="Copy link">
            ${icon("copy", "size-4")}<span>Copy link</span>
          </button>
          ${button({
            label: "Edit",
            href: `/dashboard/event-types/${e.id}`,
            variant: "secondary",
            size: "sm",
          })}
        </div>
      </article>`;
    })
    .join("");

  const list = eventTypes.length
    ? `<div class="mb-8 grid gap-3">${cards}</div>`
    : `<div class="ui-card mb-8">${emptyState({
        icon: "layers",
        title: "No event types yet",
        body: "An event type is a meeting people can book — a name, a length, and a URL.",
      })}</div>`;

  return layout({
    title: "Event Types",
    nav: "host",
    activeNav: "/dashboard/event-types",
    hostName: user.name,
    hostAvatarKey: user.avatar_key,
    toast,
    body: `
      ${pageHeader({
        eyebrow: "Bookable meetings",
        title: "Event types",
        subtitle: "Each one gets its own public booking link.",
      })}

      ${list}

      <section class="ui-card ui-card-pad">
        <h2 class="mb-4 text-sm font-semibold text-ink">Create an event type</h2>
        <form class="grid gap-4 sm:grid-cols-2" method="post" action="/dashboard/event-types">
          ${field({ name: "name", label: "Name", placeholder: "Consultation" })}
          ${field({
            name: "slug",
            label: "URL slug",
            placeholder: "consultation",
            hint: `Public link: /${user.slug}/…`,
          })}
          ${field({
            name: "duration_minutes",
            label: "Duration",
            type: "number",
            value: "30",
            hint: "Minutes. Slots are generated on this interval.",
            attrsHtml: 'min="5" max="480" step="5"',
          })}
          ${field({
            name: "description",
            label: "Description",
            required: false,
            placeholder: "A 30-minute intro call",
          })}
          <div class="sm:col-span-2">
            ${button({ label: "Create event type", variant: "primary", icon: "plus" })}
          </div>
        </form>
      </section>
      ${COPY_LINK_SCRIPT}`,
  });
}

/* -------------------------------------------------------------------------- */

export function eventTypeEditPage(
  user: PublicUser,
  eventType: EventTypeRow,
  bookingCount: number,
  error?: string,
  toast = "",
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
            name: "description",
            label: "Description",
            required: false,
            value: eventType.description ?? "",
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

export function settingsPage(user: PublicUser, error?: string, toast = ""): string {
  return layout({
    title: "Settings",
    nav: "host",
    activeNav: "/dashboard/settings",
    hostName: user.name,
    hostAvatarKey: user.avatar_key,
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
