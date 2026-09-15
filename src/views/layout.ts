import { escapeHtml } from "./escape";

export { escapeHtml } from "./escape";
import { avatar, icon } from "./ui";

export interface LayoutOptions {
  title: string;
  body: string;
  /** Rendered inside a <script type="application/json" id="page-data"> tag. */
  data?: unknown;
  nav?: "host" | "none";
  activeNav?: string;
  hostName?: string;
  /** R2 object key for the host's avatar, shown in the sidebar. */
  hostAvatarKey?: string | null;
  /** One-line success message rendered as an auto-dismissing toast. */
  toast?: string;
  /** Host's public username, used by the sidebar's public-page actions. */
  hostSlug?: string;
  /** Constrains <main>. Auth and booking screens are narrower than the dashboard.
   *  "full" removes the constraint and the outer padding for marketing-style pages. */
  width?: "sm" | "md" | "lg" | "full";
  /** Whether to load Alpine.js. Pages with no Alpine directives can skip the
   *  request. Defaults to true. */
  scripts?: boolean;
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
/**
 * When this page runs inside the MeetFlow popup iframe (embed.js), reports the
 * bottom of its real content to the host page so the popup can shrink to fit
 * instead of showing empty space below. The body itself always fills the
 * iframe (min-h-full), so the measurement walks main's children. Inert
 * outside an iframe.
 */
const FRAME_HEIGHT_SCRIPT = `
  <script>
    (function () {
      if (window.parent === window) return;
      var post = function () {
        var height = document.documentElement.scrollHeight;
        var main = document.querySelector("main");
        if (main) {
          var bottom = 0;
          for (var i = 0; i < main.children.length; i++) {
            var rect = main.children[i].getBoundingClientRect();
            if (rect.bottom > bottom) bottom = rect.bottom;
          }
          bottom += parseFloat(getComputedStyle(main).paddingBottom) || 0;
          if (bottom > 0) height = bottom;
        }
        window.parent.postMessage({ source: "meetflow-embed", type: "resize", height: Math.ceil(height) }, "*");
      };
      if ("ResizeObserver" in window) new ResizeObserver(post).observe(document.documentElement);
      window.addEventListener("load", post);
      post();
    })();
  </script>`;

const THEME_TOGGLE_SCRIPT = `<script>
  (function () {
    var btn = document.getElementById("theme-toggle");
    if (!btn) return;
    var root = document.documentElement;

    function label() {
      var mode = root.getAttribute("data-theme") || "system";
      var next = mode === "system" ? "dark" : mode === "dark" ? "light" : "system";
      btn.setAttribute("aria-label", "Theme: " + mode + ". Click to change.");
      btn.setAttribute("title", "Theme: " + mode + " — click for " + next);
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

/**
 * Copies the URL in a `data-copy` attribute when its button is clicked, then
 * swaps the button content for a "Copied" state. Delegated: works for any
 * button rendered anywhere on the page (sidebar and event-type cards).
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

/**
 * The ⌘K command palette. Debounced fetches to /api/search with an
 * AbortController; results are grouped (Actions, Navigation, data groups) and
 * navigated with ↑/↓/Enter. Everything renders via x-text, so guest-controlled
 * strings can never inject markup.
 */
const PALETTE_SCRIPT = `
  <script>
    window.meetflowPalette = function () {
      return {
        open: false,
        q: "",
        loading: false,
        failed: false,
        selected: 0,
        bookings: [],
        eventTypes: [],
        attendees: [],
        controller: null,
        timer: null,

        get items() {
          var items = [];
          function group(name) {
            items.push({ header: true, key: "h-" + name, label: name });
          }
          group("Actions");
          items.push({ key: "new-event-type", label: "New event type", hint: "Action", href: "/dashboard/event-types" });
          group("Navigation");
          items.push({ key: "nav-dashboard", label: "Dashboard", hint: "", href: "/dashboard" });
          items.push({ key: "nav-event-types", label: "Event Types", hint: "", href: "/dashboard/event-types" });
          items.push({ key: "nav-availability", label: "Availability", hint: "", href: "/dashboard/availability" });
          items.push({ key: "nav-bookings", label: "Appointments", hint: "", href: "/dashboard/bookings" });
          items.push({ key: "nav-settings", label: "Settings", hint: "", href: "/dashboard/settings" });
          if (!this.q.trim()) {
            group("Recent");
            for (var i = 0; i < this.bookings.length; i++) {
              var b = this.bookings[i];
              items.push({ key: "b" + b.id, label: b.guest_name + " — " + b.event_name, hint: b.guest_email, href: "/dashboard/bookings" });
            }
            return items;
          }
          if (this.bookings.length) {
            group("Bookings");
            for (var j = 0; j < this.bookings.length; j++) {
              var r = this.bookings[j];
              items.push({ key: "b" + r.id, label: r.guest_name + " — " + r.event_name, hint: r.guest_email, href: "/dashboard/bookings" });
            }
          }
          if (this.eventTypes.length) {
            group("Event types");
            for (var k = 0; k < this.eventTypes.length; k++) {
              var e = this.eventTypes[k];
              items.push({ key: "e" + e.id, label: e.name, hint: "/" + e.slug, href: "/dashboard/event-types/" + e.id });
            }
          }
          if (this.attendees.length) {
            group("Attendees");
            for (var m = 0; m < this.attendees.length; m++) {
              var a = this.attendees[m];
              items.push({ key: "a" + a.booking_id + "-" + a.guest_email, label: a.guest_name, hint: a.guest_email, href: "/dashboard/bookings" });
            }
          }
          return items;
        },

        toggle: function () { this.open ? this.close() : this.show(); },
        show: function () {
          this.open = true;
          this.q = "";
          this.selected = 0;
          this.bookings = [];
          this.eventTypes = [];
          this.attendees = [];
          this.failed = false;
          var self = this;
          this.$nextTick(function () { self.$refs.input.focus(); });
          this.fetch("");
        },
        close: function () {
          this.open = false;
          if (this.controller) this.controller.abort();
        },
        go: function (item) {
          this.close();
          window.location.href = item.href;
        },
        fetch: function (query) {
          var self = this;
          if (this.controller) this.controller.abort();
          this.controller = new AbortController();
          this.loading = true;
          this.failed = false;
          fetch("/api/search?q=" + encodeURIComponent(query), { signal: this.controller.signal })
            .then(function (res) { if (!res.ok) throw new Error(res.status); return res.json(); })
            .then(function (data) {
              self.bookings = data.bookings || [];
              self.eventTypes = data.eventTypes || [];
              self.attendees = data.attendees || [];
              self.selected = 0;
              self.loading = false;
            })
            .catch(function () {
              if (!self.controller.signal.aborted) {
                self.loading = false;
                self.failed = true;
              }
            });
        },
        onInput: function () {
          var self = this;
          if (this.timer) clearTimeout(this.timer);
          this.timer = setTimeout(function () { self.fetch(self.q); }, 200);
        },
        move: function (delta) {
          var next = this.selected;
          do {
            next += delta;
            if (next < 0 || next >= this.items.length) return;
          } while (this.items[next].header);
          this.selected = next;
        },
        onKeydown: function (event) {
          if (event.key === "ArrowDown") { event.preventDefault(); this.move(1); }
          else if (event.key === "ArrowUp") { event.preventDefault(); this.move(-1); }
          else if (event.key === "Enter") {
            var item = this.items[this.selected];
            if (item && !item.header) { event.preventDefault(); this.go(item); }
          }
        },
      };
    };
  </script>`;

export function themeToggle(): string {
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
  { href: "/dashboard/bookings", label: "Appointments", icon: "calendar" },
] as const;

const WIDTHS = { sm: "max-w-md", md: "max-w-3xl", lg: "max-w-5xl", full: "" } as const;

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

      <div class="px-3 pt-3">
        <button type="button" class="ui-side-link w-full" @click="$dispatch('open-palette')"
                aria-label="Search — Command K">
          ${icon("search", "size-[18px] shrink-0")}
          <span class="flex-1 text-left">Search</span>
          <kbd class="rounded border border-line bg-subtle px-1.5 py-0.5 text-[0.6875rem] text-muted">⌘K</kbd>
        </button>
      </div>

      <nav class="flex-1 space-y-0.5 overflow-y-auto p-3" aria-label="Main">${links}</nav>

      <div class="shrink-0 space-y-3 border-t border-line p-3">
        <div class="flex items-center gap-2.5 px-1">
          ${avatar(options.hostName ?? "You", options.hostAvatarKey ?? null, "size-8", "text-xs")}
          <span class="min-w-0 truncate text-sm font-medium text-ink">${escapeHtml(
            options.hostName ?? "",
          )}</span>
        </div>
        <nav class="space-y-0.5" aria-label="Account">
          ${
            options.hostSlug
              ? `<a href="/${escapeHtml(options.hostSlug)}" target="_blank" rel="noopener"
                   @click="drawer = false" class="ui-side-link">
                   ${icon("external", "size-[18px] shrink-0")}
                   <span class="truncate">View public page</span>
                 </a>
                 <button type="button" class="ui-side-link" data-copy="/${escapeHtml(
                   options.hostSlug,
                 )}" @click="drawer = false">
                   ${icon("copy", "size-[18px] shrink-0")}
                   <span class="truncate">Copy public page link</span>
                 </button>`
              : ""
          }
          <a href="/dashboard/settings" @click="drawer = false"
             class="ui-side-link ${
               options.activeNav === "/dashboard/settings" ? "ui-side-link-active" : ""
             }"${options.activeNav === "/dashboard/settings" ? ' aria-current="page"' : ""}>
            ${icon("settings", "size-[18px] shrink-0")}
            <span class="truncate">Settings</span>
          </a>
        </nav>
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
  ${
    options.toast
      ? `<div class="toast" role="status">${icon("check", "size-4 shrink-0 text-success")}<span>${escapeHtml(
          options.toast,
        )}</span></div>`
      : ""
  }
  ${PALETTE_SCRIPT}
  <div x-data="meetflowPalette()" @open-palette.window="show()"
       @keydown.meta.k.window.prevent="toggle()" @keydown.ctrl.k.window.prevent="toggle()"
       @keydown.escape.window="if (open) close()">
    <div x-show="open" x-cloak class="fixed inset-0 z-[60] bg-ink/40" @click="close()"></div>
    <div x-show="open" x-cloak x-transition.duration.120ms
         class="fixed inset-x-4 top-[10vh] z-[61] mx-auto max-w-xl" @click.outside="close()">
      <div class="ui-card overflow-hidden p-0">
        <input x-ref="input" x-model="q" @input="onInput()" @keydown="onKeydown($event)"
               type="search" autocomplete="off" aria-label="Search"
               placeholder="Search appointments, event types, attendees…"
               class="w-full border-0 bg-transparent px-4 py-3 text-sm text-ink outline-none">
        <div class="max-h-[60vh] overflow-y-auto border-t border-line py-1">
          <template x-for="item in items" :key="item.key">
            <div x-show="item.header"
                 class="px-4 pt-2 pb-1 text-[0.6875rem] font-medium uppercase tracking-wide text-muted"
                 x-text="item.label"></div>
          </template>
          <template x-for="(item, index) in items" :key="item.key">
            <button x-show="!item.header" type="button" @click="go(item)" @mouseenter="selected = index"
                    class="flex w-full items-center gap-3 px-4 py-2.5 text-left text-sm"
                    :class="selected === index ? 'bg-subtle' : ''">
              <span class="min-w-0 flex-1 truncate text-ink" x-text="item.label"></span>
              <span class="max-w-[14rem] shrink-0 truncate text-[0.75rem] text-muted" x-text="item.hint"></span>
            </button>
          </template>
          <p x-show="!items.length && !loading && !failed" class="px-4 py-3 text-sm text-muted">No results.</p>
          <p x-show="failed" class="px-4 py-3 text-sm text-muted">Search is unavailable right now.</p>
        </div>
      </div>
    </div>
  </div>
  ${dataScript}
  ${THEME_TOGGLE_SCRIPT}
  ${COPY_LINK_SCRIPT}
  ${FRAME_HEIGHT_SCRIPT}
</body>
</html>`;
}

export function layout(options: LayoutOptions): string {
  const dataScript = options.data
    ? `<script type="application/json" id="page-data">${JSON.stringify(options.data).replace(
        /</g,
        "\\u003c",
      )}</script>`
    : "";

  if (options.nav === "host") return hostLayout(options, dataScript);

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
  ${options.scripts === false ? "" : '<script defer src="/vendor/alpine.min.js"></script>'}
</head>
<body class="flex min-h-full flex-col bg-canvas text-body antialiased">
  ${
    options.width === "sm" || options.width === "md"
      ? `<div class="fixed right-4 top-4 z-40">${themeToggle()}</div>`
      : ""
  }
  <main class="${
    options.width === "full"
      ? "flex-1"
      : `mx-auto w-full ${WIDTHS[options.width ?? "lg"]} flex-1 px-5 py-8 sm:px-6 sm:py-10`
  }">${options.body}</main>
  ${dataScript}
  ${THEME_TOGGLE_SCRIPT}
  ${FRAME_HEIGHT_SCRIPT}
</body>
</html>`;
}
