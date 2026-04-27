# Round 2 Plan: Restructure and Backend Build-Out

Source of truth: `docs/ERD.drawio.xml` and the friend's frontend in `apps/web/src/`.
Constraint: visual output of every page must match what the friend already shipped.
We move files, split big components into smaller ones, and add code. We do not redraw.

This plan covers Round 2 only. Round 3 (LaTeX PDF, Coretax export, audit fan-out, full
test suite) is listed at the bottom as deferred so the boundary is clear.

## 1. Tech stack lock

The friend already picked a strong stack. We pin versions to current April 2026 stable
and add the few pieces missing.

### Frontend (`apps/web`)

| Item | Version | Why |
|---|---|---|
| React | 19.2.4 | Already in use, current stable |
| TypeScript | 5.9.3 | Strict mode, no `any` |
| Vite | 7.3.1 | Friend's choice, fast dev |
| Tailwind CSS | 4.2 via `@tailwindcss/vite` | Already wired |
| shadcn/ui | latest CLI | Add Radix primitives only where needed |
| TanStack Router | 1.168 | File-based, already wired |
| TanStack Query | 5.99 | Server state cache |
| Biome | 2.4.12 | Lint and format |
| Zod | 4.3 | Schema validation |
| Bun | latest | Package manager and dev runner |

shadcn/ui addition: install Radix primitives (`@radix-ui/react-dialog`,
`react-dropdown-menu`, `react-popover`, `react-tooltip`, `react-label`,
`react-slot`), plus `class-variance-authority`. Copy the small `Button`, `Input`,
`Dialog`, `DropdownMenu` files into `src/components/ui/`. We do not migrate the
friend's existing JSX to these primitives in Round 2. We make them available so
new components and Round 3 work can use them without touching old files.

### Backend (`apps/api`)

| Item | Version | Why |
|---|---|---|
| Go | 1.25.0 | Already bumped by `x/crypto v0.50` |
| chi | v5.1 | Idiomatic, lightweight router |
| pgx | v5.7 | Native pgx, no ORM |
| sqlc | 1.30 | Type-safe codegen from SQL |
| goose | v3.23 | Forward-only migrations |
| golang-jwt | v5.3 | Auth tokens |
| shopspring/decimal | v1.4 | Money math |
| caarlos0/env | v11 | Typed config |
| excelize | v2.x (Round 3) | Coretax export |
| chromedp or wkhtmltopdf | (Round 3) | PDF rendering |

We considered Gin and Echo. Both are fine. We stay on chi because the friend wired
it, the middleware shape is a clean fit for our auth layer, and it composes well with
modular monolith routing.

We considered ent and gorm. Both add an ORM that hides Postgres power
(GENERATED columns, triggers, JSONB, function calls). Our schema relies on those
features. sqlc keeps SQL first-class while giving us typed Go.

### Database

Postgres 18-alpine. Already in compose. Extensions used: `pg_trgm` (search),
`btree_gin` (composite GIN), and the GENERATED STORED columns from the baseline.

### Infra

Dokploy on the existing VPS. Traefik terminates TLS. MinIO holds PDFs and exports
when Round 3 lands. Shared `dokploy-network` declared external so other projects on
the same VPS keep working.

## 2. Repo structure

Top-level today is fine. We tweak two trees: `apps/web/src/` and `apps/api/`.

```
InternalGNS/
  apps/
    web/
    api/
  infra/
    dokploy/
  docs/
  Makefile
```

### `apps/web/src/` target

```
src/
  main.tsx
  routeTree.gen.ts
  routes/                     # file-based router
  features/
    auth/
      LoginPage.tsx
    dashboard/
      MainDashboard.tsx
    quotations/
      QuotationList/
        index.tsx
        Toolbar.tsx
        StatsRow.tsx
        FilterBar.tsx
        QuotationsTable.tsx
        EmptyState.tsx
      QuotationDetail/
        index.tsx
        Header.tsx
        ClientCard.tsx
        ItemsTable.tsx
        Totals.tsx
        StatusTimeline.tsx
        Actions.tsx
      QuotationAdd/
        index.tsx
        Step1Client.tsx
        Step2Product.tsx
        Step3Shipping.tsx
        Step4Summary.tsx
      QuotationEdit/
        index.tsx
      FilterQuotation.tsx
    clients/
      ClientAdd/
        index.tsx
        Form.tsx
        ContactForm.tsx
      ClientList.tsx           # placeholder for Round 3
    products/
      ProductAdd/
        index.tsx
        SearchPanel.tsx
        DetailPanel.tsx
        VendorList.tsx
        PriceHistory.tsx
        UnitPicker.tsx
        DiscountBox.tsx
        AddNewItemForm.tsx
      ProductAddNew.tsx
      DiscountAdd.tsx
    shared/
      Sidebar.tsx
  components/
    ui/                        # shadcn primitives
      button.tsx
      input.tsx
      dialog.tsx
      dropdown-menu.tsx
      label.tsx
  lib/
    api/
      client.ts                # was api-client.ts
      auth.ts
      clients.ts
      countries.ts
      units.ts
      items.ts
      vendors.ts
      quotations.ts
    query/
      client.ts                # was query-client.ts
      keys.ts                  # query key factory
      auth.ts
      clients.ts
      countries.ts
      units.ts
      items.ts
      vendors.ts
      quotations.ts
    utils.ts                   # cn() and helpers
    page-nav.ts
    status.ts
    api-error.ts               # custom Error subclass
  hooks/
    use-auth.ts
  types/
    api.ts
  styles/
    tailwind.css
    design-tokens.css
    admin.css
  data/
    quotations.ts              # local fallback data, kept until backend live
```

