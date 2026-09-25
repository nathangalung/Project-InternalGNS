# Architecture

See also: the schema reference in [`erd/`](./erd/) (regenerate with
`make db-erd`), ADRs in [`decisions/`](./decisions/), and `CLAUDE.md` for the
conventions and the status model. `relational_model.html` is the original design
draft and does not match the live schema.

## Context

PT Global Niaga Sakti ships marine supplies. Internal staff issue
**quotations** (with revisions), turn an accepted quotation into a
**purchase order**, deliver it with a **delivery note**, and close the loop
with an **invoice** that exports to the Coretax (DJP) XML and XLSX formats.

## Shape

Modular monolith. One Go binary (`apps/api`) serves HTTP under `/api/v1`,
applies its embedded goose migrations on boot, and talks to Postgres and
MinIO. The React SPA (`apps/web`) is built to static files and served by
Nginx on its own host.

```
[browser] ── Traefik ──┬── ${WEB_HOST}  frontend (nginx, static SPA)
                       └── ${API_HOST}  api (Go, :8080) ──┬── Postgres 18
                                                          └── MinIO
```

Postgres and MinIO sit on an internal-only network. The browser never reaches
MinIO: uploads and downloads go through presigned URLs issued by the API and
an authenticated proxy (`internal/storage`).

Two background loops run inside the API process: the refresh-token purge and
the quotation expiry job. Both stop with the server.

## Backend packages (`apps/api/internal/`)

| Package | Purpose |
|---|---|
| `app` | Config, router, middleware (auth, RBAC, rate limit, logging, CORS, body limit, timeouts), background loops. |
| `auth` | Login, JWT, refresh-token rotation, lockout, session version. |
| `users` | User management (superadmin only), superadmin seed. |
| `clients` | `company_client` and `company_contacts`, logos, client numbers. |
| `vendors` | Vendors, logos, items per vendor. |
| `items` | Product catalog, vendor prices, fuzzy search and request matching, images. |
| `units`, `countries` | Read-only master data. |
| `quotations` | Quotation header and lines, status machine, revisions, expiry job, item requests, PDF. |
| `purchaseorders` | PO lines, file upload, status machine and history, delivery-note PDF. |
| `invoices` | Invoice lines, status machine and history, payment proof, replacement, Coretax export, PDF. |
| `dashboard` | Summary, time series and XLSX export, with financial gating. |
| `pdfgen` | xelatex rendering of the LaTeX templates. |
| `storage` | MinIO client, bucket policy, object proxy. |
| `shared/*` | `db` (pool, migrations, tx, SQLSTATEs), `httperr` (RFC 7807), `httpx`, `paginate`, `listq`, `assetproxy`, `sheet`, `money`, `tz`, `deps`. |
| `testutil` | Test server, pool, cleanup and seed helpers. |

Each feature package holds `routes.go`, `handler.go`, `repo.go` and `dto.go`,
plus its tests and, for most, an `acceptance/` godog suite. SQL lives in
`db/queries/*.sql` as named queries (`-- name: <feature>.<key>`), loaded once
at startup; `db/queries/required.go` lists every key a repo reads.

## Data flow: accepting a quotation

1. `PATCH /api/v1/quotations/{id}/status` with `{"status":"accepted"}`
   reaches `quotations.Handler.ChangeStatus` behind
   `requireRole("superadmin","operational")`.
2. The repo calls `fn_change_quotation_status`. The function locks the row,
   checks the move against its transition table (mirrored by
   `quotations.Transitions`), refuses unpriced product lines, updates the
   status and writes `quotation_status_history`.
3. In the same transaction, `fn_create_purchase_order` snapshots the lines
   into a new PO in PENDING.
4. A refused move raises P0012 or P0014, which `httperr` turns into a 422
   whose detail is the function's Indonesian message.

Business rules that must hold under concurrency (status machines, document
numbers, invoice creation) live in plpgsql functions. `db/functions/` keeps
the current body of each one, checked against the database by a drift test.

## Key disciplines

- **Money:** `NUMERIC` in the database; Go uses `shopspring/decimal` in
  `shared/money` where it does arithmetic. Tax is rounded per line, then
  summed.
- **Snapshots, not FKs:** client, contact, item and price fields on documents
  are copied at write time, so a later master-data edit never changes a
  filed document.
- **Optimistic locking:** `row_version` triggers bump a version on each
  update. Quotation, PO and invoice edits send the version they read in
  `If-Match`, and a stale one gets a 409.
- **Timezone:** timestamps are stored as `timestamptz`; the pool session is
  pinned to Asia/Jakarta, so `CURRENT_DATE` and document periods are WIB.
- **History:** status changes are recorded in `quotation_status_history`,
  `po_status_history` and `invoice_status_history`. There is no generic audit
  log.
- **Reconciliation:** the `quotation_reconciliation` view compares line sums
  with header totals; `make check-reconcile` runs the checks.

## Deploy

Dokploy on a single VPS, from `compose.prod.yml`. Traefik terminates TLS and
routes `${API_HOST}` to the api and `${WEB_HOST}` to the frontend. Steps and
pre-deploy checks: `deploy_vps.md`. Backups: `backup_restore.md`.
