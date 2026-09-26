# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project Overview

InternalGNS is the internal quotation to purchase-order to invoice system for
PT Global Niaga Sakti. It is a Go REST API and a React single-page app in a
Bun-managed monorepo.

- Backend (`apps/api`): Go 1.26, Chi v5 router, pgx v5 against PostgreSQL,
  Goose migrations, JWT auth with role-based access, slog logging. SQL is
  hand-written in `.sql` files that are embedded and parsed at startup
  (`apps/api/db/queries`); there is no ORM or code generator.
- Frontend (`apps/web`): React 19 with strict TypeScript, Vite 7, TanStack
  Router and Query, Bun runtime, Biome for lint and format. Tables are plain
  markup; there is no table library.
- Styling is Tailwind CSS v4 only. `src/styles/tailwind.css` is the only
  stylesheet: the `@theme` tokens (brand scale), the `--status-*` badge
  colours on `:root`, and a small base layer (reset, body, button, reduced
  motion). Preflight is off. Shared class strings live in `src/lib/ui.ts`.
  Inline `style` is only for colours computed at runtime (status badges, logo
  and avatar fills). Responsive down to 320px.
- Infra: PostgreSQL 18, MinIO for object storage, xelatex for PDF rendering,
  Dokploy with Traefik for deployment, Nginx to serve the built frontend.
  The MinIO server is the Silo fork (`pgsty/silo`, pinned by release tag in
  both compose files and `ci.yml`), since MinIO, Inc. pulled its images; its
  client is `mcli`, not `mc`. The Go SDK stays `minio-go`.
  Two compose files sit at the repo root: `compose.dev.yml` for local work and
  `compose.prod.yml` for the VPS, with `.env.prod.example` as its template.
  Neither is named `docker-compose.yml`, so a bare `docker compose up` selects
  nothing and cannot start the production topology by accident; always pass
  `-f`. Deployment steps live in `docs/deploy_vps.md`; backups and restores in
  `docs/backup_restore.md` (`make backup`, `make restore`).

## Roles

Three roles, enforced in the frontend (`src/lib/rbac.ts` plus route guards) and
the backend (`requireRole` and `readOnlyFor` middleware in `internal/app`):

- superadmin: everything, including user management.
- operational: quotations, purchase orders, and the shared master data. No
  invoices, financial dashboard, or user management.
- finance: invoices and the financial dashboard. Reads products and vendors
  but cannot change them (`readOnlyFor("finance")`, mirrored by
  `canWriteCatalog`); keeps client writes for NPWP and TKU. No quotations or
  purchase orders.

Everyone reaches the overview dashboard, clients, vendors, and products.
Financial figures (revenue, expenses, profit, PPN, invoice totals) are limited
to superadmin and finance at both layers, including the dashboard endpoints.

Sessions end on expiry or by version. Every access and refresh token carries
the `users.session_version` it was minted under, and the auth middleware
refuses any other. A role change, a deactivation, or a password change bumps
the version and revokes refresh tokens, so every open session of that user
ends on its next request.

## Essential Commands

Run from the repo root. `make help` lists every target.

```bash
make dev            # Postgres, MinIO, API (:8080), and the SPA (:5174)
make web            # Vite dev server only (:5174)
make stack-up       # Postgres, MinIO, pgweb, and API in Docker
make stack-down     # Stop the Docker stack
make seed-dev       # Migrate, then load master and historical data (dev only)
make db-ui          # pgweb database browser (:8081)
make test           # Go tests, web typecheck, and Vitest
make test-api       # Go tests on a throwaway database, as CI runs them
make e2e            # Playwright against the running dev stack
make cover          # Both coverage gates
make lint           # go vet, golangci-lint when installed, and Biome
make fmt            # gofmt and Biome format
```

Migrations use Goose with SQL under `apps/api/db/migrations`:

```bash
make migrate-up               # Apply pending migrations
make migrate-status           # Show state
make migrate-new NAME=<name>  # Create a new migration
make db-functions-dump        # Refresh db/functions after a function change
```

Never edit an applied migration; add a new one. Goose runs without
out-of-order, so it refuses a migration numbered below one already applied:
a new migration takes the next number above the highest on the branch, and
migrations land in number order. The gaps (00049, 00058, 00060) are retired
and stay empty.

## Backend layout (`apps/api`)

Feature-sliced, one package per resource, each self-contained:

```
cmd/api/            Entry point, server wiring, graceful shutdown
cmd/orphan-blobs/   Unreferenced MinIO object sweeper
cmd/pdfsmoke/       PDF render smoke check
internal/
  app/              Router, middleware (auth, RBAC, logging, CORS, body limit),
                    background loops (refresh purge, quotation expiry)
  auth/             Login, JWT, refresh-token rotation, session version
  clients/ vendors/ items/ quotations/ purchaseorders/ invoices/ dashboard/
                    Handler, repo, and DTOs per feature, with tests
  users/ countries/ units/
  pdfgen/           LaTeX (xelatex) document rendering
  storage/          MinIO client, bucket policy, authenticated download proxy
  shared/           deps, db helpers, httperr (RFC 7807), httpx, paginate,
                    listq (list query builder), sheet (XLSX), assetproxy
                    (descriptor-driven presign handlers, one set reused by
                    every slice), money, tz
  testutil/         Test server, pool, and seed helpers
db/
  migrations/       Goose SQL migrations
  queries/          Embedded, hand-written SQL parsed by Load()
  functions/        Canonical current body of every plpgsql/sql function
  seeds/            Master data and the historical import
  import/           Excel-to-seed tool (uv)
```

Handlers stay thin; each feature owns its repo and DTOs. The API is mounted
under `/api/v1`. Errors are RFC 7807 problem+json (`shared/httperr`). List
endpoints return the total count in the `X-Total-Count` header.

Every query key a repo reads is listed in `db/queries/required.go`, and
`Load()` fails at startup when one is missing; add the key in the same commit
as the query.

`db/functions` holds the current body of each database function, since a
migration only records one edit. It is generated from the live DB and a test
fails when it drifts; after a migration changes a function run
`make db-functions-dump`.

## Status model

Each document has one transition table in Go, mirrored by its plpgsql
function and checked pair by pair against the database by a test:
`quotations.Transitions` (`fn_change_quotation_status`),
`purchaseorders.Transitions` (`fn_change_po_status`) and
`invoices.Transitions` (`fn_change_invoice_status`). The detail response
carries `allowedTransitions` (`to`, `label`, `requiresNote`), and the web
renders exactly those moves; it keeps no transition map of its own. A refused
move is a 422 with Indonesian detail text. Every move writes a row to that
document's status history table.

- Quotation: draft, sent, revision, accepted, rejected, cancelled, expired.
  Draft goes to sent or cancelled; sent to accepted, rejected or cancelled;
  revision to rejected or cancelled. Rejected and cancelled need a reason.
  Accepted creates the PO in the same transaction. Only drafts are editable.
  Revisi is not a manual move: Buat Revisi (`POST /quotations/{id}/revise`,
  offered when `canRevise`, i.e. from sent) clones a new draft version with
  `parent_id` and a `Rev.n` number and moves the original to revision.
  Kedaluwarsa is set only by `fn_expire_quotations`, which expires sent
  quotations past `validity_days` from the last send, by WIB date. The API
  runs it at startup and then hourly (`quotations.RunExpiryLoop`), and
  `pg_try_advisory_xact_lock` keeps two replicas from both doing a run.
- Purchase order: PENDING, UPLOADED, ON_PROGRESS, DELIVERED, CANCELLED.
  PENDING and UPLOADED follow the PO file: attaching it moves PENDING to
  UPLOADED and removing it moves back, and neither is a manual move. UPLOADED
  goes to ON_PROGRESS; ON_PROGRESS to DELIVERED or back to UPLOADED; any open
  state to CANCELLED with a reason. The delivery-note number is stamped on
  ON_PROGRESS or DELIVERED, and DELIVERED creates the invoice. DELIVERED and
  CANCELLED are terminal, and the file is locked in both.
- Invoice: draft, sent, paid, cancelled; overdue is stored only on legacy
  rows. Draft goes to sent; sent or overdue to paid, which stamps `paid_at`
  and takes an optional proof stored under `invoices/<id>/payment/`. Draft,
  sent or overdue go to cancelled with a reason, and only when the invoice has
  a PO; `POST /invoices/{id}/replacement` then issues a Pengganti draft for
  the same PO. Terlambat is derived, never set: `fn_invoice_effective_status`
  (a stored overdue, or a draft or sent past its due date) is the one rule the
  list, summary and dashboard read.

Status labels are Indonesian and come from the API (`StatusLabel` in each
package); `src/lib/status.ts` mirrors them for fields that carry only the key.