Friend's path constants (`logoImg = "/logo.png"`) keep working because the
`public/` folder is unchanged.

The `Page` type that 5 components import from `main.tsx` moves to
`src/lib/page-nav.ts` (a const tuple). `main.tsx` re-exports it for
backward compatibility so we change the import target gradually.

### `apps/api/` target

```
apps/api/
  cmd/
    api/main.go
  internal/
    app/                       # config, server, router, middleware
    auth/
    users/
    countries/
    units/
    clients/
    items/
    vendors/
    quotations/
    purchases/                 # stub, ERD: purchase_orders
    invoices/                  # stub, ERD: invoices
    pricing/                   # cross-domain match logic
    documents/                 # PDF, Round 3
    files/                     # MinIO, Round 3
    audit/                     # writer, Round 3
    tax/                       # Coretax, Round 3
    platform/                  # was internal/shared
      db/
      deps/
      http/
      httperr/
      money/
      paginate/
      tz/
      validate/
  db/
    migrations/                # was apps/api/migrations
    queries/
      auth.sql
      users.sql
      countries.sql
      units.sql
      clients.sql
      items.sql
      vendors.sql
      quotations.sql
    seeds/
    checks/
  gen/
    sqlc/                      # generated code lives here
  templates/
    documents/...
  assets/
    documents/...
  sqlc.yaml
  Dockerfile
  Makefile
  go.mod
  go.sum
```

Two notable moves:

1. `internal/shared/` becomes `internal/platform/`. The word "shared" reads vague
   in Go land. "Platform" matches what it actually is: cross-cutting infrastructure
   helpers.
2. `migrations/` and seeds move out of `internal/` into `db/`. They are not Go
   code, they are schema. Keeping them next to `queries/` makes the SQL story one
   tree.

### sqlc layout decision

We chose the centralized layout over per-domain because:

- Single `sqlc.yaml` block is enough.
- One `gen/sqlc/` package lets every domain repo import the same generated Go.
- Domain isolation stays at the repo layer, not at the codegen layer.

`apps/api/sqlc.yaml`:

```yaml
version: "2"
sql:
  - engine: "postgresql"
    schema: "db/migrations"
    queries: "db/queries"
    gen:
      go:
        package: "sqlcgen"
        out: "gen/sqlc"
        sql_package: "pgx/v5"
        emit_interface: true
        emit_json_tags: true
        emit_pointers_for_null_types: true
        emit_exact_table_names: false
        overrides:
          - db_type: "numeric"
            go_type: "github.com/shopspring/decimal.Decimal"
          - db_type: "timestamptz"
            go_type: "time.Time"
```

Each domain repo holds one `*Repo` struct. The struct wraps `sqlcgen.Queries`
plus the pool. Repo methods translate DTO into sqlc args, call `q.MethodName`,
and adapt rows to domain types. Handlers stay unchanged.

## 3. Backend module status

Snapshot from current code plus what needs filling in based on the FE contract.

| Module | Status | Round 2 work |
|---|---|---|
| `app` | done | move CORS list to typed config, no behavior change |
| `auth` | done | smoke under compose |
| `users` | done | seed at boot stays |
| `countries` | repo + handler | move SQL into `db/queries/countries.sql` |
| `units` | repo + handler | same |
| `clients` | repo + handler | wire `fn_search_clients`, `Update`, `UpdateContact` |
| `items` | repo + handler | wire `fn_search_items`, `fn_match_request`, `fn_suggest_selling_prices`, `v_items_with_cheapest_vendor` |
| `vendors` | repo + handler | wire `fn_search_vendors`, `fn_search_items_by_vendor` |
| `quotations` | repo + handler | wire `fn_create_quotation`, `fn_update_quotation`, `fn_change_quotation_status`, `Send` wrapper, `Stats` |
| `purchases` | stub | empty package, returns 501 for now, marks ERD coverage |
| `invoices` | stub | same |
| `pricing` | new | host shared selectors used by `items` and `quotations` |
| `documents` | empty | Round 3 |
| `files` | empty | Round 3 |
| `audit` | empty | Round 3 |
| `tax` | empty | Round 3 |

