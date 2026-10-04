# Backend dev guide

How the Go API in `apps/api` is put together and how to change it. The rules
themselves (RBAC, WIB dates, invoice rounding, migrations, testing tiers) live
in `CLAUDE.md`; this page shows where they sit in the code.

## 1. Request path

```
HTTP request
    ↓
chi router (internal/app/router.go): request id, logging, recover, timeouts,
    security headers, 2 MiB body limit, CORS, then /api/v1
    ↓
authMiddleware (all of /api/v1 except /auth/login, /refresh, /logout;
    refresh and logout sit behind session.Guard instead):
    verifies the JWT, loads role, is_active and session_version
    ↓
requireRole / readOnlyFor at the subtree mount
    ↓
Handler (internal/<feature>/handler.go): decode, validate, call the repo,
    render JSON or RFC 7807
    ↓
Repo (internal/<feature>/repo.go): named SQL from queries.Store, pgx scan
    ↓
PostgreSQL: tables, triggers, plpgsql functions
```

- Handlers hold no SQL. Repos hold no HTTP.
- DTOs in `dto.go` carry both `db:"..."` (pgx `RowToStructByName`) and
  `json:"..."` (camelCase) tags.
- Business rules that must hold under concurrency live in plpgsql functions
  that lock the row they change. Go mirrors their tables for display
  (`Transitions`, `StatusLabel`) and a test keeps the two equal.

### Sessions and CORS

The refresh token lives only in a cookie; no response body carries it.

- Login and refresh set `gns_refresh`: HttpOnly, Secure, SameSite=Strict,
  `Path=/api/v1/auth`, no `Domain` (host-only on the API host) and no
  `Max-Age` or `Expires`: a browser-session cookie, with the server-side
  `REFRESH_TOKEN_EXPIRY` as the real limit.
  `shared/session.Cookies` builds it; it drops Secure only when `ENV` is
  `development` and the request reached the API over plain http on a
  loopback host, which is `make dev`. Production sits behind Traefik, where
  the request is plain http too, so the environment alone keeps Secure on.
- `POST /auth/refresh` reads only the cookie and ignores any body. A missing
  cookie is a 401 (`Anda belum masuk…`); every other refusal (unknown,
  expired, revoked, reused) is a 401 with its own detail. Rotation, reuse
  detection and `session_version` are unchanged. A rotated token presented
  again within 10 seconds of its rotation (`refreshReuseGrace`) is a race,
  such as a second tab or a retried request, not a replay: it is the same
  401 `reused` detail, but it keeps the user's other sessions and leaves the
  cookie alone (`ErrRacedRefresh`), because the browser's one cookie jar may
  already hold the winner's fresh token. Past that window it is a replay:
  every refresh token of the user is revoked and `session_version` is
  bumped, so the access tokens minted from the stolen chain die on their
  next request too, and the cookie is expired. The blast runs in its own
  transaction after the refusal, since upgrading the refresh's share lock
  on the users row would deadlock two concurrent replays. It bumps the
  version before it revokes the tokens, taking the users row before any
  token row as a refresh and a users change do, so a blast that meets a
  rotation of the stolen chain waits for it and then revokes the successor
  it minted, instead of deadlocking with it. A replayed token
  whose session already ended (minted under an older version) is just
  `revoked` and ends nothing, so a stolen token cannot keep signing out the
  logins that follow. The cost
  of keeping the cookie: when the winner's response itself is lost, the jar
  still holds the rotated token, and an attempt past the window counts as a
  replay. The web makes refresh single-flight across tabs (Web Locks), so
  two tabs of one browser do not race in the first place.
- Refresh and logout are the only routes that authenticate by cookie, so
  `session.Guard` sits in front of both, before the rate limiter. It answers
  403 with an Indonesian detail when `Origin` is missing, `null` or not in
  `CORS_ALLOWED_ORIGINS`, and when the `X-GNS-CSRF: 1` header is absent. A
  cross-origin page cannot add that header without a preflight, and the
  preflight passes only for a listed origin.
- The cookie is expired (`Max-Age=0`, same name, path and Secure) by logout,
  by every refresh refusal except a race inside the grace window, by a
  successful or session-ending `PATCH /auth/me/password`, and by a users edit that ends the caller's own
  session (own role change, own deactivation, own password reset). When an
  admin revokes someone else, that user's cookie is expired by their next
  refresh, which the revoked token fails. An outage (5xx) or a 429 leaves
  the cookie alone, so the client can retry.
- CORS (`go-chi/cors`) sends `Access-Control-Allow-Credentials: true` and
  reflects the origin only for an exact entry of `CORS_ALLOWED_ORIGINS`,
  through the same matcher the guard uses. `AllowedOrigins` stays unset
  because the library reads an empty list or `*` there as any origin. Config
  refuses `*`, an empty list, or any entry that is not
  `scheme://host[:port]` in every environment; the default is the dev SPA,
  `http://localhost:5174`.
