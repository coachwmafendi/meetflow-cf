# Password Reset (Forgot Password) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Email-based password reset: `/forgot-password` requests a signed 30-minute link, `/reset-password?token=…` sets the new password, and the user lands back on `/login` with a toast.

**Architecture:** A stateless purpose-bound HMAC token (`password-reset`, payload `userId:exp:pwdPrefix`) makes links single-use without any new table — the prefix of the current password hash stops verifying once the password changes. The reset email rides the existing Resend queue; pages reuse the `authShell` layout, `throttled()`-style rate limiting, and the layout toast.

**Tech Stack:** Cloudflare Workers + Hono, D1, Resend (queued), PBKDF2, vitest-pool-workers (`cloudflare:test`).

**Spec:** `docs/superpowers/specs/2026-09-15-password-reset-design.md`

---

### File map

- Create: `src/lib/resetToken.ts` — sign/verify the reset token.
- Create: `test/unit/resetToken.test.ts` — token unit tests.
- Create: `test/integration/passwordReset.test.ts` — service + page integration tests (Task 3 creates it, Task 4 appends).
- Modify: `src/lib/emailTemplates.ts` — `passwordReset()` template.
- Modify: `src/services/email.ts` — `EmailJob` kind, `processEmailJob` branch, `queuePasswordReset()`.
- Modify: `src/db/users.ts` — `getUserRowById()`, `updatePasswordHash()`.
- Modify: `src/services/auth.ts` — `resolveResetToken()`, `requestPasswordReset()`, `resetPassword()`.
- Modify: `src/views/auth.ts` — `forgotPasswordPage()`, `resetPasswordPage()`, `invalidResetLinkPage()`, login toast + forgot link.
- Modify: `src/routes/pages.ts` — `/forgot-password`, `/reset-password` routes; login toast passthrough.
- Modify: `src/middleware/rateLimit.ts` — `forgotPassword` bucket.
- Modify: `src/lib/validate.ts` — reserve `forgot-password` and `reset-password` slugs.
- Modify: `test/integration/email.test.ts` — password_reset job test.

---

### Task 1: Reset token library

**Files:**
- Create: `src/lib/resetToken.ts`
- Test: `test/unit/resetToken.test.ts`

- [ ] **Step 1: Write the failing test**

Create `test/unit/resetToken.test.ts`:

```ts
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { signPayload } from "../../src/lib/hmac";
import { signResetToken, verifyResetToken } from "../../src/lib/resetToken";

const SECRET = "test-secret";
const HASH = "pbkdf2$100000$salt1234$hashvalue1234";
const CHANGED = "pbkdf2$100000$salt5678$otherhash5678";

describe("resetToken", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T12:00:00Z"));
  });
  afterEach(() => vi.useRealTimers());

  it("round-trips a valid token to the user id", async () => {
    const token = await signResetToken(42, HASH, SECRET);
    await expect(verifyResetToken(token, HASH, SECRET)).resolves.toBe(42);
  });

  it("rejects a token signed for a different purpose", async () => {
    const other = await signPayload("booking-cancel", "42:9999999999:abcdefgh", SECRET);
    await expect(verifyResetToken(other, HASH, SECRET)).resolves.toBeNull();
  });

  it("rejects a tampered payload", async () => {
    const token = await signResetToken(42, HASH, SECRET);
    const signature = token.slice(token.lastIndexOf(".") + 1);
    const tamperedPayload = btoa("43:9999999999:abcdefgh");
    await expect(verifyResetToken(`${tamperedPayload}.${signature}`, HASH, SECRET)).resolves.toBeNull();
  });

  it("rejects an expired token", async () => {
    const token = await signResetToken(42, HASH, SECRET);
    vi.setSystemTime(new Date("2026-09-15T13:00:00Z"));
    await expect(verifyResetToken(token, HASH, SECRET)).resolves.toBeNull();
  });

  it("rejects a token whose password hash no longer matches", async () => {
    const token = await signResetToken(42, HASH, SECRET);
    await expect(verifyResetToken(token, CHANGED, SECRET)).resolves.toBeNull();
  });

  it("rejects garbage input", async () => {
    await expect(verifyResetToken("", HASH, SECRET)).resolves.toBeNull();
    await expect(verifyResetToken("abc", HASH, SECRET)).resolves.toBeNull();
    await expect(verifyResetToken("a.b.c.d", HASH, SECRET)).resolves.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/unit/resetToken.test.ts`
