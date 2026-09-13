import { escapeHtml, layout } from "./layout";
import { TIMEZONE_SCRIPT, timezoneSelect } from "./timezoneSelect";

function field(name: string, label: string, type = "text", extra = ""): string {
  return `
    <div class="mb-4">
      <label class="mf-label" for="${name}">${label}</label>
      <input class="mf-input" id="${name}" name="${name}" type="${type}" ${extra} required>
    </div>`;
}

function timezoneField(): string {
  return `
    <div class="mb-4">
      <label class="mf-label" for="timezone">Timezone</label>
      ${timezoneSelect({ name: "timezone", selected: "UTC", autodetect: true })}
    </div>`;
}

export function loginPage(error?: string): string {
  return layout({
    title: "Sign in",
    nav: "none",
    body: `
      <div class="mx-auto max-w-sm">
        <h1 class="mb-1 text-2xl font-semibold tracking-tight">Sign in</h1>
        <p class="mb-6 text-sm text-muted">Welcome back to MeetFlow.</p>
        ${
          error
            ? `<p class="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">${escapeHtml(
                error,
              )}</p>`
            : ""
        }
        <form class="mf-card" method="post" action="/login">
          ${field("email", "Email", "email")}
          ${field("password", "Password", "password")}
          <button class="mf-btn w-full" type="submit">Sign in</button>
        </form>
        <p class="mt-4 text-center text-sm text-muted">
          No account? <a class="underline" href="/register">Create one</a>
        </p>
      </div>`,
  });
}

export function registerPage(error?: string): string {
  return layout({
    title: "Create account",
    nav: "none",
    body: `
      <div class="mx-auto max-w-sm">
        <h1 class="mb-1 text-2xl font-semibold tracking-tight">Create your account</h1>
        <p class="mb-6 text-sm text-muted">Publish a booking page in two minutes.</p>
        ${
          error
            ? `<p class="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">${escapeHtml(
                error,
              )}</p>`
            : ""
        }
        <form class="mf-card" method="post" action="/register">
          ${field("name", "Name")}
          ${field("email", "Email", "email")}
          ${field("password", "Password", "password", 'minlength="8"')}
          ${field("slug", "Username", "text", 'pattern="[a-z0-9][a-z0-9-]{1,30}[a-z0-9]"')}
          ${timezoneField()}
          <button class="mf-btn w-full" type="submit">Create account</button>
        </form>
        <p class="mt-4 text-center text-sm text-muted">
          Already have an account? <a class="underline" href="/login">Sign in</a>
        </p>
      </div>
      ${TIMEZONE_SCRIPT}`,
  });
}
