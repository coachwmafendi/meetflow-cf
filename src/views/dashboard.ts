import { escapeHtml, layout } from "./layout";
import type { BookingWithEvent, DashboardStats } from "../db/bookings";
import type { AvailabilityRuleRow, EventTypeRow, PublicUser } from "../types";
import { utcToZonedParts } from "../lib/timezone";

const DAY_NAMES = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];

function fmt(iso: string, timeZone: string): string {
  const p = utcToZonedParts(new Date(iso), timeZone);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${p.year}-${pad(p.month)}-${pad(p.day)} ${pad(p.hour)}:${pad(p.minute)}`;
}

function statCard(label: string, value: string | number): string {
  return `<div class="mf-card">
    <p class="text-sm text-muted">${label}</p>
    <p class="mt-1 text-3xl font-semibold tracking-tight">${value}</p>
  </div>`;
}

export function dashboardPage(
  user: PublicUser,
  stats: DashboardStats,
  recent: BookingWithEvent[],
): string {
  const rows = recent.length
    ? recent
        .map(
          (b) => `<tr class="border-t border-line">
            <td class="py-3 pr-4">${escapeHtml(b.guest_name)}</td>
            <td class="py-3 pr-4 text-muted">${escapeHtml(b.event_name)}</td>
            <td class="py-3 text-right tabular-nums">${fmt(b.start_at, user.timezone)}</td>
          </tr>`,
        )
        .join("")
    : `<tr><td colspan="3" class="py-6 text-center text-sm text-muted">No bookings yet.</td></tr>`;

  return layout({
    title: "Dashboard",
    nav: "host",
    activeNav: "/dashboard",
    hostName: user.name,
    body: `
      <h1 class="mb-6 text-2xl font-semibold tracking-tight">Good day, ${escapeHtml(user.name)}</h1>
      <div class="mb-8 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        ${statCard("Upcoming", stats.upcoming)}
        ${statCard("Today", stats.today)}
        ${statCard("Total bookings", stats.total)}
        ${statCard("Active event types", stats.activeEventTypes)}
      </div>
      <div class="mf-card">
        <h2 class="mb-4 text-lg font-medium">Recent bookings</h2>
        <table class="w-full text-sm"><tbody>${rows}</tbody></table>
      </div>`,
  });
}

export function eventTypesPage(user: PublicUser, eventTypes: EventTypeRow[]): string {
  const cards = eventTypes.length
    ? eventTypes
        .map((e) => {
          const path = `/${escapeHtml(user.slug)}/${escapeHtml(e.slug)}`;
          return `<div class="mf-card flex items-start justify-between gap-4">
            <div>
              <p class="font-medium">${escapeHtml(e.name)}</p>
              <p class="text-sm text-muted">${e.duration_minutes} min${
                e.is_active ? "" : " · inactive"
              }</p>
              <p class="mt-2 text-sm"><code class="rounded bg-neutral-100 px-1.5 py-0.5">${path}</code></p>
            </div>
            <div class="flex shrink-0 gap-2">
              <a class="mf-btn-ghost" href="${path}">Open</a>
            </div>
          </div>`;
        })
        .join("")
    : `<div class="mf-card text-sm text-muted">No event types yet. Create your first one below.</div>`;

  return layout({
    title: "Event Types",
    nav: "host",
    activeNav: "/dashboard/event-types",
    hostName: user.name,
    body: `
      <h1 class="mb-6 text-2xl font-semibold tracking-tight">Event types</h1>
      <div class="mb-8 grid gap-4">${cards}</div>
      <form class="mf-card grid gap-4 sm:grid-cols-2" method="post" action="/dashboard/event-types">
        <div><label class="mf-label" for="name">Name</label>
          <input class="mf-input" id="name" name="name" required></div>
        <div><label class="mf-label" for="slug">URL slug</label>
          <input class="mf-input" id="slug" name="slug" required></div>
        <div><label class="mf-label" for="duration_minutes">Duration (minutes)</label>
          <input class="mf-input" id="duration_minutes" name="duration_minutes" type="number"
                 min="5" max="480" value="30" required></div>
        <div><label class="mf-label" for="description">Description</label>
          <input class="mf-input" id="description" name="description"></div>
        <div class="sm:col-span-2"><button class="mf-btn" type="submit">Create event type</button></div>
      </form>`,
  });
}

export function availabilityPage(user: PublicUser, rules: AvailabilityRuleRow[]): string {
  const rows = DAY_NAMES.map((day, index) => {
    const dayRules = rules.filter((r) => r.day_of_week === index);
    const shown = dayRules.length ? dayRules : [{ start_time: "", end_time: "" }];
    const inputs = shown
      .map(
        (r) => `<div class="flex items-center gap-2">
          <input class="mf-input w-32" type="time" name="start_${index}" value="${r.start_time}">
          <span class="text-muted">–</span>
          <input class="mf-input w-32" type="time" name="end_${index}" value="${r.end_time}">
        </div>`,
      )
      .join("");
    // Always offer one spare row so a second window can be added without JS.
    const spare = `<div class="flex items-center gap-2">
        <input class="mf-input w-32" type="time" name="start_${index}" value="">
        <span class="text-muted">–</span>
        <input class="mf-input w-32" type="time" name="end_${index}" value="">
      </div>`;
    return `<div class="flex flex-col gap-2 border-t border-line py-4 sm:flex-row sm:items-center">
      <p class="w-32 shrink-0 text-sm font-medium">${day}</p>
      <div class="flex flex-wrap gap-3">${inputs}${spare}</div>
    </div>`;
  }).join("");

  return layout({
    title: "Availability",
    nav: "host",
    activeNav: "/dashboard/availability",
    hostName: user.name,
    body: `
      <h1 class="mb-2 text-2xl font-semibold tracking-tight">Weekly availability</h1>
      <p class="mb-6 text-sm text-muted">Times are in ${escapeHtml(
        user.timezone,
      )}. Leave a day blank to be unavailable.</p>
      <form class="mf-card" method="post" action="/dashboard/availability">
        ${rows}
        <div class="pt-4"><button class="mf-btn" type="submit">Save availability</button></div>
      </form>`,
  });
}

export function bookingsPage(
  user: PublicUser,
  bookings: BookingWithEvent[],
  scope: string,
): string {
  const tab = (value: string, label: string) =>
    `<a href="/dashboard/bookings?scope=${value}" class="rounded-lg px-3 py-2 text-sm ${
      scope === value ? "bg-neutral-100 font-medium" : "text-muted hover:bg-neutral-50"
    }">${label}</a>`;

  const rows = bookings.length
    ? bookings
        .map(
          (b) => `<tr class="border-t border-line align-top">
            <td class="py-3 pr-4">
              <p class="font-medium">${escapeHtml(b.guest_name)}</p>
              <p class="text-sm text-muted">${escapeHtml(b.guest_email)}</p>
              ${b.notes ? `<p class="mt-1 text-sm text-muted">${escapeHtml(b.notes)}</p>` : ""}
            </td>
            <td class="py-3 pr-4 text-sm">${escapeHtml(b.event_name)}</td>
            <td class="py-3 pr-4 text-sm tabular-nums">${fmt(b.start_at, user.timezone)}</td>
            <td class="py-3 text-right">
              ${
                b.status === "confirmed"
                  ? `<form method="post" action="/dashboard/bookings/${b.id}/cancel">
                       <button class="mf-btn-ghost" type="submit">Cancel</button>
                     </form>`
                  : `<span class="text-sm text-muted">${escapeHtml(b.status)}</span>`
              }
            </td>
          </tr>`,
        )
        .join("")
    : `<tr><td colspan="4" class="py-6 text-center text-sm text-muted">Nothing here.</td></tr>`;

  return layout({
    title: "Bookings",
    nav: "host",
    activeNav: "/dashboard/bookings",
    hostName: user.name,
    body: `
      <h1 class="mb-4 text-2xl font-semibold tracking-tight">Bookings</h1>
      <div class="mb-4 flex gap-1">${tab("upcoming", "Upcoming")}${tab("past", "Past")}${tab(
        "cancelled",
        "Cancelled",
      )}</div>
      <div class="mf-card"><table class="w-full text-sm"><tbody>${rows}</tbody></table></div>`,
  });
}

export function settingsPage(user: PublicUser): string {
  return layout({
    title: "Settings",
    nav: "host",
    activeNav: "/dashboard/settings",
    hostName: user.name,
    body: `
      <h1 class="mb-6 text-2xl font-semibold tracking-tight">Settings</h1>
      <form class="mf-card grid max-w-md gap-4" method="post" action="/dashboard/settings">
        <div><label class="mf-label" for="name">Name</label>
          <input class="mf-input" id="name" name="name" value="${escapeHtml(
            user.name,
          )}" required></div>
        <div><label class="mf-label" for="timezone">Timezone</label>
          <input class="mf-input" id="timezone" name="timezone" value="${escapeHtml(
            user.timezone,
          )}" required></div>
        <div><p class="mf-label">Public page</p>
          <p class="text-sm text-muted">/${escapeHtml(user.slug)}</p></div>
        <div><button class="mf-btn" type="submit">Save</button></div>
      </form>`,
  });
}