Expected: FAIL — `Cannot find module '../../src/lib/resetToken'`.

- [ ] **Step 3: Implement the token library**

Create `src/lib/resetToken.ts`:

```ts
import { signPayload, verifyPayload } from "./hmac";

/**
 * Signed password-reset links.
 *
 * The payload carries the user id, an expiry, and a short prefix of the user's
 * CURRENT password hash. The prefix makes the token single-use without any
 * storage: once the password changes, every previously issued link stops
 * verifying. No migration, no table, no cleanup job.
 */
const PURPOSE = "password-reset";

/** How long a reset link stays valid. */
export const RESET_WINDOW_SECONDS = 30 * 60;

function prefixOf(passwordHash: string): string {
  return passwordHash.slice(0, 8);
}

export async function signResetToken(
  userId: number,
  passwordHash: string,
  secret: string,
): Promise<string> {
  const exp = Math.floor(Date.now() / 1000) + RESET_WINDOW_SECONDS;
  return signPayload(PURPOSE, `${userId}:${exp}:${prefixOf(passwordHash)}`, secret);
}

/** Returns the user id the token authorises, or null when invalid. */
export async function verifyResetToken(
  token: string,
  passwordHash: string,
  secret: string,
): Promise<number | null> {
  const payload = await verifyPayload(PURPOSE, token, secret);
  if (payload === null) return null;

  const [idPart, expPart, prefixPart] = payload.split(":");
  if (!idPart || !expPart || !prefixPart) return null;

  const userId = Number(idPart);
  const exp = Number(expPart);
  if (!Number.isInteger(userId) || userId <= 0) return null;
  if (!Number.isInteger(exp) || exp <= Math.floor(Date.now() / 1000)) return null;
  if (prefixPart !== prefixOf(passwordHash)) return null;
  return userId;
}
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `npx vitest run test/unit/resetToken.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 5: Commit**

```bash
git add src/lib/resetToken.ts test/unit/resetToken.test.ts
git commit -m "feat(auth): signed single-use password reset tokens"
```

---

### Task 2: Reset email template and queue job

**Files:**
- Modify: `src/lib/emailTemplates.ts` (append at end of file)
- Modify: `src/services/email.ts` (lines 5-12 imports, 23-26 EmailJob union, after line 51 queueBookingCancelled, lines 110-118 processEmailJob)
- Test: `test/integration/email.test.ts` (append after the last booking test)

- [ ] **Step 1: Write the failing test**

Append to `test/integration/email.test.ts` (inside the existing `describe("email jobs")`):

```ts
  it("sends a password reset email with the reset link", async () => {
    const { sent, impl } = mailbox();

    const outcome = await processEmailJob(
      mailEnv as never,
      {
        kind: "password_reset",
        email: "wan@example.com",
        resetUrl: "https://app.example.com/reset-password?token=abc",
      },
      impl,
    );

    expect(outcome.status).toBe("sent");
    expect(sent).toHaveLength(1);
    expect(sent[0]!.to).toEqual(["wan@example.com"]);
    expect(sent[0]!.subject).toBe("Reset your MeetFlow password");
    expect(sent[0]!.text).toContain("https://app.example.com/reset-password?token=abc");
  });
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/integration/email.test.ts -t "password reset"`
Expected: FAIL with a TypeScript compile error — `"password_reset"` is not assignable to `EmailJob`.

- [ ] **Step 3: Add the template**

Append to `src/lib/emailTemplates.ts`:

```ts
/** Sent when a host requests a password reset. */
export function passwordReset(email: string, resetUrl: string): EmailMessage {
  const { html, text } = render({
    heading: "Reset your password",
    intro: "We received a request to reset the password for your MeetFlow account.",
    rows: [["Account", email]],
    note: "This link expires in 30 minutes. If you didn't request a reset, ignore this email — your password won't change.",
    cta: { label: "Reset password", href: resetUrl },
    footer: "MeetFlow · Booking pages that respect your time",
  });
  return { to: email, subject: "Reset your MeetFlow password", html, text };
}
```

- [ ] **Step 4: Extend the job union and consumer**

In `src/services/email.ts`, extend the template import (line 5-11 block) with `passwordReset,` (alphabetical position, after `hostNotification`).

Change the `EmailJob` union to:

```ts
export type EmailJob =
  | { kind: "booking_confirmed"; bookingId: number; to: "guest" | "host" }
  | { kind: "booking_cancelled"; bookingId: number; to: "guest" | "host" }
  | { kind: "booking_reminder"; bookingId: number; to: "guest" }
  | { kind: "password_reset"; email: string; resetUrl: string };
```

After `queueBookingCancelled` add:

```ts
/**
 * Reset links carry their own credential (the signed token), so the job holds
 * the rendered destination rather than a booking id. A stale link — password
 * already changed, or past 30 minutes — simply fails verification at the page.
 */
export async function queuePasswordReset(env: Env, email: string, resetUrl: string): Promise<void> {
  await enqueue(env, [{ kind: "password_reset", email, resetUrl }]);
}
```

In `processEmailJob`, insert BEFORE the `loadContext` call:

```ts
  if (job.kind === "password_reset") {
    return sendEmail(
      { apiKey: env.RESEND_API_KEY, from: env.EMAIL_FROM },
      passwordReset(job.email, job.resetUrl),
      fetchImpl,
    );
  }
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run test/integration/email.test.ts -t "password reset"`
Expected: PASS.

- [ ] **Step 6: Run typecheck**

Run: `npx tsc --noEmit`
Expected: clean (the early return narrows `job` for the rest of `processEmailJob`).

- [ ] **Step 7: Commit**

```bash
git add src/lib/emailTemplates.ts src/services/email.ts test/integration/email.test.ts
git commit -m "feat(email): password reset template and queue job"
```

---

### Task 3: Auth service and DB helpers

**Files:**
- Modify: `src/db/users.ts` (append after `setAvatarKey`)
- Modify: `src/services/auth.ts`
- Test: `test/integration/passwordReset.test.ts` (create)

- [ ] **Step 1: Write the failing test**

Create `test/integration/passwordReset.test.ts`:

