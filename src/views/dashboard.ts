import { escapeHtml, layout } from "./layout";
import { TIMEZONE_SCRIPT, timezoneSelect } from "./timezoneSelect";
import { badge, button, emptyState, field, icon, pageHeader, statTile, table, time } from "./ui";
import type { BookingWithEvent, DashboardStats } from "../db/bookings";
import type { AvailabilityRuleRow, EventTypeRow, PublicUser } from "../types";
import { utcToZonedParts } from "../lib/timezone";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const pad = (n: number) => String(n).padStart(2, "0");

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

export function eventTypesPage(user: PublicUser, eventTypes: EventTypeRow[]): string {
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
          ${button({ label: "Preview", href: path, variant: "secondary", size: "sm", icon: "link" })}
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
      </section>`,
  });
}

/* -------------------------------------------------------------------------- */

export function availabilityPage(user: PublicUser, rules: AvailabilityRuleRow[]): string {
  const rows = DAY_NAMES.map((day, index) => {
    const dayRules = rules.filter((r) => r.day_of_week === index);
    const active = dayRules.length > 0;

    const slotRow = (start: string, end: string) => `
      <div class="flex items-center gap-2">
        <input class="ui-input w-[9.5rem] font-mono" type="time" name="start_${index}"
               value="${start}" aria-label="${day} start time">
        <span class="text-muted" aria-hidden="true">–</span>
        <input class="ui-input w-[9.5rem] font-mono" type="time" name="end_${index}"
               value="${end}" aria-label="${day} end time">
      </div>`;

    const inputs =
      dayRules.map((r) => slotRow(r.start_time, r.end_time)).join("") + slotRow("", "");

    return `<div class="flex flex-col gap-3 px-5 py-4 sm:flex-row sm:items-start sm:gap-6">
      <div class="flex w-32 shrink-0 items-center gap-2 pt-2">
        <span class="size-1.5 rounded-full ${active ? "bg-success" : "bg-line-strong"}"></span>
        <span class="text-sm font-medium ${active ? "text-ink" : "text-muted"}">${day}</span>
      </div>
      <div class="flex flex-wrap gap-3">${inputs}</div>
    </div>`;
  }).join("");

  return layout({
    title: "Availability",
    nav: "host",
    activeNav: "/dashboard/availability",
    hostName: user.name,
    body: `
      ${pageHeader({
        eyebrow: "Weekly schedule",
        title: "Availability",
        subtitle: `Times are in ${user.timezone}. Leave a day blank to be unavailable.`,
      })}

      <form method="post" action="/dashboard/availability">
        <div class="ui-card ui-divide overflow-hidden">${rows}</div>
        <div class="mt-4 flex justify-end">
          ${button({ label: "Save availability", variant: "primary", icon: "check" })}
        </div>
      </form>`,
  });
}

/* -------------------------------------------------------------------------- */

export function bookingsPage(
  user: PublicUser,
  bookings: BookingWithEvent[],
  scope: string,
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
    body: `
      ${pageHeader({
        eyebrow: "Your calendar",
        title: "Bookings",
        subtitle: `Shown in ${user.timezone}.`,
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

export function settingsPage(user: PublicUser): string {
  return layout({
    title: "Settings",
    nav: "host",
    activeNav: "/dashboard/settings",
    hostName: user.name,
    body: `
      ${pageHeader({
        eyebrow: "Account",
        title: "Settings",
        subtitle: "How you appear to guests, and the timezone your availability is in.",
      })}

      <div class="grid gap-4 lg:grid-cols-[minmax(0,1fr)_18rem]">
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

        <aside class="ui-card ui-card-pad h-fit">
          <p class="ui-eyebrow mb-2">Public page</p>
          <p class="font-mono text-[0.8125rem] break-all text-ink">/${escapeHtml(user.slug)}</p>
          <p class="mt-2 text-[0.8125rem] text-muted">
            Your username is permanent for now — existing booking links depend on it.
          </p>
          <div class="mt-4">
            ${button({
              label: "Open",
              href: `/${user.slug}`,
              variant: "secondary",
              size: "sm",
              icon: "globe",
            })}
          </div>
        </aside>
      </div>
      ${TIMEZONE_SCRIPT}`,
  });
}
