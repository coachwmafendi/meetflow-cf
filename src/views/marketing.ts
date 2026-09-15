import { escapeHtml, layout, themeToggle } from "./layout";
import { button, icon, type IconName } from "./ui";

/**
 * The public landing page: what MeetFlow is, what it does, and a clear ask to
 * join. Purely static HTML — no Alpine, no data script — so it skips the
 * vendor bundle and stays as light as a page can get.
 *
 * Everything uses the same design tokens as the product, so light and dark
 * follow the visitor's OS preference with zero extra markup.
 */

/** The mark, local so the header and footer stay identical to each other. */
function wordmark(): string {
  return `<a href="/" class="flex items-center gap-2 text-ink" aria-label="MeetFlow home">
    <span class="flex size-6 items-center justify-center rounded-md bg-primary text-on-primary">
      <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" class="size-3.5">
        <rect x="3" y="5" width="18" height="16" rx="4" stroke="currentColor" stroke-width="2"/>
        <path d="M8 3v4M16 3v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
        <rect x="7" y="12" width="5" height="4" rx="1.2" fill="currentColor"/>
      </svg>
    </span>
    <span class="text-[0.9375rem] font-semibold tracking-[-0.02em]">MeetFlow</span>
  </a>`;
}

/* -------------------------------------------------------------------------- */
/* Hero product preview                                                        */
/* -------------------------------------------------------------------------- */

const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

/**
 * A miniature of the real booking page — event summary, month calendar and
 * slot list — built from the actual booking-page classes, so the illustration
 * never over-promises. Purely decorative: aria-hidden, no focusable bits.
 */
function demoBookingCard(): string {
  const now = new Date();
  const firstDow = new Date(now.getFullYear(), now.getMonth(), 1).getDay();
  const daysInMonth = new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate();
  const today = now.getDate();

  const head = WEEKDAYS.map(
    (d) => `<span class="py-0.5 text-center text-[0.625rem] font-medium text-muted">${d}</span>`,
  ).join("");

  const cells: string[] = [];
  for (let i = 0; i < firstDow; i++) cells.push('<span aria-hidden="true"></span>');
  for (let d = 1; d <= daysInMonth; d++) {
    const classes = [
      "flex aspect-square items-center justify-center rounded-md text-[0.6875rem] font-medium",
      d < today ? "text-muted/40" : d === today ? "bg-primary text-on-primary" : "text-ink",
    ]
      .filter(Boolean)
      .join(" ");
    cells.push(`<span class="${classes}">${d}</span>`);
  }

  const slot = (label: string, selected = false) =>
    `<span class="flex items-center justify-center rounded-md border px-2 py-1.5
       font-mono text-[0.75rem] font-medium tabular-nums tracking-[-0.01em] ${
         selected ? "border-primary bg-primary text-on-primary" : "border-line bg-surface text-ink"
       }">${label}</span>`;

  return `<div class="ui-card mx-auto w-full max-w-md overflow-hidden shadow-lg" aria-hidden="true">
    <div class="grid sm:grid-cols-[10.5rem_minmax(0,1fr)]">

      <aside class="border-b border-line p-4 sm:border-b-0 sm:border-r">
        <div class="flex items-center gap-2.5">
          <span class="flex size-8 shrink-0 items-center justify-center rounded-full border border-line bg-subtle text-xs font-semibold text-ink">W</span>
          <div class="min-w-0">
            <p class="truncate text-sm font-medium text-ink">Wan</p>
            <p class="truncate text-[0.75rem] text-muted">@wan</p>
          </div>
        </div>

        <h3 class="mt-3.5 text-[0.9375rem] font-semibold tracking-[-0.02em] text-ink">Consultation</h3>

        <div class="mt-2">
          <span class="ui-badge ui-badge-neutral"><span class="ui-time">30m</span></span>
        </div>

        <p class="mt-3 flex items-center gap-2 text-[0.75rem] text-body">
          ${icon("video", "size-3.5 shrink-0 text-muted")}<span>Google Meet</span>
        </p>

        <p class="mt-3 border-t border-line pt-3 text-[0.75rem] leading-relaxed text-muted">
          A focused half hour to talk through your project.
        </p>
      </aside>

      <div class="p-4">
        <div class="mb-2 flex items-center justify-between">
          <p class="text-[0.8125rem] font-semibold text-ink">
            ${now.toLocaleDateString("en-US", { month: "long", year: "numeric" })}
          </p>
          <span class="flex items-center gap-1 text-muted">
            ${icon("chevronLeft", "size-3.5")}${icon("chevronRight", "size-3.5")}
          </span>
        </div>

        <div class="mb-1 grid grid-cols-7">${head}</div>
        <div class="grid grid-cols-7 gap-0.5">${cells.join("")}</div>

        <p class="mt-3 text-[0.8125rem] font-semibold text-ink">Available times</p>
        <div class="mt-1.5 grid grid-cols-4 gap-1.5">
          ${slot("09:00")}${slot("09:30")}${slot("10:00", true)}${slot("10:30")}
        </div>
      </div>

    </div>
  </div>`;
}