```ts
import { SELF, env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { signResetToken } from "../../src/lib/resetToken";
import {
  requestPasswordReset,
  resetPassword,
  resolveResetToken,
} from "../../src/services/auth";
import { createHost, resetDb } from "../helpers";

const SECRET = env.SESSION_SECRET;

async function tokenFor(hostId: number): Promise<string> {
  const row = await env.DB.prepare("SELECT password_hash FROM users WHERE id = ?")
    .bind(hostId)
    .first<{ password_hash: string }>();
  if (!row) throw new Error("user not found");
  return signResetToken(hostId, row.password_hash, SECRET);
}

describe("password reset service", () => {
  beforeEach(resetDb);

  it("resolves a valid token to the user id", async () => {
    const host = await createHost("wan");
    const token = await tokenFor(host.id);
    await expect(resolveResetToken(env.DB, token, SECRET)).resolves.toBe(host.id);
  });

  it("resolves garbage and tampered tokens to null", async () => {
    await createHost("wan");
    await expect(resolveResetToken(env.DB, "garbage", SECRET)).resolves.toBeNull();
    await expect(resolveResetToken(env.DB, "a.b.c.d", SECRET)).resolves.toBeNull();
  });

  it("resetting the password kills previously issued tokens", async () => {
    const host = await createHost("wan");
    const token = await tokenFor(host.id);

    const result = await resetPassword(env.DB, token, "newpass123", SECRET);
    expect(result).toEqual({ ok: true });

    await expect(resolveResetToken(env.DB, token, SECRET)).resolves.toBeNull();
    const again = await resetPassword(env.DB, token, "another123", SECRET);
    expect(again).toEqual({ ok: false, reason: "invalid_token" });
  });

  it("rejects a password shorter than 8 characters", async () => {
    const host = await createHost("wan");
    const token = await tokenFor(host.id);
    const result = await resetPassword(env.DB, token, "short", SECRET);
    expect(result).toEqual({ ok: false, reason: "password" });
  });

  it("queues a reset email for a known address and nothing for an unknown one", async () => {
    await createHost("wan");
    const spy = vi.spyOn(env.EMAIL_QUEUE as never, "sendBatch").mockResolvedValue(undefined);

    await requestPasswordReset(env, "wan@example.com");
    expect(spy).toHaveBeenCalledTimes(1);
    const batch = spy.mock.calls[0]![0] as Array<{ body: { kind: string; email: string; resetUrl: string } }>;
    expect(batch).toHaveLength(1);
    expect(batch[0]!.body.kind).toBe("password_reset");
    expect(batch[0]!.body.email).toBe("wan@example.com");
    expect(batch[0]!.body.resetUrl).toContain("/reset-password?token=");

    spy.mockClear();
    await requestPasswordReset(env, "nobody@example.com");
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
  });

  it("updates the password hash so login follows the new password", async () => {
    const host = await createHost("wan");
    const token = await tokenFor(host.id);

    const result = await resetPassword(env.DB, token, "newpass123", SECRET);
    expect(result).toEqual({ ok: true });

    const login = (password: string) =>
      SELF.fetch("https://example.com/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "wan@example.com", password }),
      });

    expect((await login("hunter2hunter2")).status).toBe(401);
    expect((await login("newpass123")).status).toBe(200);
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `npx vitest run test/integration/passwordReset.test.ts`
Expected: FAIL — `services/auth` has no `resolveResetToken` export.

- [ ] **Step 3: Add the DB helpers**

Append to `src/db/users.ts`:

```ts
export async function getUserRowById(db: D1Database, id: number): Promise<UserRow | null> {
  return db.prepare("SELECT * FROM users WHERE id = ?").bind(id).first<UserRow>();
}

export async function updatePasswordHash(
  db: D1Database,
  userId: number,
  passwordHash: string,
  now: string,
): Promise<void> {
  await db
    .prepare("UPDATE users SET password_hash = ?, updated_at = ? WHERE id = ?")
    .bind(passwordHash, now, userId)
    .run();
}
```

- [ ] **Step 4: Add the service functions**

In `src/services/auth.ts`:

Extend the imports (top of file):

```ts
import { findUserByEmail, getUserRowById, insertUser, updatePasswordHash } from "../db/users";
import { b64urlDecode } from "../lib/hmac";
import { hashPassword, verifyPassword } from "../lib/password";
import { signResetToken, verifyResetToken } from "../lib/resetToken";
import { nowIso } from "../lib/time";
import { isValidTimeZone } from "../lib/timezone";
import { isAvailableSlug, isEmail } from "../lib/validate";
import { queuePasswordReset } from "./email";
import type { Env, PublicUser } from "../types";
```

(Keep the existing `AuthError`, `DUMMY_HASH`, `RegisterInput`, `register`, `login` unchanged.)

Append at the end of the file:

```ts
/**
 * Decodes the token's (unsigned, public) payload to learn which user to load,
 * then verifies the token against that user's CURRENT password hash. The hash
 * prefix check is what makes the link single-use.
 */
