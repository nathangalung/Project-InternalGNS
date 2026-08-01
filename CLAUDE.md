# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project Overview

InternalGNS is the internal quotation to purchase-order to invoice system for
PT Global Niaga Sakti. It is a Go REST API and a React single-page app in a
Bun-managed monorepo.

- Backend (`apps/api`): Go 1.25, Chi v5 router, pgx v5 against PostgreSQL,
  Goose migrations, JWT auth with role-based access, slog logging. SQL is
  hand-written in `.sql` files that are embedded and parsed at startup
  (`apps/api/db/queries`); there is no ORM or code generator.
- Frontend (`apps/web`): React 19 with strict TypeScript, Vite 7, TanStack
  Router/Query/Table, Bun runtime, Biome for lint and format. Styling is
  Tailwind CSS v4: shared class-string primitives in `src/lib/ui.ts` and the
  `Modal` shell in `src/components/shared`, with `src/styles/design-tokens.css`
  (the brand scale) and a small `src/styles/layout.css` (app shell + page
  scaffold) as the only stylesheets. Preflight is off. Responsive down to 320px.
- Infra: PostgreSQL 18, MinIO for object storage, xelatex for PDF rendering,
  Dokploy with Traefik for deployment, Nginx to serve the built frontend.

## Roles

Three roles, enforced in the frontend (`src/lib/rbac.ts` plus route guards) and
the backend (`requireRole` middleware in `internal/app`):

- superadmin: everything, including user management.
- operational: quotations, purchase orders, and the shared master data. No
  invoices, financial dashboard, or user management.
- finance: invoices and the financial dashboard, plus the shared master data. No
  quotations or purchase orders.

Everyone reaches the overview dashboard, clients, vendors, and products.
Financial figures (revenue, expenses, profit, PPN, invoice totals) are limited
to superadmin and finance at both layers, including the dashboard endpoints.

## Essential Commands

Run from the repo root.

```bash
make dev            # Postgres, API (:8080), and the SPA (:5174) together
make web            # Vite dev server only (:5174)
make stack-up       # Postgres and API in Docker
make stack-down     # Stop the Docker stack
make seed-dev       # Migrate, then load master and dev sample data (dev only)
make db-ui          # pgweb database browser (:8081)
make test           # Go tests plus web typecheck and lint
make lint           # golangci-lint when installed, and Biome
make fmt            # gofmt and Biome format
```

Migrations use Goose with SQL under `apps/api/db/migrations`:

```bash
make migrate-up               # Apply pending migrations
make migrate-status           # Show state
make migrate-new NAME=<name>  # Create a new migration
```

Never edit an applied migration; add a new one.

## Backend layout (`apps/api`)

Feature-sliced, one package per resource, each self-contained:

```
cmd/api/            Entry point, server wiring, graceful shutdown
internal/
  app/              Router, middleware (auth, RBAC, logging, CORS, body limit)
  auth/             Login, JWT, refresh-token rotation
  clients/ vendors/ items/ quotations/ purchaseorders/ invoices/ dashboard/
                    Handler, repo, and DTOs per feature, with tests
  users/ countries/ units/
  pdfgen/           LaTeX (xelatex) document rendering
  storage/          MinIO client, bucket policy, authenticated download proxy
  shared/           deps, db helpers, httperr (RFC 7807), httpx, paginate,
                    assetproxy (descriptor-driven presign handlers, one set
                    reused by every slice), money, tz
  testutil/         Test server, pool, and seed helpers
db/
  migrations/       Goose SQL migrations
  queries/          Embedded, hand-written SQL parsed by Load()
  functions/        Canonical current body of every plpgsql/sql function
  seeds/            Master and dev sample data
```

Handlers stay thin; each feature owns its repo and DTOs. The API is mounted
under `/api/v1`. Errors are RFC 7807 problem+json (`shared/httperr`). List
endpoints return the total count in the `X-Total-Count` header.

`db/functions` holds the current body of each database function, since a
migration only records one edit. It is generated from the live DB and a test
fails when it drifts; after a migration changes a function run
`make db-functions-dump`.

## Frontend layout (`apps/web`)

Feature-based with file-based routing:

```
src/
  routes/            TanStack Router, auto-generated route tree
  features/          One folder per feature: api.ts, hooks.ts, components
  components/shared/ Sidebar, tables, pagination, Modal, TableStates
  lib/               api-client, rbac, format, status, chart helpers,
                     ui (tailwind class primitives), useListScreen
  styles/            tailwind.css (entry), design-tokens.css, layout.css
  types/             Hand-maintained API types
```

Server state is TanStack Query; `lib/api-client.ts` attaches the JWT and maps
errors. `types/api.ts` is the effective API contract, since `openapi.yaml` only
documents part of the surface.

List screens share one state machine, `lib/useListScreen.ts`: search with
debounce, filters, page, per-page, and the reset-to-page-1 invariant. Note which
mutator resets the page — `setSearch`, `applyFilters` and `setItemsPerPage` do,
`clearSearch` and `patchFilters` do not, because removing a filter chip must
keep the reader in place. Each screen still owns its own filter defaults and
query call. Table loading and empty rows come from `components/shared/
TableStates`, and repeated class strings live in `lib/ui.ts`.

## Testing

- Go unit tests are table-driven and run without a database.
- Integration tests and the godog acceptance suites (`internal/*/acceptance`)
  need PostgreSQL and skip cleanly when it is unreachable. Start one with
  `make db-up` to run them.
- Web tests are Vitest, pure logic only, in a node environment with no DOM.

## Conventions

1. Migrations are append-only; never edit an applied one.
2. Backend errors are RFC 7807; the frontend shows them via toast.
3. TypeScript is strict, no `any`, prefer `type` over `interface`.
4. Go errors are wrapped with `fmt.Errorf("...: %w", err)`; tests are
   table-driven.
5. SQL is snake_case, parameterized, and hand-written in `db/queries`.
6. RBAC is enforced at the router mount (`requireRole` on the quotations,
   purchase-orders, invoices, and users subtrees) and mirrored in the frontend.
   The dashboard has mixed access, so its financial gating lives in the handlers
   — the overview is open with financial fields stripped, timeseries gates per
   metric, the XLSX export is finance-only — each covered by a negative test.
7. Dates resolve to WIB. The pool session timezone is pinned from `Config.TZ`
   (Asia/Jakarta) in `shared/db.NewPool`, so `CURRENT_DATE`/`NOW()`, invoice
   dates, and document-number periods are business-zone. Go-side date
   formatting goes through `shared/tz`, never `time.Local`. Do not remove the
   pin or the startup timezone assertion.
8. Invoice tax figures are rounded per line, then summed to the header (matching
   DJP e-faktur), and `ppn_amount` is computed from the already-rounded DPP
   base. Invoices snapshot `gross_unit_price` and `total_discount`, so the PDF
   prints a gross line plus a real discount row (`TotalProduk − Diskon = DPP`)
   without reading the quotation. Do not restate already-filed invoices.

## Tooling and style

- Python (only the `apps/api/db/import` tool) runs through `uv`; never call
  python, python3, pip, or pip3 directly.
- The JavaScript toolchain uses `bun` and `bunx`, not npm or npx.
- Comments are in English. Section, function, and class header comments stay
  within five words. No emoji and no decorative separator lines.
- UI text is Indonesian, written inline; there is no i18n layer.
- Use conventional commits (`feat:`, `fix:`, `test:`, `docs:`).