/* -------------------------------------------------------------------------- */
/* Content                                                                     */
/* -------------------------------------------------------------------------- */

const FEATURES: Array<{ icon: IconName; title: string; body: string }> = [
  {
    icon: "link",
    title: "Public booking pages",
    body: "Every event type gets a clean page at /you/consultation. Share one link — guests never need an account.",
  },
  {
    icon: "calendar",
    title: "Weekly availability",
    body: "Set recurring hours per weekday in your own timezone. Bookable slots are generated from them automatically.",
  },
  {
    icon: "clock",
    title: "Buffer time",
    body: "Add a gap after each meeting so your day never stacks back-to-back.",
  },
  {
    icon: "globe",
    title: "Timezone correct",
    body: "Everything is stored in UTC and shown in the right zone — yours, and every guest's.",
  },
  {
    icon: "check",
    title: "Double-booking protection",
    body: "Every appointment is re-validated on the server the moment it is made. Two guests can never take one slot.",
  },
  {
    icon: "inbox",
    title: "Emails & reminders",
    body: "Guests get confirmations and 24-hour reminders. You are notified of every new appointment and cancellation.",
  },
];

const TOUR: Array<{ id: string; icon: IconName; label: string; src: string; alt: string }> = [
  {
    id: "dashboard",
    icon: "grid",
    label: "Dashboard",
    src: "/images/dashboard-desktop.png",
    alt: "The MeetFlow dashboard",
  },
  {
    id: "event-types",
    icon: "layers",
    label: "Event types",
    src: "/images/event-types-desktop.png",
    alt: "Event types list",
  },
  {
    id: "availability",
    icon: "clock",
    label: "Availability",
    src: "/images/availability-desktop.png",
    alt: "Weekly availability editor",
  },
  {
    id: "booking-page",
    icon: "globe",
    label: "Booking page",
    src: "/images/booking-page-desktop.png",
    alt: "A public booking page",
  },
  {
    id: "confirmation",
    icon: "check",
    label: "Confirmation",
    src: "/images/confirmation-desktop.png",
    alt: "Booking confirmation page",
  },
  {
    id: "bookings",
    icon: "calendar",
    label: "Appointments",
    src: "/images/bookings-desktop.png",
    alt: "Appointments list",
  },
];

const STEPS: Array<{ n: string; title: string; body: string }> = [
  {
    n: "01",
    title: "Create an event type",
    body: "Name it, set the duration and location — Google Meet, Zoom, in person or a phone call.",
  },
  {
    n: "02",
    title: "Share your link",
    body: "Your public page is live at /you/consultation. Drop the link in your bio, email or anywhere.",
  },
  {
    n: "03",
    title: "Guests book themselves",
    body: "They pick a date, pick a time and confirm. You both get the details by email.",
  },
];