- Login guessing is slowed, never locked out: after five misses each attempt
  waits 250 ms before the password check, doubling to a 4 s ceiling, and
  still answers the neutral 401. An account counts misses in
  `users.failed_login_attempts`; an unknown or deactivated address counts
  them in a bounded in-memory table (`auth/misscounter.go`, one API
  replica) and pays the same delay and bcrypt work, so timing never tells
  whether an address is a live account. Login trims and lower-cases the
  address once (`normalizeEmail`), so every spelling reaches one count.
  Two residual risks are accepted: the table keeps 10,000 addresses, so
  flushing a probed one costs 10,000 misses elsewhere (100 minutes from one
  IP, about two from 50); and a restart empties it while the column
  survives, so an address probed past five misses before a deploy shows
  whether it is an account on its first attempt afterwards.
- Browsers apply a `Set-Cookie` on a cross-origin response only when the
  request was sent with credentials, so the SPA calls the auth routes with
  `credentials: "include"`.

## 2. Layout

```
cmd/api/              entry point; -bootstrap migrates and creates the
                      superadmin, then exits;
                      -healthcheck probes /readyz
cmd/orphan-blobs/     unreferenced MinIO object sweeper
cmd/pdfsmoke/         renders sample PDFs for one record
internal/app/         config, router, middleware, background loops
internal/<feature>/   routes.go, handler.go, repo.go, dto.go, tests,
                      acceptance/ (godog)
internal/shared/      db, httperr, httpx, paginate, listq, assetproxy,
                      sheet, money, tz, deps, session
db/queries/           <feature>.sql named queries, required.go
db/functions/         current body of every database function
db/migrations/        goose migrations
```

## 3. Adding an endpoint

1. Write the SQL in `db/queries/<feature>.sql` under a `-- name:
   <feature>.<key>` header. Parameters are positional (`$1`), never
   concatenated user input.
2. Add the key to `RequiredKeys` in `db/queries/required.go` in the same
   commit. `Load()` fails at startup when a required key is missing.
3. Add a repo method that runs `r.store.Get("<feature>.<key>")` through
   `r.db` (a `db.Executor`, so it works inside a transaction too).
4. Add the handler. Decode the body, validate into field errors
   (`httperr.Unprocessable(map[string]string{...})`), call the repo, and map
   database errors with `httperr.RenderDBErrCtx`. Lists go through
   `paginate`/`listq` and `httpx.WriteList`, which sets `X-Total-Count`.
5. Register the route in `routes.go`. The feature's mount in
   `internal/app/router.go` already carries its role gate; a mixed-access
   rule goes in the handler, with a negative test.
6. Add table-driven unit tests and an integration test that creates the rows
   it asserts on. Name every request and response type (no map or anonymous
   struct bodies), add it to `cmd/gentypes/allowlist.go`, and run
   `make gen-types`; commit the regenerated `apps/web/src/types/generated.ts`
   with the change. CI fails when it is stale.

## 4. Errors

Every error body is RFC 7807 `application/problem+json` from
`shared/httperr`. plpgsql functions raise typed SQLSTATEs, and
`httperr.FromDBErr` maps them:

| SQLSTATE | Meaning | HTTP |
|---|---|---|
| P0011 | Row not found | 404 |
| P0012 | Refused status transition | 422 |
| P0013 | Blocked by a related record | 409 |
| P0014 | Rejected input | 422 |
| 23505 / 23503 / 23502 / 23514 | unique / FK / not null / check | 409 / 404 / 422 / 422 |

P0012, P0013 and P0014 messages are Indonesian and reach the user as the
problem `detail`; write new ones in Indonesian. P0100 (unpriced product
lines) is caught by the quotations repo and returned as a field error.

## 5. Status machines

See the Status model section of `CLAUDE.md`. In code:

- `quotations/status.go`, `purchaseorders/transitions.go`,
  `invoices/transitions.go` hold the transition tables and labels.
- `fn_change_quotation_status`, `fn_change_po_status` and
  `fn_change_invoice_status` enforce them and write the history rows.
- `*_status_integration_test.go` walks every pair against the database.
- The detail DTOs carry `allowedTransitions`; the web renders nothing else.

## 6. Database functions and migrations

- A change to a function is a new migration with `CREATE OR REPLACE`,
  wrapped in `-- +goose StatementBegin` / `StatementEnd`.
- Then run `make db-functions-dump` so `db/functions/<name>.sql` matches the
  database; the drift test fails otherwise.
- Numbering and ordering rules: `db/migrations/README.md`.

## 7. Money, dates, files

- Money is `NUMERIC` in SQL and a string or `decimal.Decimal` in Go
  (`shared/money`). Never `float64` for amounts.
- Dates: the pool session runs in Asia/Jakarta, so `CURRENT_DATE` is the WIB
  date. Go formats dates through `shared/tz`.
- Files: MinIO is never exposed. `assetproxy.Upload` returns an upload URL
  that points at the API's own authenticated `/storage/object` proxy, which
  streams the bytes to MinIO; the browser then saves the object key with a
  PATCH. The key must sit under the record's own folder
  (`storage.OwnerFolder`), or the save is refused.

## 8. Running it

```bash
make dev          # Postgres, MinIO, API :8080, SPA :5174
make test-api     # Go suite on the throwaway gns_citest database
curl localhost:8080/healthz
curl localhost:8080/readyz
```

`README.md` covers first-time setup and the dev seed.
