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
authMiddleware (all of /api/v1 except /auth/login, /refresh, /logout):
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
                      sheet, money, tz, deps
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
   it asserts on. Mirror the type in `apps/web/src/types/api.ts`.

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
