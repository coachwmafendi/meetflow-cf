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
`npm run typecheck` runs `tsc --noEmit`.

## Deploy

```bash
npx wrangler d1 create meetflow-db          # once; copy the id into wrangler.jsonc
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

## Layout

- `src/lib/` — pure, dependency-free logic (time, timezone, slots, crypto, validation)
- `src/db/` — the only files containing SQL
- `src/services/` — business rules (auth, availability, booking)
- `src/routes/` — HTTP surface (`api.*.ts` for JSON, `pages.ts` for HTML)
- `src/views/` — HTML strings
- `migrations/` — D1 schema

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
- **Rate limiting**: `POST …/book` is capped at 10/min per client IP (`CF-Connecting-IP`,
  edge-set and unspoofable). Over the limit returns `429` + `Retry-After`. The middleware
  fails open if the binding is absent — losing rate limiting beats losing the booking
  endpoint. `RATE_LIMIT_MAX` overrides the limit per environment.
- **Why a Durable Object and not the Rate Limiting binding**: the `ratelimits` binding
  configures cleanly and shows up in `wrangler deploy` output, but never rejects on this
  account — verified in production at `limit: 2, period: 60` with 8 sequential requests
  from one IP, all allowed. The `RateLimiter` DO keeps a fixed-window counter per
  `bucket:ip`; a DO handles one request at a time, so the read-modify-write is atomic
  and the count is exact and global rather than per-colo.
