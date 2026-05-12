# Architecture

See also: live-schema ERD in [`erd/`](./erd/) (regenerate via `make db-erd`), legacy [`relational_model.html`](./relational_model.html), ADRs in [`decisions/`](./decisions/).

## Context

PT Global Niaga Sakti ships marine supplies. Internal staff use this system to
issue **quotations** (with revisions), convert them to **purchase orders**
once a client accepts, and close the loop with **invoices** that export to
Indonesian Coretax (DJP) Excel templates.

## Shape

Modular monolith. Single Go binary (`apps/api`) exposes HTTP under
`/api/v1/*`, serves its own embedded goose migrations on boot, talks to
Postgres + MinIO. The React frontend (`apps/web`) is a static SPA served
separately via nginx.

```
[browser] ── Traefik ──┬── web (nginx/static)
                       └── api (Go, :8080) ── Postgres 17
                                           └── MinIO
```

Nothing in the monolith is shared state between requests except the pgx pool.
Worker split (`cmd/api` + `cmd/worker`) is a future refactor if LaTeX/Excel
rendering becomes a bottleneck — not now.

## Backend modules (`apps/api/internal/`)

| Module | Purpose |
|---|---|
| `app` | Wiring: config, server, chi router. |
| `auth` | Login, JWT issuance, RBAC middleware. |
| `users` | User CRUD (superadmin only). |
| `clients` | `company_client` + `company_contacts`. |
| `vendors` | Vendors + normalized contacts. |
| `items` | Item master + unit defaults. |
| `units` | Unit-of-measure master + Coretax code. |
| `pricing` | Fuzzy item match (pg_trgm + `item_request_matches`), vendor rank, margin suggest. |
| `quotations` | Quotation header + items, versioning via `parent_id`. |
| `pos` | Purchase orders + line items. |
| `invoices` | Invoices, items, and status transitions. |
| `documents` | LaTeX templates + tectonic compile → PDF → MinIO. |
| `tax` | Coretax Excel export (excelize). |
| `files` | MinIO client + signed URL issuance. |
| `audit` | `audit_logs` writer; every mutation writes a row in-tx. |
| `shared/db` | pgxpool, tx helper, pg error mapping, embedded migrations. |
| `shared/http` | chi helpers, request decoding, response rendering. |
| `shared/httperr` | Typed errors → `application/problem+json`. |
| `shared/validate` | validator/v10 wrapper. |
| `shared/paginate` | Cursor pagination utilities. |
| `shared/money` | `decimal.Decimal` helpers + Rupiah formatter. |
| `shared/tz` | `Asia/Jakarta` location helper. |

Each domain module holds: `types.go`, `queries.sql` (sqlc input),
`db.sql.go` (sqlc output), `service.go`, `handler.go`, `routes.go`.

## Data flow — quotation create (example)

1. `POST /api/v1/quotations` → `quotations.Handler.Create`.
2. Handler decodes + validates body, pulls `user_id` from JWT claim.
3. `service.Create(ctx, in, userID)` opens a tx via `shared/db.WithTx`.
4. In the tx: insert header → insert items → insert `audit_logs` row →
   commit.
5. Postgres GENERATED columns compute totals; `row_version` trigger bumps
   version on later updates. App never writes those columns.
6. Handler returns `201` with the created resource.

## Key disciplines

- **Money:** `decimal.Decimal` end-to-end. Never `float`. DB `NUMERIC(15,2)`.
- **Soft delete:** financial records get `deleted_at TIMESTAMPTZ NULL`. Hard
  delete is forbidden on anything referenced by a quotation/PO/invoice.
- **Snapshots, not FKs:** name/price fields on historical documents are
  captured at write time. Not enforced as FK so they don't drift when master
  data changes.
- **Timezone:** store UTC, render `Asia/Jakarta`. Done in one place per layer.
- **Audit rows:** every mutation writes `audit_logs` in the same tx as the
  mutation. No mutation bypasses the service layer.
- **Reconciliation:** `quotation_reconciliation` view asserts
  `SUM(items.total_selling) == header.total`. A scheduled job logs drifts.

## Deploy

Dokploy on a single VPS. Traefik terminates TLS and routes two hosts:
`${API_HOST}` → api:8080, `${WEB_HOST}` → web:80. Postgres + MinIO are
private on the internal network.
