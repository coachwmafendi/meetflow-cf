import { escapeHtml, layout } from "./layout";
import { TIMEZONE_SCRIPT, timezoneSelect } from "./timezoneSelect";
import { alert, button, field, icon } from "./ui";

/** Password field with a show/hide eye toggle (Alpine, no extra JS). */
function passwordField(options: { hint?: string; attrsHtml?: string } = {}): string {
  return `<div class="ui-fieldset">
      <label class="ui-label" for="password">Password</label>
      <div class="relative" x-data="{ show: false }">
        <input class="ui-input pr-10" id="password" name="password"
               :type="show ? 'text' : 'password'" required ${options.attrsHtml ?? ""}
               ${options.hint ? 'aria-describedby="password-hint"' : ""}>
        <button type="button"
                class="absolute inset-y-0 right-0 flex items-center px-3 text-muted transition-colors hover:text-ink"
                :aria-label="show ? 'Hide password' : 'Show password'"
                aria-controls="password" @click="show = !show">
          <span x-show="!show">${icon("eye", "size-4")}</span>
          <span x-show="show" x-cloak>${icon("eyeOff", "size-4")}</span>
        </button>
      </div>
      ${options.hint ? `<p class="ui-hint" id="password-hint">${escapeHtml(options.hint)}</p>` : ""}
    </div>`;
}

const WORLD_CLOCKS: Array<{ tz: string; city: string; pos: string }> = [
  { tz: "Asia/Kuala_Lumpur", city: "Kuala Lumpur", pos: "top-[16%] left-[8%]" },
  { tz: "Europe/London", city: "London", pos: "top-[26%] right-[9%]" },
  { tz: "America/New_York", city: "New York", pos: "top-[52%] left-[11%]" },
  { tz: "Asia/Tokyo", city: "Tokyo", pos: "bottom-[26%] right-[13%]" },
  { tz: "Australia/Sydney", city: "Sydney", pos: "bottom-[14%] left-[15%]" },
  { tz: "America/Los_Angeles", city: "San Francisco", pos: "top-[68%] right-[6%]" },
];

const worldClocks = WORLD_CLOCKS.map(
  (c) => `<div class="auth-clock ${c.pos}" data-tz="${c.tz}">
    <span class="auth-clock-time" data-clock-time>--:--</span>
    <span class="auth-clock-city">${c.city}</span>
  </div>`,
).join("");

const WORLD_CLOCK_SCRIPT = `
  <script>
    (function () {
      var clocks = document.querySelectorAll("[data-tz]");
      if (!clocks.length) return;
      function render() {
        var now = new Date();
        clocks.forEach(function (el) {
          try {
            el.querySelector("[data-clock-time]").textContent = new Intl.DateTimeFormat("en-GB", {
              timeZone: el.getAttribute("data-tz"),
              hour: "2-digit",
              minute: "2-digit",
              hour12: false,
            }).format(now);
          } catch (e) { /* unknown zone — leave placeholder */ }
        });
      }
      render();
      setInterval(render, 15000);
    })();
  </script>`;

function authShell(options: {
  title: string;
  heading: string;
  blurb: string;
  error?: string;
  formHtml: string;
  footerHtml: string;
  scriptHtml?: string;
}): string {
  return layout({
    title: options.title,
    nav: "none",
    width: "sm",
    body: `
      <div class="auth-bg" aria-hidden="true">
        <div class="auth-bg-grid"></div>
        <div class="auth-bg-glow auth-bg-glow-a"></div>
        <div class="auth-bg-glow auth-bg-glow-b"></div>
        <div class="auth-bg-glow auth-bg-glow-c"></div>
        ${worldClocks}
      </div>
      <div class="relative z-10 mx-auto w-full max-w-[22rem] py-6 sm:py-10">
        <a href="/" class="mb-8 flex items-center justify-center gap-2 text-ink" aria-label="MeetFlow">
          <span class="flex size-7 items-center justify-center rounded-lg bg-primary text-on-primary">
            <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" class="size-4">
              <rect x="3" y="5" width="18" height="16" rx="4" stroke="currentColor" stroke-width="2"/>
              <path d="M8 3v4M16 3v4" stroke="currentColor" stroke-width="2" stroke-linecap="round"/>
              <rect x="7" y="12" width="5" height="4" rx="1.2" fill="currentColor"/>
            </svg>
          </span>
          <span class="text-base font-semibold tracking-[-0.02em]">MeetFlow</span>
        </a>

        <div class="ui-rise">
          <h1 class="text-center text-[1.375rem] font-semibold tracking-[-0.02em] text-ink">
            ${escapeHtml(options.heading)}
          </h1>
          <p class="mt-1.5 mb-6 text-center text-sm text-muted">${escapeHtml(options.blurb)}</p>

          ${options.error ? `<div class="mb-4">${alert("danger", options.error)}</div>` : ""}

          <div class="ui-card ui-card-pad">
            ${options.formHtml}
          </div>

          <p class="mt-5 text-center text-[0.8125rem] text-muted">${options.footerHtml}</p>
        </div>
      </div>
      ${options.scriptHtml ?? ""}
      ${WORLD_CLOCK_SCRIPT}`,
  });
}

export function loginPage(error?: string): string {
  return authShell({
    title: "Sign in",
    heading: "Sign in",
    blurb: "Welcome back to MeetFlow.",
    error,
    formHtml: `
      <form class="space-y-4" method="post" action="/login">
        ${field({ name: "email", label: "Email", type: "email", placeholder: "you@example.com" })}
        ${passwordField()}
        <div class="pt-1">${button({
          label: "Sign in",
          variant: "primary",
          size: "lg",
          type: "submit",
        })}</div>
      </form>`,
    footerHtml: `No account? <a class="font-medium text-ink underline underline-offset-4 hover:text-primary-hover" href="/register">Create one</a>`,
  });
}

export function registerPage(error?: string): string {
  const timezoneField = field({
    name: "timezone",
    label: "Timezone",
    hint: "Used for your availability and booking times.",
    controlHtml: timezoneSelect({ name: "timezone", selected: "UTC", autodetect: true }),
  });

  return authShell({
    title: "Create account",
    heading: "Create your account",
    blurb: "Publish a booking page in two minutes.",
    error,
    formHtml: `
      <form class="space-y-4" method="post" action="/register">
        ${field({ name: "name", label: "Name", placeholder: "Wan Mafendi" })}
        ${field({ name: "email", label: "Email", type: "email", placeholder: "you@example.com" })}
        ${passwordField({
          hint: "At least 8 characters.",
          attrsHtml: 'minlength="8"',
        })}
        ${field({
          name: "slug",
          label: "Username",
          placeholder: "wan",
          hint: "Your public page will be meetflow.dev/username.",
          attrsHtml: 'pattern="[a-z0-9][a-z0-9-]{1,30}[a-z0-9]"',
        })}
        ${timezoneField}
        <div class="pt-1">${button({
          label: "Create account",
          variant: "primary",
          size: "lg",
          type: "submit",
        })}</div>
      </form>`,
    footerHtml: `Already have an account? <a class="font-medium text-ink underline underline-offset-4 hover:text-primary-hover" href="/login">Sign in</a>`,
    scriptHtml: TIMEZONE_SCRIPT,
  });
}