Clients get a four-digit number from the server. A blank number on create is
filled by `fn_next_client_number`; a typed one must be four digits and unused,
and it is locked once a quotation uses it, because every document number
embeds it.

## Frontend layout (`apps/web`)

Feature-based with file-based routing:

```
src/
  routes/            TanStack Router, auto-generated route tree
  features/          One folder per feature: api.ts, hooks.ts, components
  components/shared/ Sidebar, Modal, tables, pagination, states, links
  hooks/             Cross-feature hooks
  lib/               api-client, rbac, format, status, entity-link, chart
                     helpers, ui (tailwind class primitives), useListScreen
  styles/            tailwind.css (entry, @theme tokens, base layer)
  test/              renderHook and query helpers for hook tests
  types/             Hand-maintained API types
```

Server state is TanStack Query; `lib/api-client.ts` attaches the JWT and maps
errors. `types/api.ts` is the effective API contract, since `openapi.yaml` only
documents part of the surface.

The app shell lives in the layout route. `routes/_authed.tsx` renders
the shell with the `Sidebar` and a scrolling `<main>` around the `Outlet`, so page
components render only their own content and take no navigation props. `Sidebar`
derives its active section from the router via `sectionFromPathname` (which
covers detail and edit routes) and calls `logout` itself. Navigate with
`useNavigate` or `Link` against the generated route tree; never reintroduce a
hand-kept page union.

Shared pieces in `components/shared`, reuse them instead of copying markup:

- `EntityLink` links a document number or name to its detail page through
  `lib/entity-link.ts`. It renders a real anchor, and falls back to plain text
  when the id is missing or the viewer's role cannot open the target. PO and
  invoice routes are keyed by the quotation id, so those kinds take
  `quotationId`.
- `Modal` is the dialog shell: focus trap, Escape to close, scroll lock,
  focus returned to the opener, and a stack so only the top modal reacts.
- `FilterFooter` is the Hapus Filter, Batal, Terapkan footer of every filter
  modal.
- Page states: `LoadingState`, `NotFoundState`, `RouteErrorFallback` and
  `RouteNotFound`, all built on `StateMessage`; table rows use `TableStates`.
- `StatCard` is the summary tile on list screens and dashboards.

List screens share one state machine, `lib/useListScreen.ts`: search with
debounce, filters, page, per-page, and the reset-to-page-1 invariant. Note which
mutator resets the page — `setSearch`, `applyFilters` and `setItemsPerPage` do,
`clearSearch` and `patchFilters` do not, because removing a filter chip must
keep the reader in place. Each screen still owns its own filter defaults and
query call.

## Testing

- Go unit tests are table-driven and run without a database.
- Go integration tests and the godog acceptance suites (`internal/*/acceptance`)
  read `TEST_DATABASE_URL` only, never `DATABASE_URL`, and skip when it is
  unset. The reset helpers ask the connection for `current_database()` and
  refuse any name that does not end in `test` (`gns_citest`, `gns_<task>_test`),
  so a stray DSN cannot truncate `gns_quotation`. `make test-api` (alias
  `make test-api-ci`) drops and recreates the throwaway `gns_citest` and runs
  the suite the way CI does (`-race -p=1`); `make test-api
  CI_TEST_DB=<name>_test` picks another database.
- A test must create the rows it asserts on. `testutil.Pool` only migrates and
  applies `SeedMasterIfMissing`, so anything beyond that handful of master rows
  exists locally by accident: acceptance runs commit, and the dev volume keeps
  what `make seed-dev` loaded. Asserting on ambient volume passes locally and
  fails on CI. Use `make test-api-ci` before pushing anything that touches
  integration tests.
- The PDF layout tests skip without xelatex. CI runs them in the API runtime
  image (the `pdf layout (xelatex)` job), so a local skip is not a pass.
- Web logic tests are Vitest in node (`src/**/*.test.ts`). Hook tests are
  `*.hook.test.ts(x)` in a happy-dom project and render through
  `src/test/renderHook.tsx`. `bun run test` runs both projects.