export function marketingPage(): string {
  const featureCards = FEATURES.map(
    (f, i) => `<div class="reveal" style="transition-delay:${(i % 3) * 70}ms">
      <div class="ui-card ui-card-pad h-full transition-[transform,border-color,box-shadow]
                  duration-200 hover:-translate-y-0.5 hover:border-line-strong hover:shadow-md">
        <span class="flex size-9 items-center justify-center rounded-lg border border-line bg-subtle text-muted">
          ${icon(f.icon, "size-[17px]")}
        </span>
        <h3 class="mt-4 text-sm font-semibold text-ink">${escapeHtml(f.title)}</h3>
        <p class="mt-1.5 text-[0.8125rem] leading-relaxed text-muted">${escapeHtml(f.body)}</p>
      </div>
    </div>`,
  ).join("");

  const steps = STEPS.map(
    (s, i) => `<div class="reveal" style="transition-delay:${i * 90}ms">
      <p class="ui-time text-sm font-semibold text-accent">${s.n}</p>
      <h3 class="mt-2 text-sm font-semibold text-ink">${escapeHtml(s.title)}</h3>
      <p class="mt-1.5 max-w-xs text-[0.8125rem] leading-relaxed text-muted">${escapeHtml(s.body)}</p>
    </div>`,
  ).join("");

  const tourTabs = TOUR.map(
    (t, i) => `<button type="button" role="tab" id="tour-tab-${t.id}"
        aria-controls="tour-${t.id}" aria-selected="${i === 0}"
        tabindex="${i === 0 ? 0 : -1}"
        class="inline-flex items-center gap-1.5 rounded-full border border-line px-3.5 py-1.5
               text-[0.8125rem] font-medium text-muted transition-colors hover:text-ink
               aria-selected:border-ink aria-selected:bg-ink aria-selected:text-on-primary
               focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-primary">
        ${icon(t.icon, "size-3.5 shrink-0")}<span>${escapeHtml(t.label)}</span>
      </button>`,
  ).join("");

  const tourPanels = TOUR.map(
    (t, i) => `<div role="tabpanel" id="tour-${t.id}" aria-labelledby="tour-tab-${t.id}"${
      i === 0 ? "" : " hidden"
    }>
      <img src="${t.src}" alt="${escapeHtml(t.alt)}"${i === 0 ? "" : ' loading="lazy"'}
           class="aspect-[16/10] w-full rounded-lg border border-line bg-subtle object-cover object-top">
    </div>`,
  ).join("");

  return layout({
    title: "Scheduling made simple",
    nav: "none",
    width: "full",
    scripts: false,
    body: `
      <header class="sticky top-0 z-40 border-b border-line bg-canvas/85 backdrop-blur-md">
        <div class="mx-auto flex h-14 w-full max-w-5xl items-center justify-between px-5 sm:px-6">
          ${wordmark()}
          <nav class="hidden items-center gap-1 md:flex" aria-label="Page">
            <a class="ui-nav-link" href="#features">Features</a>
            <a class="ui-nav-link" href="#how">How it works</a>
            <a class="ui-nav-link" href="#tour">Tour</a>
          </nav>
          <div class="flex items-center gap-2">
            ${themeToggle()}
            ${button({ label: "Sign in", href: "/login", variant: "ghost", size: "sm" })}
            ${button({ label: "Get started", href: "/register", variant: "primary", size: "sm" })}
          </div>
        </div>
      </header>

      <section class="mx-auto w-full max-w-5xl px-5 pb-14 pt-12 sm:px-6 sm:pb-20 sm:pt-16 lg:pt-20">
        <div class="grid items-center gap-12 lg:grid-cols-2 lg:gap-10">

          <div>
            <p class="ui-eyebrow ui-rise">Scheduling for independent professionals</p>
            <h1 class="ui-rise mt-3 text-4xl font-semibold leading-[1.08] tracking-[-0.03em] text-ink sm:text-5xl"
                style="animation-delay:60ms">
              Take appointments, not back-and-forth.
            </h1>
            <p class="ui-rise mt-4 max-w-lg text-base leading-relaxed text-body" style="animation-delay:120ms">
              MeetFlow turns your availability into a shareable booking page. Guests pick a time
              that suits them; you keep control of your hours. No account needed to book.
            </p>
            <div class="ui-rise mt-7 flex flex-wrap items-center gap-3" style="animation-delay:180ms">
              ${button({
                label: "Get started free",
                href: "/register",
                variant: "primary",
                className: "h-10 px-5 text-[0.9375rem]",
              })}
              ${button({
                label: "How it works",
                href: "#how",
                variant: "secondary",
                className: "h-10 px-5 text-[0.9375rem]",
              })}
            </div>
            <p class="ui-rise mt-5 flex items-center gap-1.5 text-[0.8125rem] text-muted"
               style="animation-delay:240ms">
              ${icon("check", "size-3.5 shrink-0")}
              <span>Free to start · No credit card · Set up in minutes</span>
            </p>
          </div>

          <div class="ui-rise" style="animation-delay:200ms">${demoBookingCard()}</div>

        </div>
      </section>

      <section class="border-y border-line bg-subtle/50" aria-label="Who it is for">
        <div class="reveal mx-auto w-full max-w-5xl px-5 py-7 sm:px-6">
          <p class="ui-eyebrow text-center">Built for</p>
          <p class="mt-3 text-center text-sm text-body">
            Consultants · Freelancers · Coaches · Tutors · Salespeople · Agencies
          </p>
        </div>
      </section>

      <section id="features" class="mx-auto w-full max-w-5xl px-5 py-16 sm:px-6 sm:py-20">
        <div class="max-w-xl">
          <p class="ui-eyebrow">Why MeetFlow</p>
          <h2 class="mt-3 text-2xl font-semibold tracking-[-0.02em] text-ink sm:text-3xl">
            Everything you need to get booked.
          </h2>
          <p class="mt-3 text-body">
            A complete appointment flow — public pages, weekly availability, buffers, timezones and
            double-booking protection — without the enterprise clutter.
          </p>
        </div>
        <div class="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">${featureCards}</div>
      </section>

      <section id="how" class="border-t border-line bg-subtle/50">
        <div class="mx-auto w-full max-w-5xl px-5 py-16 sm:px-6 sm:py-20">
          <div class="max-w-xl">
            <p class="ui-eyebrow">How it works</p>
            <h2 class="mt-3 text-2xl font-semibold tracking-[-0.02em] text-ink sm:text-3xl">
              Live in three steps.
            </h2>
            <p class="mt-3 text-body">
              From signup to your first booking in under five minutes.
            </p>
          </div>
          <div class="mt-10 grid gap-8 sm:grid-cols-3">${steps}</div>
        </div>
      </section>

      <section id="tour" class="mx-auto w-full max-w-5xl px-5 py-16 sm:px-6 sm:py-20">
        <div class="max-w-xl">
          <p class="ui-eyebrow">Product tour</p>
          <h2 class="mt-3 text-2xl font-semibold tracking-[-0.02em] text-ink sm:text-3xl">
            One calm workspace for the whole flow.
          </h2>
          <p class="mt-3 text-body">
            Availability, event types, bookings and guest confirmations — all in one place.
          </p>
        </div>
        <div class="reveal mt-8 flex flex-wrap gap-2" role="tablist" aria-label="Product tour">
          ${tourTabs}
        </div>
        <div class="reveal mt-4 rounded-xl border border-line bg-surface p-1.5 shadow-md sm:p-2">
          ${tourPanels}
        </div>
      </section>

      <section class="mx-auto w-full max-w-5xl px-5 py-16 sm:px-6 sm:py-20">
        <div class="reveal ui-card ui-card-pad flex flex-col items-center text-center">
          <h2 class="text-2xl font-semibold tracking-[-0.02em] text-ink">
            Ready to take bookings?
          </h2>
          <p class="mt-2 max-w-md text-body">
            Create your free account and publish your first booking page in minutes.
          </p>
          <div class="mt-6 flex flex-wrap items-center justify-center gap-3">
            ${button({ label: "Create your free account", href: "/register", variant: "primary" })}
            ${button({ label: "Sign in", href: "/login", variant: "ghost" })}
          </div>
        </div>
      </section>

      <footer class="border-t border-line">
        <div class="mx-auto flex w-full max-w-5xl flex-col items-center justify-between gap-4 px-5 py-8 text-center sm:flex-row sm:px-6 sm:text-left">
          <div>
            ${wordmark()}
            <p class="mt-1.5 text-[0.75rem] text-muted">Simple scheduling, running on Cloudflare.</p>
          </div>
          <nav class="flex items-center gap-5 text-[0.8125rem] text-muted" aria-label="Footer">
            <a class="transition-colors hover:text-ink" href="#features">Features</a>
            <a class="transition-colors hover:text-ink" href="#how">How it works</a>
            <a class="transition-colors hover:text-ink" href="#tour">Tour</a>
            <a class="transition-colors hover:text-ink" href="/login">Sign in</a>
            <a class="transition-colors hover:text-ink" href="/register">Get started</a>
            <a class="transition-colors hover:text-ink" href="/privacy">Privacy</a>
            <a class="transition-colors hover:text-ink" href="/terms">Terms</a>
          </nav>
        </div>
      </footer>

      <script>
        (function () {
          var tour = document.getElementById("tour");
          if (!tour) return;
          var tabs = Array.prototype.slice.call(tour.querySelectorAll('[role="tab"]'));
          var panels = Array.prototype.slice.call(tour.querySelectorAll('[role="tabpanel"]'));

          function select(id) {
            tabs.forEach(function (t) {
              var on = t.getAttribute("aria-controls") === id;
              t.setAttribute("aria-selected", on ? "true" : "false");
              t.tabIndex = on ? 0 : -1;
            });
            panels.forEach(function (p) {
              p.hidden = p.id !== id;
            });
          }

          tabs.forEach(function (t) {
            t.addEventListener("click", function () {
              select(t.getAttribute("aria-controls"));
            });
            t.addEventListener("keydown", function (e) {
              if (e.key !== "ArrowRight" && e.key !== "ArrowLeft") return;
              e.preventDefault();
              var next = tabs[(tabs.indexOf(t) + (e.key === "ArrowRight" ? 1 : tabs.length - 1)) % tabs.length];
              select(next.getAttribute("aria-controls"));
              next.focus();
            });
          });
        })();
      </script>

      <script>
        (function () {
          var items = Array.prototype.slice.call(document.querySelectorAll(".reveal"));
          if (!items.length) return;
          var reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
          if (reduced || !("IntersectionObserver" in window)) {
            items.forEach(function (el) { el.classList.add("reveal-in"); });
            return;
          }
          document.body.classList.add("reveal-anim");
          var io = new IntersectionObserver(function (entries) {
            entries.forEach(function (entry) {
              if (!entry.isIntersecting) return;
              entry.target.classList.add("reveal-in");
              io.unobserve(entry.target);
            });
          }, { rootMargin: "0px 0px -6% 0px", threshold: 0.05 });
          items.forEach(function (el) { io.observe(el); });
        })();
      </script>`,
  });
}
