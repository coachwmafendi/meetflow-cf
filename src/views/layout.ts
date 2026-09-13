import { escapeHtml } from "./escape";

export { escapeHtml } from "./escape";
import { avatar, icon } from "./ui";

export interface LayoutOptions {
  title: string;
  body: string;
  /** Rendered inside a <script type="application/json" id="page-data"> tag. */
  data?: unknown;
  nav?: "host" | "public" | "none";
  activeNav?: string;
  hostName?: string;
  /** R2 object key for the host's avatar, shown in the sidebar. */
  hostAvatarKey?: string | null;
  /** Constrains <main>. Auth and booking screens are narrower than the dashboard. */
  width?: "sm" | "md" | "lg";
}

/**
 * Applies the saved theme before first paint. Must stay inline and synchronous
 * in <head>: deferring it means a flash of the wrong theme on every load.
 * With nothing saved the OS preference wins, which is what guests get.
 */
const THEME_BOOTSTRAP = `<script>
  (function () {
    try {
      var saved = localStorage.getItem("mf-theme");
      if (saved === "dark" || saved === "light") {
        document.documentElement.setAttribute("data-theme", saved);
      }
    } catch (e) {}
  })();
</script>`;

/** Cycles light → dark → follow-the-OS. Hosts only; guests follow their OS. */
const THEME_TOGGLE_SCRIPT = `<script>
  (function () {
    var btn = document.getElementById("theme-toggle");
    if (!btn) return;
    var root = document.documentElement;

    function label() {
      var mode = root.getAttribute("data-theme") || "system";
      btn.setAttribute("aria-label", "Theme: " + mode + ". Click to change.");
      btn.setAttribute("title", "Theme: " + mode);
      btn.dataset.mode = mode;
    }

    label();
    btn.addEventListener("click", function () {
      var current = root.getAttribute("data-theme") || "system";
      var next = current === "system" ? "dark" : current === "dark" ? "light" : "system";
      if (next === "system") {
        root.removeAttribute("data-theme");
        try { localStorage.removeItem("mf-theme"); } catch (e) {}
      } else {
        root.setAttribute("data-theme", next);
        try { localStorage.setItem("mf-theme", next); } catch (e) {}
      }
      label();
    });
  })();
</script>`;

function themeToggle(): string {
  return `<button id="theme-toggle" type="button" class="ui-btn ui-btn-ghost ui-btn-sm px-2"
            aria-label="Change theme">
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
           class="size-4 hidden [[data-theme=light]_&]:block">
        <circle cx="12" cy="12" r="4.5"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>
      </svg>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
           class="size-4 hidden [[data-theme=dark]_&]:block">
        <path d="M20 14.5A8.5 8.5 0 0 1 9.5 4a8.5 8.5 0 1 0 10.5 10.5Z"/>
      </svg>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"
           stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"
           class="size-4 [[data-theme=dark]_&]:hidden [[data-theme=light]_&]:hidden">
        <rect x="2.5" y="4.5" width="19" height="14" rx="3"/><path d="M8 21h8M12 18.5V21"/>
      </svg>
    </button>`;
}

const HOST_NAV = [
  { href: "/dashboard", label: "Dashboard", icon: "grid" },
  { href: "/dashboard/event-types", label: "Event Types", icon: "layers" },
  { href: "/dashboard/availability", label: "Availability", icon: "clock" },
  { href: "/dashboard/bookings", label: "Bookings", icon: "calendar" },
  { href: "/dashboard/settings", label: "Settings", icon: "settings" },
] as const;

const WIDTHS = { sm: "max-w-md", md: "max-w-3xl", lg: "max-w-5xl" } as const;

/** The mark. A calendar grid where one cell is filled — the booked slot. */
function wordmark(href: string): string {
  return `<a href="${href}" class="group flex items-center gap-2 text-ink" aria-label="MeetFlow home">
      <span class="flex size-6 items-center justify-center rounded-md bg-primary text-on-primary
                   transition-transform duration-200 group-hover:-rotate-6">
        <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" class="size-3.5">
          <rect x="3" y="5" width="18" height="16" rx="4" stroke="currentColor" stroke-width="2"/>
          <path d="M8 3v4M16 3v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
          <rect x="7" y="12" width="5" height="4" rx="1.2" fill="currentColor"/>
        </svg>
      </span>
      <span class="text-[0.9375rem] font-semibold tracking-[-0.02em]">MeetFlow</span>
    </a>`;
}

