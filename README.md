# MeetFlow

Cal.com-style scheduling on Cloudflare Workers + D1.
Specs: [PRD.md](PRD.md), [ERD.md](ERD.md). Plan: [docs/superpowers/plans](docs/superpowers/plans).

A host registers, defines weekly availability and event types, and gets a public booking page
at `/<username>/<event-slug>`. Guests book without an account. Double booking is impossible.

## Develop

```bash
npm install
echo "SESSION_SECRET=local-dev-secret-change-me" > .dev.vars
npm run db:migrate:local
npm run dev
```

Then open http://localhost:8787.

## Test

```bash
npm test
```

Tests run inside `workerd` with a real local D1 via `@cloudflare/vitest-pool-workers`.

```bash
npm run check
```

Runs `format:check`, `typecheck` and `test` together — the same three gates as CI would.
`npm run format` rewrites files in place.

Prettier is configured at `printWidth: 100`, chosen by measuring the existing code (p95 = 87
columns) and comparing churn across widths — 80 rewrote 1036 lines, 100 rewrote 109.
`wrangler.jsonc` is excluded from trailing commas so it stays readable by strict JSON parsers,
and the generated `worker-configuration.d.ts` plus the plan documents are left alone entirely.

## Infrastructure

| Binding        | Resource       | Purpose                    |
| -------------- | -------------- | -------------------------- |
| `DB`           | D1             | Source of truth            |
| `RATE_LIMITER` | Durable Object | Exact per-IP rate limiting |
| `AVATARS`      | R2             | Host profile photos        |
| `ASSETS`       | Workers Assets | CSS, fonts, Alpine         |
| `EMAIL_QUEUE`  | Queues         | Transactional email        |

## Deploy

```bash
npx wrangler d1 create meetflow-db          # once; copy the id into wrangler.jsonc
npx wrangler r2 bucket create meetflow-avatars
npx wrangler queues create meetflow-emails
npx wrangler queues create meetflow-emails-dlq
npx wrangler secret put RESEND_API_KEY       # optional; without it email is simply off
npx wrangler secret put SESSION_SECRET      # a long random string
npm run db:migrate:remote
npm run deploy
```

Generate a secret with:

```bash
node -e "console.log(crypto.randomUUID() + crypto.randomUUID())"
```

After changing bindings in `wrangler.jsonc`, re-run `npx wrangler types` to refresh
`worker-configuration.d.ts`.

## Features

Host: register, sign in, event types (create/edit/activate/deactivate/delete), weekly
availability with multiple windows per day, bookings list with cancel, avatar upload,
timezone, light/dark/system theme.

Guest: public profile, booking page with live slot availability, confirmation page. No account
needed.

## Email

Transactional email goes through Resend, called over its REST API — no SDK, so the runtime
dependency list stays at `hono` and `alpinejs`.

| Trigger         | Recipient                                        |
| --------------- | ------------------------------------------------ |
| Booking created | Guest (confirmation) and host (new booking)      |
| Host cancels    | Guest                                            |
| 24 hours before | Guest (reminder, queued by an hourly cron sweep) |

Sending is off the request path: routes enqueue a job and return immediately, so a slow or
failing Resend never delays a booking. Jobs carry **only a booking id** — the consumer re-reads
from D1 at send time, so a booking cancelled between enqueue and delivery is skipped rather
than confirmed, and a retry can never deliver stale details.

Failures are classified: 429 and 5xx are retried by the queue, 4xx is acked so one bad address
cannot block a batch, and three failed attempts land in `meetflow-emails-dlq`.

**Without `RESEND_API_KEY` the app works normally and simply sends nothing** — the send returns
`skipped`, not an error.

Two things must be set before real mail flows:

1. `npx wrangler secret put RESEND_API_KEY`
2. Verify a sending domain in Resend, then set `EMAIL_FROM` in `wrangler.jsonc` to an address
   at that domain. The default (`onboarding@resend.dev`) only delivers to your own Resend
   account address.

## Guest cancellation

Guest-facing emails and the confirmation page carry a signed cancellation link. There is no
guest account, so the token _is_ the authorisation: an HMAC over the booking id, signed under
its own purpose string so it can never be replayed as a session cookie, and checked against the
id in the path so a valid token cannot be pointed at a different booking.

Following the link is a **GET that only renders a confirmation page** — mail scanners and link
prefetchers follow GETs and would otherwise cancel meetings silently. The cancellation itself is
a POST. Cancelling is idempotent, refuses meetings that already happened, and notifies the host.

## Layout

- `src/lib/` — pure, dependency-free logic (time, timezone, slots, crypto, validation)
- `src/db/` — the only files containing SQL
- `src/services/` — business rules (auth, availability, booking)
- `src/routes/` — HTTP surface (`api.*.ts` for JSON, `pages.ts` for HTML)
- `src/views/` — HTML strings
- `migrations/` — D1 schema
- `src/styles/app.css` — design tokens and component classes
- `src/views/ui.ts` — the component layer (button, field, table, badge, avatar, icons…)

## Design notes

- **No interactive transactions in D1.** Bookings are created with a single atomic
  `INSERT ... SELECT ... WHERE NOT EXISTS`, backed by a partial unique index on
  `(user_id, start_at) WHERE status = 'confirmed'`. Concurrent submissions for one slot
  yield exactly one confirmed booking; the losers get `409`.
- **Timestamps** are fixed-width ISO-8601 UTC (`YYYY-MM-DDTHH:MM:SSZ`) so SQLite's
  lexicographic TEXT ordering equals chronological ordering.
- **Timezones** use `Intl.DateTimeFormat` + `formatToParts` (full ICU ships in `workerd`),
  so DST is handled without a date library.
- **Passwords** use PBKDF2-SHA256 via Web Crypto; `bcrypt`/`argon2` are native and do not
  run on Workers. Sessions are stateless HMAC-signed cookies, so there is no `sessions` table.
- **`422` vs `409`**: `422` means the time was never a valid slot; `409` means it was valid
  but is already taken, which is what makes the client refresh its slot list.
- **Rate limiting**: per client IP (`CF-Connecting-IP`, edge-set and unspoofable) — booking
  10/min, login 10/min, registration 5/hour. Over the limit returns `429` + `Retry-After`;
  throttled HTML form posts re-render the page with the error instead of returning JSON.
  A given action's JSON API and HTML form share one counter (`LIMITS` in
  `src/middleware/rateLimit.ts`), so alternating entry points does not double the budget.
  Auth limits also cap CPU: every login attempt runs PBKDF2 at 100k iterations, even for an
  unknown email. The middleware fails open if the binding is absent — losing rate limiting
  beats losing the endpoint. Limits are tunable per bucket with `RATE_LIMIT_OVERRIDES`, a JSON
  object like `{"book":50}` — deliberately per-bucket, since one global override would raise
  the auth limits too. Malformed or non-positive values are ignored rather than read as
  unlimited, so a typo can never silently disable a limit.
- **Why a Durable Object and not the Rate Limiting binding**: the `ratelimits` binding
  configures cleanly and shows up in `wrangler deploy` output, but never rejects on this
  account — verified in production at `limit: 2, period: 60` with 8 sequential requests
  from one IP, all allowed. The `RateLimiter` DO keeps a fixed-window counter per
  `bucket:ip`; a DO handles one request at a time, so the read-modify-write is atomic
  and the count is exact and global rather than per-colo. Being a _fixed_ window, a caller
  straddling a boundary can get up to 2× the limit across the two adjacent windows — fine
  for an abuse guard. Switch to a sliding window if that ever matters.