## 4. Frontend cleanup

We touch the four biggest files and leave the rest. Splitting works only when
DOM output stays identical: same class names, same element order, same event
handlers.

| File | Lines | Plan |
|---|---|---|
| `ProductAdd.tsx` | 750 | split into `SearchPanel`, `DetailPanel`, `VendorList`, `PriceHistory`, `UnitPicker`, `DiscountBox`, `AddNewItemForm` under `features/products/ProductAdd/` |
| `QuotationList.tsx` | 496 | split into `Toolbar`, `StatsRow`, `FilterBar`, `QuotationsTable`, `EmptyState` |
| `QuotationDetail.tsx` | 466 | split into `Header`, `ClientCard`, `ItemsTable`, `Totals`, `StatusTimeline`, `Actions` |
| `ClientAdd.tsx` | 344 | split into `Form` and `ContactForm` |
| `Step2Product.tsx` | 308 | keep, only touched if needed for service hooks |
| `Step4Summary.tsx` | 304 | keep, only touched for service hooks |
| `QuotationEdit.tsx` | 302 | keep |
| `FilterQuotation.tsx` | 254 | keep |
| `ProductAddNew.tsx` | 238 | keep |
| `QuotationAdd.tsx` | 236 | keep, becomes folder index after `Step*` move |
| `MainDashboard.tsx` | 210 | keep |
| `LoginPage.tsx` | 132 | already widened in Round 1 |

Service layer change: every component that today reads `data/quotations.ts` or
calls `apiRequest` directly will switch to a TanStack Query hook from
`lib/query/{domain}.ts`. The hook uses the service in `lib/api/{domain}.ts`. This
keeps cache, retry, and invalidate behavior consistent.

We keep `data/quotations.ts` until the live API replaces every call site, then
delete it in one pass.

## 5. SQL query files

Per-domain `.sql` files under `db/queries/`. Query names use sqlc annotation
syntax. Sample for `clients.sql`:

```sql
-- name: ListClients :many
SELECT id, number, name, npwp, address, email, country_code, tku_id,
       is_active, created_at, updated_at
FROM company_client
WHERE (sqlc.narg('only_active')::bool IS NOT TRUE OR is_active)
ORDER BY created_at DESC
LIMIT sqlc.arg('lim') OFFSET sqlc.arg('off');

-- name: GetClient :one
SELECT id, number, name, npwp, address, email, country_code, tku_id,
       is_active, created_at, updated_at
FROM company_client
WHERE id = $1;

-- name: SearchClients :many
SELECT *
FROM fn_search_clients(sqlc.arg('q')::text,
                       sqlc.arg('min_score')::numeric,
                       sqlc.arg('lim')::int);

-- name: CreateClient :one
INSERT INTO company_client (number, name, npwp, address, email,
                            country_code, tku_id, created_by, updated_by)
VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $8)
RETURNING id, number, name, npwp, address, email, country_code, tku_id,
          is_active, created_at, updated_at;

-- name: UpdateClient :one
UPDATE company_client
SET name = COALESCE(sqlc.narg('name'), name),
    npwp = COALESCE(sqlc.narg('npwp'), npwp),
    address = COALESCE(sqlc.narg('address'), address),
    email = COALESCE(sqlc.narg('email'), email),
    country_code = COALESCE(sqlc.narg('country_code'), country_code),
    tku_id = COALESCE(sqlc.narg('tku_id'), tku_id),
    updated_by = sqlc.arg('user_id')
WHERE id = sqlc.arg('id')
RETURNING id, number, name, npwp, address, email, country_code, tku_id,
          is_active, created_at, updated_at;

-- name: ListContacts :many
SELECT id, company_id, name, email, phone, title, country_code,
       is_active, created_at, updated_at
FROM person_client
WHERE company_id = $1
ORDER BY name;

-- name: CreateContact :one
INSERT INTO person_client (company_id, name, email, phone, title,
                           country_code, created_by, updated_by)
VALUES ($1, $2, $3, $4, $5, $6, $7, $7)
RETURNING id, company_id, name, email, phone, title, country_code,
          is_active, created_at, updated_at;
```

The `quotations.sql` file wraps the four DB functions:
`fn_create_quotation`, `fn_update_quotation`, `fn_change_quotation_status`,
plus list and stats queries.

