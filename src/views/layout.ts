import { escapeHtml } from "./escape";

export { escapeHtml } from "./escape";

export interface LayoutOptions {
  title: string;
  body: string;
  /** Rendered inside a <script type="application/json" id="page-data"> tag. */
  data?: unknown;
  nav?: "host" | "public" | "none";
  activeNav?: string;
  hostName?: string;
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
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dashboard/event-types", label: "Event Types" },
  { href: "/dashboard/availability", label: "Availability" },
  { href: "/dashboard/bookings", label: "Bookings" },
  { href: "/dashboard/settings", label: "Settings" },
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

function hostNav(active: string | undefined, hostName: string | undefined): string {
  const links = HOST_NAV.map(
    (item) =>
      `<a href="${item.href}" class="ui-nav-link ${
        active === item.href ? "ui-nav-link-active" : ""
      }"${active === item.href ? ' aria-current="page"' : ""}>${item.label}</a>`,
  ).join("");

  return `
    <header class="sticky top-0 z-20 border-b border-line bg-surface/85 backdrop-blur-md">
      <div class="mx-auto flex h-14 max-w-5xl items-center justify-between gap-4 px-5 sm:px-6">
        ${wordmark("/dashboard")}
        <nav class="hidden items-center gap-0.5 md:flex" aria-label="Main">${links}</nav>
        <div class="flex items-center gap-1">
          ${themeToggle()}
          <form method="post" action="/logout">
          <button class="ui-btn ui-btn-ghost ui-btn-sm" type="submit">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.75"
                 stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" class="size-4">
              <path d="M9 21H6a3 3 0 0 1-3-3V6a3 3 0 0 1 3-3h3"/><path d="m16 17 5-5-5-5M21 12H9"/>
            </svg>
            <span class="hidden sm:inline">Sign out${
              hostName ? ` ${escapeHtml(hostName)}` : ""
            }</span>
          </button>
          </form>
        </div>
      </div>
      <nav class="flex gap-0.5 overflow-x-auto border-t border-line px-3 py-1.5 md:hidden"
           aria-label="Main">${links}</nav>
    </header>`;
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

  const header =
    options.nav === "host"
      ? hostNav(options.activeNav, options.hostName)
      : options.nav === "public"
        ? publicHeader()
        : "";

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
  ${options.nav === "host" ? THEME_TOGGLE_SCRIPT : ""}
</body>
</html>`;
}