export async function resolveResetToken(
  db: D1Database,
  token: string,
  secret: string,
): Promise<number | null> {
  if (!token) return null;
  const encoded = token.split(".")[0] ?? "";
  let userId: number;
  try {
    const payload = new TextDecoder().decode(b64urlDecode(encoded));
    userId = Number(payload.split(":")[0]);
  } catch {
    return null;
  }
  if (!Number.isInteger(userId) || userId <= 0) return null;

  const user = await getUserRowById(db, userId);
  if (!user) return null;
  return verifyResetToken(token, user.password_hash, secret);
}

/**
 * Emails a reset link. The response contract is identical for known and
 * unknown addresses; the PBKDF2 dummy run equalises timing the same way
 * `login` does.
 */
export async function requestPasswordReset(env: Env, email: string): Promise<void> {
  const row = await findUserByEmail(env.DB, email.trim().toLowerCase());
  if (!row) {
    await verifyPassword("dummy-password", DUMMY_HASH);
    return;
  }
  const token = await signResetToken(row.id, row.password_hash, env.SESSION_SECRET);
  const resetUrl = `${env.APP_URL}/reset-password?token=${encodeURIComponent(token)}`;
  await queuePasswordReset(env, row.email, resetUrl);
}

export type ResetResult = { ok: true } | { ok: false; reason: "invalid_token" | "password" };

