export function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface LayoutOptions {
  title: string;
  body: string;
  /** Rendered inside a <script type="application/json" id="page-data"> tag. */
  data?: unknown;
  nav?: "host" | "public" | "none";
  activeNav?: string;
  hostName?: string;
}

const HOST_NAV: Array<{ href: string; label: string }> = [
  { href: "/dashboard", label: "Dashboard" },
  { href: "/dashboard/event-types", label: "Event Types" },
  { href: "/dashboard/availability", label: "Availability" },
  { href: "/dashboard/bookings", label: "Bookings" },
  { href: "/dashboard/settings", label: "Settings" },
];

function hostNav(active: string | undefined, hostName: string | undefined): string {
  const links = HOST_NAV.map(
    (item) =>
      `<a href="${item.href}" class="rounded-lg px-3 py-2 text-sm ${
        active === item.href
          ? "bg-neutral-100 font-medium text-ink"
          : "text-muted hover:bg-neutral-50"
      }">${item.label}</a>`,
  ).join("");
  return `
    <header class="border-b border-line bg-white">
      <div class="mx-auto flex max-w-5xl items-center justify-between px-6 py-3">
        <a href="/dashboard" class="text-base font-semibold tracking-tight">MeetFlow</a>
        <nav class="hidden items-center gap-1 md:flex">${links}</nav>
        <form method="post" action="/logout">
          <button class="text-sm text-muted hover:text-ink">
            ${hostName ? `Sign out ${escapeHtml(hostName)}` : "Sign out"}
          </button>
        </form>
      </div>
    </header>`;
}

export function layout(options: LayoutOptions): string {
  const dataScript = options.data
    ? `<script type="application/json" id="page-data">${JSON.stringify(options.data).replace(
        /</g,
        "\\u003c",
      )}</script>`
    : "";
  return `<!doctype html>
<html lang="en" class="h-full">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>${escapeHtml(options.title)} · MeetFlow</title>
  <link rel="stylesheet" href="/app.css">
  <script defer src="/vendor/alpine.min.js"></script>
</head>
<body class="h-full bg-neutral-50 text-ink antialiased">
  ${options.nav === "host" ? hostNav(options.activeNav, options.hostName) : ""}
  <main class="mx-auto max-w-5xl px-6 py-10">${options.body}</main>
  ${dataScript}
</body>
</html>`;
}