function hostLayout(options: LayoutOptions, dataScript: string): string {
  const links = HOST_NAV.map((item) => {
    const active = options.activeNav === item.href;
    return `<a href="${item.href}" @click="drawer = false"
        class="ui-side-link ${active ? "ui-side-link-active" : ""}"${
          active ? ' aria-current="page"' : ""
        }>
      ${icon(item.icon, "size-[18px] shrink-0")}
      <span class="truncate">${item.label}</span>
    </a>`;
  }).join("");

  return `<!doctype html>
<html lang="en" class="h-full">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  ${THEME_BOOTSTRAP}
  <title>${escapeHtml(options.title)} · MeetFlow</title>
  <link rel="preload" href="/fonts/geist-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/app.css">
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' rx='6' fill='%23222'/%3E%3Crect x='7' y='11' width='6' height='5' rx='1.5' fill='white'/%3E%3C/svg%3E">
  <script defer src="/vendor/alpine.min.js"></script>
</head>
<body class="min-h-full bg-canvas text-body antialiased">
  <div class="flex min-h-screen" x-data="{ drawer: false }">

    <header class="fixed inset-x-0 top-0 z-30 flex h-14 items-center justify-between border-b border-line bg-surface/85 px-4 backdrop-blur-md lg:hidden">
      ${wordmark("/dashboard")}
      <button type="button" class="ui-btn ui-btn-ghost ui-btn-sm px-2"
              @click="drawer = true" aria-label="Open menu" aria-controls="app-sidebar">
        ${icon("menu", "size-5")}
      </button>
    </header>

    <div x-show="drawer" x-cloak class="fixed inset-0 z-40 bg-ink/40 lg:hidden"
         @click="drawer = false" aria-hidden="true"></div>

    <aside id="app-sidebar" class="app-sidebar" :class="drawer ? 'drawer-open' : ''">
      <div class="flex h-14 shrink-0 items-center border-b border-line px-4">
        ${wordmark("/dashboard")}
      </div>

      <nav class="flex-1 space-y-0.5 overflow-y-auto p-3" aria-label="Main">${links}</nav>

      <div class="shrink-0 space-y-3 border-t border-line p-3">
        <div class="flex items-center gap-2.5 px-1">
          ${avatar(options.hostName ?? "You", options.hostAvatarKey ?? null, "size-8", "text-xs")}
          <span class="min-w-0 truncate text-sm font-medium text-ink">${escapeHtml(
            options.hostName ?? "",
          )}</span>
        </div>
        <div class="flex items-center justify-between gap-1">
          ${themeToggle()}
          <form method="post" action="/logout">
            <button class="ui-btn ui-btn-ghost ui-btn-sm" type="submit">
              ${icon("logOut", "size-4")}
              <span>Sign out</span>
            </button>
          </form>
        </div>
      </div>
    </aside>

    <div class="min-w-0 flex-1">
      <main class="mx-auto w-full max-w-5xl px-5 pb-10 pt-20 sm:px-6 lg:pt-10">${options.body}</main>
    </div>
  </div>
  ${dataScript}
  ${THEME_TOGGLE_SCRIPT}
</body>
</html>`;
}

function publicHeader(): string {
  return `<header class="border-b border-line bg-surface/85 backdrop-blur-md">
      <div class="mx-auto flex h-14 max-w-3xl items-center px-5 sm:px-6">${wordmark("/")}</div>
    </header>`;
}

export function layout(options: LayoutOptions): string {
  const dataScript = options.data
    ? `<script type="application/json" id="page-data">${JSON.stringify(options.data).replace(
        /</g,
        "\\u003c",
      )}</script>`
    : "";

  if (options.nav === "host") return hostLayout(options, dataScript);

  const header = options.nav === "public" ? publicHeader() : "";

  return `<!doctype html>
<html lang="en" class="h-full">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <meta name="color-scheme" content="light dark">
  ${THEME_BOOTSTRAP}
  <title>${escapeHtml(options.title)} · MeetFlow</title>
  <link rel="preload" href="/fonts/geist-latin-wght-normal.woff2" as="font" type="font/woff2" crossorigin>
  <link rel="stylesheet" href="/app.css">
  <link rel="icon" href="data:image/svg+xml,%3Csvg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 24 24'%3E%3Crect width='24' height='24' rx='6' fill='%23222'/%3E%3Crect x='7' y='11' width='6' height='5' rx='1.5' fill='white'/%3E%3C/svg%3E">
  <script defer src="/vendor/alpine.min.js"></script>
</head>
<body class="flex min-h-full flex-col bg-canvas text-body antialiased">
  ${header}
  <main class="mx-auto w-full ${
    WIDTHS[options.width ?? "lg"]
  } flex-1 px-5 py-8 sm:px-6 sm:py-10">${options.body}</main>
  ${dataScript}
</body>
</html>`;
}