export async function resetPassword(
  db: D1Database,
  token: string,
  newPassword: string,
  secret: string,
): Promise<ResetResult> {
  if (newPassword.length < 8) return { ok: false, reason: "password" };
  const userId = await resolveResetToken(db, token, secret);
  if (userId === null) return { ok: false, reason: "invalid_token" };
  const passwordHash = await hashPassword(newPassword);
  await updatePasswordHash(db, userId, passwordHash, nowIso());
  return { ok: true };
}
```

- [ ] **Step 5: Run the test to verify it passes**

Run: `npx vitest run test/integration/passwordReset.test.ts`
Expected: PASS (6 tests).

- [ ] **Step 6: Run typecheck**

Run: `npx tsc --noEmit`
Expected: clean.

- [ ] **Step 7: Commit**

```bash
git add src/db/users.ts src/services/auth.ts test/integration/passwordReset.test.ts
git commit -m "feat(auth): request and apply password resets"
```

---

### Task 4: Pages, routes, limits, reserved slugs

**Files:**
- Modify: `src/views/auth.ts` (authShell options + layout call, loginPage, append three page fns)
- Modify: `src/routes/pages.ts` (imports ~line 40/49, routes after `/register` GET ~line 103, login GET line 100)
- Modify: `src/middleware/rateLimit.ts` (LIMITS, after `register` ~line 46)
- Modify: `src/lib/validate.ts` (RESERVED_SLUGS, after `"terms"` line 17)
- Test: `test/integration/passwordReset.test.ts` (append page tests)

- [ ] **Step 1: Write the failing tests**

Append to `test/integration/passwordReset.test.ts`:

```ts
describe("password reset pages", () => {
  beforeEach(resetDb);

  it("renders the forgot password page", async () => {
    const res = await SELF.fetch("https://example.com/forgot-password");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Reset your password");
    expect(html).toContain('action="/forgot-password"');
  });

  it("links to forgot password from the login page", async () => {
    const res = await SELF.fetch("https://example.com/login");
    const html = await res.text();
    expect(html).toContain("/forgot-password");
  });

  it("shows the toast on login after a reset", async () => {
    const res = await SELF.fetch("https://example.com/login?toast=Password%20updated");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Password updated");
    expect(html).toContain('class="toast"');
  });

  it("answers known and unknown emails with the same redirect", async () => {
    await createHost("wan");
    const post = (email: string): Promise<Response> =>
      SELF.fetch("https://example.com/forgot-password", {
        method: "POST",
        headers: { "content-type": "application/x-www-form-urlencoded" },
        body: new URLSearchParams({ email }).toString(),
        redirect: "manual",
      });

    const known = await post("wan@example.com");
    const unknown = await post("nobody@example.com");
    expect(known.status).toBe(302);
    expect(unknown.status).toBe(302);
    expect(known.headers.get("location")).toBe(unknown.headers.get("location"));

    const sent = await SELF.fetch("https://example.com/forgot-password?sent=1");
    expect(sent.status).toBe(200);
    expect(await sent.text()).toContain("If that email is registered");
  });

  it("renders the reset page for a valid token", async () => {
    const host = await createHost("wan");
    const token = await tokenFor(host.id);
    const res = await SELF.fetch(`https://example.com/reset-password?token=${encodeURIComponent(token)}`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Choose a new password");
    expect(html).toContain("confirm_password");
  });

  it("renders the invalid-link page for a bad token", async () => {
    const res = await SELF.fetch("https://example.com/reset-password?token=garbage");
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("expired or invalid");
  });

  it("resets the password end to end", async () => {
    const host = await createHost("wan");
    const token = await tokenFor(host.id);

    const res = await SELF.fetch(`https://example.com/reset-password?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ password: "newpass123", confirm_password: "newpass123" }).toString(),
      redirect: "manual",
    });
    expect(res.status).toBe(302);
    expect(res.headers.get("location")).toBe("/login?toast=Password%20updated");

    const login = (password: string) =>
      SELF.fetch("https://example.com/api/auth/login", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ email: "wan@example.com", password }),
      });
    expect((await login("hunter2hunter2")).status).toBe(401);
    expect((await login("newpass123")).status).toBe(200);

    const second = await SELF.fetch(`https://example.com/reset-password?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ password: "another123", confirm_password: "another123" }).toString(),
      redirect: "manual",
    });
    expect(second.status).toBe(400);
    expect(await second.text()).toContain("expired or invalid");
  });

  it("rejects mismatched passwords", async () => {
    const host = await createHost("wan");
    const token = await tokenFor(host.id);
    const res = await SELF.fetch(`https://example.com/reset-password?token=${encodeURIComponent(token)}`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ password: "newpass123", confirm_password: "different" }).toString(),
    });
    expect(res.status).toBe(400);
    expect(await res.text()).toContain("Passwords do not match");
  });

  it("throttles the forgot-password form", async () => {
    const { createExecutionContext, waitOnExecutionContext } = await import("cloudflare:test");
    const app = (await import("../../src/index")).default;
    const testEnv = {
      ...env,
      RATE_LIMIT_OVERRIDES: JSON.stringify({ "forgot-password": 2 }),
    } as unknown as Cloudflare.Env;

    const post = async () => {
      const ctx = createExecutionContext();
      const res = await app.fetch(
        new Request("https://example.com/forgot-password", {
          method: "POST",
          headers: { "content-type": "application/x-www-form-urlencoded", "cf-connecting-ip": "203.0.113.77" },
          body: new URLSearchParams({ email: "wan@example.com" }).toString(),
        }),
        testEnv,
        ctx,
      );
      await waitOnExecutionContext(ctx);
      return res;
    };

    expect((await post()).status).toBe(302);
    expect((await post()).status).toBe(302);
    expect((await post()).status).toBe(429);
  });
});
```

- [ ] **Step 2: Run the tests to verify they fail**

Run: `npx vitest run test/integration/passwordReset.test.ts -t "pages"`
Expected: FAIL — `/forgot-password` returns 404 (no route).

- [ ] **Step 3: Add the page views**

In `src/views/auth.ts`:

1. Extend `authShell` options with `toast?: string` and pass it to `layout(...)` (the layout call already passes `title`, `nav`, `width`, `body` — add `toast: options.toast`).
2. Change `loginPage` to:

```ts
export function loginPage(error?: string, toast?: string): string {
  return authShell({
    title: "Sign in",
    heading: "Sign in",
    blurb: "Welcome back to MeetFlow.",
    error,
    toast,
    formHtml: `
      <form class="space-y-4" method="post" action="/login">
        ${field({ name: "email", label: "Email", type: "email", placeholder: "you@example.com" })}
        ${passwordField()}
        <p class="text-right">
          <a class="text-[0.8125rem] font-medium text-muted underline underline-offset-4 hover:text-ink"
             href="/forgot-password">Forgot password?</a>
        </p>
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
```

3. Append the three new page functions at the end of the file:

```ts
export function forgotPasswordPage(options: { sent?: boolean; error?: string } = {}): string {
  return authShell({
    title: "Forgot password",
    heading: "Reset your password",
    blurb: options.sent
      ? "If that email is registered, a reset link is on its way."
      : "Enter your email and we'll send you a reset link.",
    error: options.error,
    formHtml: `
      <form class="space-y-4" method="post" action="/forgot-password">
        ${field({ name: "email", label: "Email", type: "email", placeholder: "you@example.com" })}
        <div class="pt-1">${button({
          label: "Send reset link",
          variant: "primary",
          size: "lg",
          type: "submit",
        })}</div>
      </form>`,
    footerHtml: `Remembered it? <a class="font-medium text-ink underline underline-offset-4 hover:text-primary-hover" href="/login">Sign in</a>`,
  });
}

export function resetPasswordPage(token: string, error?: string): string {
  return authShell({
    title: "Reset password",
    heading: "Choose a new password",
    blurb: "At least 8 characters.",
    error,
    formHtml: `
      <form class="space-y-4" method="post" action="/reset-password?token=${escapeHtml(encodeURIComponent(token))}">
        ${passwordField({ hint: "At least 8 characters.", attrsHtml: 'minlength="8"' })}
        ${field({
          name: "confirm_password",
          label: "Confirm password",
          type: "password",
          attrsHtml: 'minlength="8"',
        })}
        <div class="pt-1">${button({
          label: "Update password",
          variant: "primary",
          size: "lg",
          type: "submit",
        })}</div>
      </form>`,
    footerHtml: `<a class="font-medium text-ink underline underline-offset-4 hover:text-primary-hover" href="/forgot-password">Request a new link</a>`,
  });
}

export function invalidResetLinkPage(): string {
  return authShell({
    title: "Invalid link",
    heading: "This link is expired or invalid",
    blurb: "Reset links last 30 minutes and can only be used once.",
    formHtml: `<div class="text-center">${button({
      label: "Request a new link",
      href: "/forgot-password",
      variant: "primary",
      size: "lg",
    })}</div>`,
    footerHtml: `<a class="font-medium text-ink underline underline-offset-4 hover:text-primary-hover" href="/login">Back to sign in</a>`,
  });
}
```

- [ ] **Step 4: Add the routes**

In `src/routes/pages.ts`:

1. Extend the auth-view import (line 49): `import { forgotPasswordPage, invalidResetLinkPage, loginPage, registerPage, resetPasswordPage } from "../views/auth";`
2. Extend the auth-service import (line 40): add `resetPassword, resolveResetToken, requestPasswordReset` to the `{ AuthError, login, register }` import.
3. Change the `/login` GET (line 100) to pass the toast:

```ts
pageRoutes.get("/login", (c) =>
  c.get("user") ? c.redirect("/dashboard") : html(loginPage(undefined, readToast(c))),
);
```

4. After the `/register` GET block (line 103), before the legal pages, add:

```ts
const forgotLimit = rateLimit({
  ...LIMITS.forgotPassword,
  onLimited: () => html(forgotPasswordPage({ error: "Too many attempts. Please try again in an hour." }), 429),
});
const resetLimit = rateLimit({
  ...LIMITS.forgotPassword,
  onLimited: () => html(resetPasswordPage("", "Too many attempts. Please try again in an hour."), 429),
});

pageRoutes.get("/forgot-password", (c) =>
  c.get("user") ? c.redirect("/dashboard") : html(forgotPasswordPage({ sent: c.req.query("sent") === "1" })),
);

pageRoutes.post("/forgot-password", forgotLimit, async (c) => {
  const form = await c.req.parseBody();
  await requestPasswordReset(c.env, String(form.email ?? ""));
  return c.redirect("/forgot-password?sent=1", 302);
});

pageRoutes.get("/reset-password", async (c) => {
  const token = c.req.query("token") ?? "";
  const userId = await resolveResetToken(c.env.DB, token, c.env.SESSION_SECRET);
  if (userId === null) return html(invalidResetLinkPage(), 400);
  return html(resetPasswordPage(token));
});

pageRoutes.post("/reset-password", resetLimit, async (c) => {
  const token = c.req.query("token") ?? "";
  const form = await c.req.parseBody();
  const password = String(form.password ?? "");
  if (password !== String(form.confirm_password ?? "")) {
    return html(resetPasswordPage(token, "Passwords do not match"), 400);
  }
  const result = await resetPassword(c.env.DB, token, password, c.env.SESSION_SECRET);
  if (!result.ok) {
    if (result.reason === "password") {
      return html(resetPasswordPage(token, "Password must be at least 8 characters"), 400);
    }
    return html(invalidResetLinkPage(), 400);
  }
  return c.redirect("/login?toast=Password%20updated", 302);
});
```

- [ ] **Step 5: Add the rate limit bucket**

In `src/middleware/rateLimit.ts`, after the `register` entry (line 46):

```ts
  /**
   * Unauthenticated and sends email on a hit, so a low hourly budget keeps
   * both CPU and mailbox abuse cheap. Shared by the forgot and reset forms.
   */
  forgotPassword: { bucket: "forgot-password", limit: 5, periodSeconds: 3600 },
```

- [ ] **Step 6: Reserve the slugs**

In `src/lib/validate.ts`, after `"terms"`:

```ts
  "forgot-password",
  "reset-password",
```

- [ ] **Step 7: Run the tests to verify they pass**

Run: `npx vitest run test/integration/passwordReset.test.ts`
Expected: PASS (16 tests).

- [ ] **Step 8: Run the full check**

Run: `npm test && npx tsc --noEmit && npx prettier --check src/views/auth.ts src/routes/pages.ts src/middleware/rateLimit.ts src/lib/validate.ts test/integration/passwordReset.test.ts`
Expected: all green.

- [ ] **Step 9: Commit**

```bash
git add src/views/auth.ts src/routes/pages.ts src/middleware/rateLimit.ts src/lib/validate.ts test/integration/passwordReset.test.ts
git commit -m "feat(auth): forgot and reset password pages"
```

---

### Task 5: Manual verification and deploy

**Files:** none (verification only)

- [ ] **Step 1: Deploy**

Run: `npm run deploy`
Expected: new version uploaded.

- [ ] **Step 2: Verify the request flow**

```bash
curl -sI https://meetflow.wmafendi.workers.dev/forgot-password | head -2
```
Expected: 200 text/html.

- [ ] **Step 3: Verify end to end in the browser**

On production: sign out → open `/login` → click "Forgot password?" → submit an account email → check the inbox for "Reset your MeetFlow password" → click the link → set a new password → confirm redirect to `/login` with the "Password updated" toast → sign in with the new password. Then reuse the old link: confirm the "expired or invalid" page.

---

## Self-review notes

- Spec coverage: token (Task 1), template + job + queue helper (Task 2), DB helpers + service (Task 3), pages/routes/limits/slugs + login link/toast (Task 4), verification (Task 5). Spec's "Out of scope" items are not implemented. Enumeration-resistant response tested in Task 4 ("answers known and unknown emails with the same redirect"); timing equalization implemented via the `DUMMY_HASH` run in `requestPasswordReset`.
- Placeholders: none — all steps contain complete code and commands.
- Type consistency: `signResetToken(userId, passwordHash, secret)`, `verifyResetToken(token, passwordHash, secret)`, `resolveResetToken(db, token, secret)`, `requestPasswordReset(env, email)`, `resetPassword(db, token, newPassword, secret)` → `ResetResult`, `queuePasswordReset(env, email, resetUrl)`, `passwordReset(email, resetUrl)`, `tokenFor(hostId)` helper, bucket `"forgot-password"` used consistently across Tasks 3-4.