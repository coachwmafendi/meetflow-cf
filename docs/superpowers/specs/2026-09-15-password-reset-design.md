# Design: Forgot-password flow

Date: 2026-09-15 · Status: approved by user

Email-based password reset: the host enters their email on `/forgot-password`, a
signed one-time link (30-minute expiry) is emailed, and a dedicated
`/reset-password?token=…` page collects the new password. After saving, the user
lands on `/login` with a success toast. No session is issued by the reset flow.

## Reset token (`src/lib/resetToken.ts`)

Same machinery as `cancelToken.ts`: purpose-bound HMAC token, stateless — **no
migration needed**.

- Purpose: `"password-reset"`.
- Payload: `userId:exp:pwdPrefix` where `exp` is unix seconds (now + 30 min) and
  `pwdPrefix` is the first 8 characters of the user's **current** password hash.
- `signResetToken(userId, passwordHash, secret)` returns the token;
  `verifyResetToken(token, passwordHash, secret)` returns the userId when the
  signature, purpose, expiry, and prefix all match, else null.
- Single-use falls out of the prefix check: once the password changes, the old
  hash no longer matches, so every previously issued link dies. A repeated POST
  with the same token hits the changed hash and is rejected.
- Prefix comparison is plain string equality; it is not secret material (the
  full hash never leaves D1).

## Pages and routes (`src/routes/pages.ts`, `src/views/auth.ts`)

- **`GET /forgot-password`** — single email field; links back to login.
- **`POST /forgot-password`** — rate-limited (new `forgotPassword` bucket:
  5/hour, same IP key as the other unauthenticated buckets). Response is
  identical whether or not the email exists: a generic "If that email is
  registered, we've sent a reset link." (no account enumeration). When the user
  exists: sign a token, build the absolute URL from `APP_URL`, enqueue
  `{ kind: "password_reset", email, resetUrl }` on `EMAIL_QUEUE`. When not:
  verify against `DUMMY_HASH` (reuse the `login` trick in
  `src/services/auth.ts`) so timing does not leak existence, and enqueue
  nothing. Throttled form submissions re-render the page with the retry
  message, using the existing `throttled()` helper.
- **`GET /reset-password?token=…`** — new password + confirm fields. Renders a
  400-page ("This link is expired or invalid") with a link to
  `/forgot-password` when the token is missing, malformed, expired, or fails
  verification.
- **`POST /reset-password`** — token comes from the query string (kept in a
  hidden field); verifies the token against the stored hash, validates the new
  password with the same rule as registration (min 8 chars) and that both
  fields match, saves the new hash via a new
  `updatePasswordHash(db, userId, hash)` in `src/db/users.ts`, then redirects
  to `/login?toast=Password%20updated`. Failure
  re-renders the page with the error and the preserved token.
- **Login page** gains a "Forgot password?" link under the form, and toast
  support (`loginPage(toast)`), rendered via the existing layout toast option
  (`src/views/layout.ts`); the `/login` route passes `?toast=` through.

## Email (`src/lib/emailTemplates.ts`, `src/services/email.ts`)

- New `passwordReset(email, resetUrl)` template matching the look of the
  existing booking templates (subject "Reset your MeetFlow password", the
  absolute reset link as the primary button).
- `EmailJob` gains `{ kind: "password_reset"; email: string; resetUrl: string }`.
  Unlike booking jobs it carries no DB id: the token itself is the credential,
  and a stale link (password already changed, or 30 minutes passed) simply
  fails verification. The consumer (`processEmailJob` switch) sends it via the
  existing Resend path.
- New `queuePasswordReset(env, email, resetUrl)` helper following
  `enqueue()` — never throws.

## Rate limiting

`LIMITS` gains:

```
forgotPassword: { bucket: "forgot-password", limit: 5, periodSeconds: 3600 },
```

The JSON API has no reset endpoints — this is HTML-form-only, so one bucket
suffices.

## Security details

- Tokens are never logged; the reset URL is built only from `APP_URL` plus the
  token, and only ever sent by email.
- Token verification failure modes are indistinguishable to the caller (single
  generic error), and the forgot form never reveals which emails are registered.
- No auto-login and no session revocation: the flow only replaces the hash.
- The reset page is unauthenticated by design; the token is the credential, and
  its 30-minute window plus single-use bounds exposure (same accepted trade-off
  as guest cancel links).

## Testing

- **Unit (`test/unit/resetToken.test.ts`)**: sign/verify round-trip; wrong
  purpose; tampered payload/signature; expired token rejected; prefix mismatch
  after a password change; garbage input returns null.
- **Integration (`test/integration/`)**:
  - `GET /forgot-password` and `GET /reset-password?token=…` render.
  - `POST /forgot-password` with an unknown email and with a known email return
    the **same** page and message; the known-email case enqueues a
    `password_reset` job (assert via the queue consumer/test pattern used for
    booking emails) and the unknown case does not.
  - `POST /reset-password` happy path: password changes, login works with the
    new password and fails with the old, and a second POST with the same token
    is rejected.
  - Invalid/expired token POST returns the 400 page.
  - Forgot form is rate-limited (6th request in the hour gets the throttled
    re-render).
  - Login page contains the "Forgot password?" link.

## Out of scope

- OTP codes, security questions, passwordless login.
- Session revocation on reset (would need session versioning in D1).
- Letting users change their password from settings while logged in (separate
  feature; this flow is only the unauthenticated reset).