- Components and routes are covered by Playwright in `apps/web/e2e`: one
  scenario per main or alternative flow, plus the role matrix. The setup
  project signs each role in once through the API and `fixtures.ts` seeds the
  tokens into sessionStorage (`test.use({ session: "finance" })`). It creates
  or reactivates the `e2e.*@globalsakti.com` users, and the teardown project
  deactivates them, since users cannot be deleted. `make e2e` runs against the
  dev stack from `make dev`, with admin credentials from `apps/api/.env`;
  `E2E_BASE_URL` and `E2E_API_URL` point it elsewhere. Login allows 5 attempts
  per minute per IP, so a rerun inside a minute waits out the window.

Coverage gates fail CI below their tier; `make cover` runs both locally.

- Go: `make cover-api` runs the suite once with `-coverpkg=./...`, so a
  statement counts when any package's tests run it, then `scripts/covercheck`
  checks each package against `scripts/covercheck/thresholds.txt`. Business
  packages, `pdfgen`, `db/queries` and `shared/money` need 98%, `app` and the
  other `shared/*` packages 95%, `storage` 90% (MinIO running). `cmd/*`,
  `scripts`, `testutil`, acceptance suites, `db/functions` and
  `db/migrations` are excluded; the CI e2e job boots `cmd/api` as its smoke. A
  new package fails until it is tiered or excluded. The checker prints each
  gap in points and statements. Raise a minimum once coverage passes it, and
  never lower one.
- Web: `bun run coverage` (`make cover-web`). Logic (`src/lib`,
  `components/shared/*.ts`, every `.ts` under `features` except `hooks.ts`,
  `types.ts` and `wizard-styles.ts`) needs 98% statements and 95% branches;
  hooks (`useListScreen`, `src/hooks`, feature `hooks.ts`) 90% statements.
  `.tsx` has no line gate.

## Conventions

1. Migrations are append-only and land in number order; never edit an
   applied one.
2. Backend errors are RFC 7807; the frontend shows them via toast.
3. TypeScript is strict, no `any`, prefer `type` over `interface`.
4. Go errors are wrapped with `fmt.Errorf("...: %w", err)`; tests are
   table-driven.
5. SQL is snake_case, parameterized, and hand-written in `db/queries`.
6. RBAC is enforced at the router mount (`requireRole` on the quotations,
   purchase-orders, invoices, and users subtrees; `readOnlyFor("finance")` on
   items and vendors) and mirrored in the frontend. The dashboard has mixed
   access, so its financial gating lives in the handlers — the overview is
   open with financial fields stripped, timeseries gates per metric, the XLSX
   export is finance-only — each covered by a negative test.
7. Dates resolve to WIB. The pool session timezone is pinned from `Config.TZ`
   (Asia/Jakarta) in `shared/db.NewPool`, so `CURRENT_DATE`/`NOW()`, invoice
   dates, and document-number periods are business-zone. Go-side date
   formatting goes through `shared/tz`, never `time.Local`. Do not remove the
   pin or the startup timezone assertion.
8. All three PDF templates print the same letterhead and running header; only
   the title differs. Each `.tex.tmpl` carries its own copy (`_base/` is
   empty), so change all three together. Quotations and invoices are landscape
   and switch between A5 and A4 on `productCount > 5`. The delivery note is A4
   portrait only: it carries two signature blocks the others do not, and A5
   cannot hold the letterhead, the table and those blocks at any item count.
   Geometry uses `includehead` so the running header prints on the sheet
   instead of off its top edge. `TestLatexExports_Clean` and `_MultiPage`
   fail on any overfull or underfull box, which is what keeps text from being
   cut.
9. Invoice tax figures are rounded per line, then summed to the header (matching
   DJP e-faktur), and `ppn_amount` is computed from the already-rounded DPP
   base. Invoices snapshot `gross_unit_price` and `total_discount`, so the PDF
   prints a gross line plus a real discount row (`TotalProduk − Diskon = DPP`)
   without reading the quotation. Do not restate already-filed invoices: their
   amounts are never recomputed, and a wrong invoice is cancelled and replaced
   by a Pengganti. Only the invoice and due dates stay editable, and only until
   the invoice is paid or cancelled.

## Tooling and style

- Python (only the `apps/api/db/import` tool) runs through `uv`; never call
  python, python3, pip, or pip3 directly.
- The JavaScript toolchain uses `bun` and `bunx`, not npm or npx.
- Comments are in English. Section, function, and class header comments stay
  within five words. No emoji and no decorative separator lines.
- UI text is Indonesian, written inline; there is no i18n layer. Problem
  details a user can read (business rules, validation) are Indonesian too.
- Use conventional commits (`feat:`, `fix:`, `test:`, `docs:`).