## 6. Migration map

Existing migrations stay numbered 00001 through 00013. Round 2 adds none.
Round 3 will add invoices/PO domain migrations if the friend's UI grows to
cover them.

The seed file `migrations/seeds/01_master.sql` already removed the superadmin
insert in Round 1. The Go bootstrap in `internal/users/seed.go` owns that row
via `SUPERADMIN_*` env vars.

## 7. Cleanup list

Files we delete in Round 2:

| Path | Reason |
|---|---|
| `apps/web/dist/` | build output, gitignored already if not tracked |
| `apps/web/tsconfig.tsbuildinfo` | build cache |
| `apps/web/tsconfig.node.tsbuildinfo` | build cache |
| `apps/web/vite.config.d.ts` | leaked build artifact, reproducible |
| `apps/web/package-lock.json` | Bun lock is the source of truth |
| `apps/api/internal/*/.gitkeep` | folders now have files |
| `apps/api/internal/shared/validate/.gitkeep` | empty package |
| `apps/api/internal/shared/paginate/.gitkeep` | empty package |
| `apps/api/internal/shared/http/.gitkeep` | empty package |

We do not delete templates or assets `.gitkeep`, those folders need to stay
empty until Round 3.

We do not delete `data/quotations.ts` yet. It still backs the dashboard
preview when the API is offline. Removed once every read path uses live API.

## 8. Dokploy compose adjustments for shared VPS

The VPS already runs two Dokploy projects. Conflicts to avoid:

- Volume names. We rename `postgres_data` to `internalgns_postgres_data` and
  `minio_data` to `internalgns_minio_data` so other projects keep their own.
- Project name. The compose file already declares `name: internalgns`. Keep.
- Network. `dokploy-network` stays external so Traefik on the VPS keeps
  routing both old and new projects.
- Ports. We expose nothing publicly, Traefik fronts everything. Postgres and
  MinIO are internal-only on the `internal` network.

`infra/dokploy/README.md` will document the env values and the host setup
walkthrough.

## 9. Execution order

1. Lock versions and write this plan (this file).
2. Move SQL into `apps/api/db/`. Update goose embed and sqlc paths. Rebuild API.
3. Generate sqlc code into `apps/api/gen/sqlc/`. Refactor repos one domain at a
   time, verifying `go build` and `go vet` after each.
4. Wire missing endpoints (clients update, items cheapest vendor, quotations
   stats and update and status change and send).
5. Move `internal/shared` to `internal/platform`, update imports.
6. Stub `purchases`, `invoices`, `pricing` packages with `// returns 501` for
   now so the router map matches ERD coverage even before Round 3.
7. Boot postgres and api via compose. Run smoke list.
8. Switch to frontend. Move tree under `src/features/`, `src/components/ui/`,
   `src/lib/api/`, `src/lib/query/`. Update imports. Run typecheck and lint.
9. Bootstrap shadcn/ui. Add `components/ui/{button,input,dialog,dropdown-menu,label}.tsx`.
10. Split the four largest components. Diff rendered HTML before and after
    against a snapshot.
11. Add service modules and TanStack Query hooks for every domain. Replace
    direct `apiRequest` calls in components with hooks.
12. Translate Indonesian comments to English. Strip `===` and `---` separators.
13. Delete the cleanup list. Confirm `bun run build` and `bun run typecheck`
    still pass.
14. Re-run compose smoke. Stop here. No commit. Hand off for review.

## 10. Round 3 deferred

These are not in scope for Round 2. Listing here so the boundary is explicit.

- `documents` package: tectonic LaTeX render to PDF, write to MinIO.
- `files` package: MinIO client, signed URL issuance.
- `tax` package: Coretax Excel export via excelize.
- `audit` package: generic writer that fans out from every mutation.
- `purchases` and `invoices`: full domain implementation, FE pages, migrations.
- Test suite: state machine round-trip, JWT verify, decimal arithmetic,
  table-driven repo tests, Playwright happy path.
- Cursor pagination across list endpoints.
- Rate limit on auth endpoints.

## 11. Open questions

We need answers before we can finish Round 2 cleanly.

1. Should the friend's `data/quotations.ts` be kept as offline fallback or
   removed entirely? Current plan keeps it.
2. Do we ship shadcn primitives but not adopt them anywhere, or do we replace
   one or two friend's hand-built modals (DiscountAdd, ClientAdd) with the
   primitives in Round 2? Current plan says ship only.
3. Is the existing 4-state `Page` type still needed once routes are file-based?
   The friend exported it from `main.tsx`. Five components import it. Current
   plan keeps it as a type re-export from `lib/page-nav.ts`.
