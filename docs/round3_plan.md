# Round 3 Plan: FE / BE / DB Full Integration

Date: 2026-05-13
Branch: `feat/be-filter-pushdown`
Inputs: deep scans of `apps/web`, `apps/api`, `apps/api/db`, root infra + CI.

## 1. State Synthesis

### 1.1 Frontend (`apps/web`)
- React 19, TanStack Router 1.168, TanStack Query 5.99, Vite 7, Tailwind 4, Biome 2.4.12, Bun 1.3.9.
- 11 feature slices (`auth, clients, countries, dashboard, invoices, items, purchaseOrders, quotations, units, users, vendors`). All routes mounted under `/_authed/*` guarded by `sessionStorage`-backed JWT check.
- API client in `src/lib/api-client.ts` handles bearer auth, `X-Total-Count` pagination, RFC 7807-shaped `ApiError`, and a `downloadPdf` helper using `showSaveFilePicker` with anchor fallback.
- Item search uses `useItemSearchAdvanced` (5-tier merged) in `ProductAdd/index.tsx` (both offered + requested) and `ProductList.tsx`. Older `useItemSearch` is a dead export.
- MinIO is only wired for PO supporting documents through a 3-step presigned PUT flow.

### 1.2 Backend (`apps/api`)
- Go 1.25, chi v5, pgx/v5, goose v3, godog v0.15, golangci-lint v2.11. Modular monolith with `internal/<feature>/` packages.
- All 11 feature packages follow the `handler.go + repo.go + dto.go + routes.go` convention.
- Auth is JWT HS256, no refresh.
- Multi-tier search built end-to-end:
  - SQL: `fn_search_items` (3 sub-tiers AUTO ≥0.90, SUGGESTED ≥0.60, FUZZY ≥0.30), `items.search_vendor_offers`, `items.search_request_history`.
  - Go: `SearchAdvanced` handler merges 5 tiers (`ITEM_AUTO=5, VENDOR_OFFER=4, ITEM_SUGGESTED=3, REQUEST_HISTORY=2, ITEM_FUZZY=1`).
- Storage layer: single-bucket MinIO wrapper, only consumed by `purchaseorders` package.

### 1.3 Database (`apps/api/db`)
- Postgres 18, pg_trgm. 28 goose migrations, embedded via `embed.FS`, run on every `app.NewServer()`.
- 14 tables across auth, catalog, transactional, audit/learning. GIN trigram indexes on `items.name`, `vendors.name`, `company_client.name`, `company_contacts.name`, `countries.name`, `item_request_matches.request_text`, `quotation_item_requests.request_text`.
- Generated columns for VAT math, status state machines as PL/pgSQL functions, atomic creation functions for quotation / PO / invoice, race-safe document numbering via `fn_next_doc_no`.
- Real seed data (2024 to 2026) across `01_master`, `03_historical`, `03b_extra_quotations`, `04_quotation_states`, `05_real_purchase_orders`, `06_real_invoices`.

### 1.4 Infra / CI / Docs
- Dev: `compose.dev.yml` (postgres, pgweb, minio, api) + `make dev` runs api + web natively.
- Prod: `infra/dokploy/docker-compose.yml`, project-scoped under `name: internalgns`, prefixed volumes, internal + dokploy-network split, Traefik labels with unique router names.
- CI: `ci.yml` runs backend (postgres 18.3-alpine service, golangci-lint v2.11, race tests) + frontend (bun lint + typecheck + build) + smoke image build on PR. `release.yml` pushes both images to GHCR on `v*.*.*` tags or manual dispatch.
- Docs: `architecture.md`, `backend_api_spec.md`, `backend_dev_guide.md`, ADR 0001 modular monolith, `tech_stack.md`. `relational_model.html` exists but generated ERD image is missing.

## 2. Gaps Identified

### 2.1 Runtime safety
1. `purchaseorders.handler.go` presign endpoints call `h.storage.PresignPut` without nil guard; if MinIO is unconfigured, `nil` deref panics the request.
2. `queries.Store.Get` panics on missing SQL key. A typo in any repo call crashes a live handler.
3. PDF export `_, _ = w.Write(pdf)` drops write errors in three places.

### 2.2 Schema-to-code drift
1. `quotation_item_requests` (migration 00022) has trigger lock + audit view, zero Go CRUD, zero queries.sql entry. Entire QIR review workflow exists only at schema level.
2. `row_version` columns on 5 tables, never read by any query. Optimistic locking incomplete.
3. `quotations.parent_id` indexed but no query selects or filters on it. Revision chain workflow incomplete.
4. Coretax fields unused: `invoice_items.goods_or_service`, `purchase_orders.delivery_note_number`.
5. `quotation_items.requested_item_id` indexed (`idx_quotation_items_requested_item`) but no query filters on it.

### 2.3 FE / BE type drift
1. `features/invoices/types.ts`, `features/purchaseOrders/types.ts`, `features/quotations/types.ts` define local status enums with Indonesian uppercase values that do not derive from `types/api.ts` canonical strings. Adapters bridge the gap silently.
2. Dead exports: `useItemSearch`, `InvoiceLocalRecord`, `PoLocalRecord`.
3. `(err as { status: number })` unchecked casts in `purchaseOrders/api.ts:57` and `invoices/api.ts:66`.

### 2.4 Cross-layer redundancy
1. FE: `getPageNumbers` defined in 4 places; `buildQuery` URLSearchParams reimplemented across 5 feature `api.ts` files; `initialsOf` + `fromClientRow` + `fromClientHit` + `dedupeByCompany` copy-pasted into `QuotationAdd`, `QuotationEdit`, `PurchaseOrderEdit`; status badge JSX inline in 12+ files; six feature filter panels with identical structure.
2. BE: `strDeref`, `sanitizeFilename`, `zero` triplicated across `quotations/export.go`, `invoices/export.go`, `purchaseorders/delivery_note.go`; pagination cap reimplemented inline in 8 repos despite `shared/paginate.Parse` existing; PPN tax rate `0.12` and DPP `11/12` ratio hardcoded in three PDF exports.
3. FE component layer leak: `components/shared/Pagination.tsx` imports `getPageNumbers` from `features/quotations/QuotationList/helpers`. `features/<x>/*.tsx` import `type Page` from `src/main.tsx`.

### 2.5 MinIO coverage gap
1. Only `purchase_orders` consume the presign flow.
2. Logos for clients and vendors, invoice payment attachments, and item images are not wired to MinIO. UI layout has no slots for these yet, so the schema additions go first and FE UI slots arrive only where requested.

### 2.6 Tooling
1. ERD source not regenerated since schema reached migration 00028.
2. `xlsx` is unmaintained SheetJS CE; needs replacement for the Excel import path.
3. Biome lint excludes `components/**`, leaving the shared component tree unchecked.
4. `apps/web` has no error boundary at the route layout level.
5. `apps/api` `countries`, `dashboard`, `units` packages lack `testmain_test.go`; `auth`, `pdfgen`, `storage`, `shared/*` lack integration tests.

## 3. Phase Order

Phases are ranked by blast radius: phase 0 is bug fixes that cannot wait; later phases assume earlier ones land.

### Phase 0: Runtime safety bug fixes
Pure additive guards. No interface changes.

0.1 Add `if h.storage == nil` guard to every PO presign / download handler. Return 503 with explicit `MinIO not configured` reason. File: `apps/api/internal/purchaseorders/handler.go`.

0.2 Replace `queries.Store.Get` panic with structured error. Plumb through `Load()` so all named queries validate at boot. File: `apps/api/db/queries/queries.go`; callers update at request time should be unaffected because the validation moves to startup.

0.3 Wrap PDF response `Write` calls with explicit error logging (HTTP body already partially sent so we cannot change status, but at least the error is observed). Files: `apps/api/internal/quotations/export.go`, `apps/api/internal/invoices/export.go`, `apps/api/internal/purchaseorders/delivery_note.go`.

### Phase 1: Schema-to-code integration
Bring orphan schema online.

1.1 QIR Go CRUD. Add `apps/api/internal/quotations/qir_repo.go`, `qir_handler.go`, `qir_dto.go`, queries entries in `apps/api/db/queries/quotations.sql`. Endpoints `GET /quotations/:id/requests`, `POST /quotations/:id/requests`, `PATCH /quotations/:id/requests/:lineNo`, `DELETE /quotations/:id/requests/:lineNo`. Honour `trg_qir_lock_parent` by returning 409 on lock errors. Integration test using `quotations/acceptance` features.

1.2 QIR FE consumption. Add a `QuotationReviewCard` to `features/quotations/QuotationAdd/Step2Product.tsx` and `QuotationEdit` Step 2 so operators can review raw client requests before matching. UI slot only — no layout dimension changes. Hooks live in `features/quotations/hooks.ts` as `useQuotationRequests`, `useUpsertQuotationRequest`, `useDeleteQuotationRequest`.

1.3 Optimistic locking pass. Add `If-Match` header support to `quotations.UpdateQuotation`, `purchaseorders.UpdateItems`, `invoices.UpdateDates`. Use `row_version` in the SQL `WHERE` clause. Return 409 on mismatch. FE adapter reads + replays `version` on the next request. If a feature does not need optimistic lock, drop the `row_version` column in a follow-up migration.

1.4 Revision chain. Either implement `quotations.list_revisions(id)` query + `RevisionHistoryCard` FE component, or drop `parent_id` + its index in a migration. Pick the former, since the data already shows revision quotations in production seed data.

1.5 Coretax field wiring. Populate `invoice_items.goods_or_service` (`B` for products, `J` for shipping) inside `fn_create_invoice` and surface it in the Coretax XML export endpoint (Phase 4). Populate `purchase_orders.delivery_note_number` from `fn_next_doc_no(doc_type='DN', ...)` when first transitioning to `DELIVERED`.

### Phase 2: Restructure (UI dimensions unchanged)
File-shape only. No CSS, no layout, no width / height adjustments.

2.1 FE layer fixes.
- Move `type Page` out of `src/main.tsx` into `src/lib/page-nav.ts`. Update every feature import.
- Move `getPageNumbers` into `src/lib/pagination.ts`. Delete the four duplicated copies (`QuotationList/helpers`, `QuotationDetail/helpers`, `Step2Product` inline, `Step4Summary` inline). Update `components/shared/Pagination.tsx` to import from `lib/pagination.ts`, killing the layer leak.
- Lift `buildQuery` into `src/lib/api-client.ts` as `toSearchParams(params)`. Migrate the 5 feature `api.ts` files.
- Lift `initialsOf` + `fromClientRow` + `fromClientHit` + `dedupeByCompany` into `src/features/clients/helpers.ts`. Update `QuotationAdd`, `QuotationEdit`, `PurchaseOrderEdit` to import from there.
- New `src/components/shared/StatusBadge.tsx` with `tone` prop (`draft | sent | accepted | rejected | revision | expired | paid | overdue | cancelled | pending | uploaded | onProgress | delivered`). Replace inline `<span className="status-badge">` in 12+ files.
- New `src/components/shared/FilterBar.tsx` with slots for `search`, `dateRange`, `statusPills`, `reset`. Migrate six feature filter panels.
- Generate `src/types/status.ts` from the canonical BE enums and let feature `types.ts` import canonical values; drop the parallel Indonesian uppercase enums and move the display label tables to `lib/status.ts`.
- Delete dead exports: `useItemSearch`, `InvoiceLocalRecord`, `PoLocalRecord`.
- Remove `components/**` exclude from `apps/web/biome.json`. Fix the resulting lint hits.
- Add `src/components/ErrorBoundary.tsx` at `_authed.tsx` root.

2.2 BE redundancy.
- Move `strDeref`, `sanitizeFilename`, `zero` into `internal/pdfgen/helpers.go`.
- Drop inline pagination caps in 8 repos; call `paginate.Parse(r)` uniformly.
- Move PPN constants into `internal/shared/money/tax.go` (`PPNRate = 0.12`, `DPPRatio = 11.0 / 12.0`).
- Add unit tests for tax helpers.

2.3 Type generation.
- Add `apps/api/cmd/gentypes/main.go` that walks `internal/*/dto.go` and emits a single `apps/web/src/types/api.gen.ts`. Run as `make types`. Optional — if too costly, hand-maintain with a CI lint check that diffs feature DTO names against `types/api.ts` headings.

### Phase 3: MinIO scope expansion
Storage covers more than PO docs.

3.1 Multi-bucket storage. Refactor `internal/storage/minio.go` to accept a `bucket` parameter on every call. Define bucket constants in `internal/storage/buckets.go`: `BucketPODocs`, `BucketClientLogos`, `BucketVendorLogos`, `BucketItemImages`, `BucketInvoiceAttachments`. Auto-create on boot if missing.

3.2 Schema columns. New migration `00029_add_asset_urls.sql` adds `company_client.logo_object_key TEXT`, `vendors.logo_object_key TEXT`, `items.image_object_key TEXT`, `invoices.attachment_object_key TEXT`.

3.3 Handlers per entity.
- `POST /clients/:id/logo/upload-url`, `PATCH /clients/:id/logo` (set object_key)
- Same for vendors, items, invoices.

3.4 FE upload + display.
- `ClientDetail`: render existing `EntityLogo` fallback; if `logo_object_key` set, show presigned GET in same component slot (no new layout).
- `VendorDetail`: same pattern.
- `ProductDetail`: add image into existing identity card slot (no dimensions change).
- `InvoiceDetail`: add `FileCard` clone for the payment receipt under the existing status bar (matches PO `FileCard`).

3.5 Garbage collection. Add `cmd/orphan-blobs/main.go` that lists MinIO keys not referenced by any row and deletes them. Cron via Makefile + GH Action workflow `cleanup.yml` on schedule.

### Phase 4: Coretax + Excel export hardening

4.1 Excel import: replace `xlsx` with `exceljs` (`bun add exceljs`). Rewrite `features/quotations/uploadParser.ts`. Cover with vitest unit tests using fixtures from `apps/api/testdata/import_quotation/`.

4.2 ERD regeneration. Generate `docs/erd.svg` using `pg_dump` schema + `pgmodeler` or `tbls` CLI. Add `make db-erd` target. Commit the SVG.

4.3 Coretax e-faktur export. New endpoint `GET /invoices/:id/coretax.xml` that emits the official tax authority schema using already-populated `tax_transaction_code`, `faktur_type`, `goods_or_service`, `unit_id` (Coretax code).

### Phase 5: Tooling + tests
Hardening.

5.1 Add `testmain_test.go` to `countries`, `dashboard`, `units`. Add integration tests for `auth`, `pdfgen`, `storage`, and at least one `shared/*` package.

5.2 Auth refresh tokens. Add `refresh_tokens` table, `POST /auth/refresh`, rotation on use, revocation on logout.

5.3 Pre-commit hooks. Add `.pre-commit-config.yaml` running biome on staged TS/TSX, gofmt + golangci-lint --fast on staged Go, sqlfluff on staged SQL.

5.4 Makefile `db-erd` target + `types` target + `lint-fix` aggregating biome + golangci-lint.

5.5 GitHub Actions: add `cleanup.yml` (orphan blob purge cron) and `docs.yml` (build + publish ERD on push to main).

### Phase 6: Framework currency research
Cross-check via context7 MCP and release notes.

6.1 Bun: confirm `1.3.9` is current stable; if not, pin in `package.json` engines and Dockerfile.

6.2 Go: confirm `1.25.0` toolchain in `go.mod` is current; align Dockerfile `golang:1.26-alpine` base if 1.26 is GA.

6.3 TypeScript: pin `5.9.x` once stable; remove RC pin if RC.

6.4 TanStack Router / Query: read release notes since pinned versions, adopt v2 if available without breaking changes.

6.5 Biome: confirm `2.4.12` is current; align `apps/api/.golangci.yml` `v2.11` if `v2.12` released with relevant fixes.

## 4. Multi-Level Search Status

Already implemented end-to-end. Five tiers, weights `ITEM_AUTO=5 > VENDOR_OFFER=4 > ITEM_SUGGESTED=3 > REQUEST_HISTORY=2 > ITEM_FUZZY=1`. SQL functions in migration 00003 (`fn_search_items`, `fn_search_items_by_vendor`, `fn_match_request`) plus inline queries (`items.search_vendor_offers`, `items.search_request_history`). Go merges in `items.handler.SearchAdvanced` (`mergeAdvanced`). FE consumes via `useItemSearchAdvanced` in `ProductAdd/index.tsx` (both `requestQueryRaw` and `productQueryRaw`) and `ProductList.tsx`.

Remaining work for search visibility:
- A1 Surface tier badge on each dropdown row inside `ProductAdd/IdentityCard.tsx`. The tier already comes back on every hit. Sub-50 LOC change.
- A2 Add `score` debug toggle behind a localStorage flag for operations to tune `minScore`.
- A3 Admin page to inspect + edit `item_request_matches` (`/admin/match-cache`).

## 5. Non-Goals

- No UI dimension or placement change anywhere.
- No CSS rewrite. Tailwind 4 stays; `admin.css` stays.
- No commits during this round (per current user instruction).
- No premature framework upgrade unless current pin is genuinely behind.

## 6. Risk Register

R1 Migration auto-run on container start: a failing migration brings prod down. Mitigation: smoke deploy + rollback playbook in `infra/dokploy/README.md`. Mark in Phase 5.

R2 `row_version` plumbing across FE + BE requires coordination: skewed clients hit 409 on every save. Mitigation: ship lock check feature-flagged via env var, ramp.

R3 Multi-bucket storage migration is destructive if existing PO blobs live under the wrong key shape. Mitigation: keep `BucketPODocs` legacy bucket name `po-files` to avoid renames; new buckets get distinct names.

R4 Biome `components/**` un-exclude will probably produce dozens of new lint hits. Mitigation: land as a single Phase 2 commit with all fixes applied; do not mix with other work.

## 7. Open Questions for Operator

Q1 Should QIR review be mandatory before quotation `draft → sent`, or optional? Affects Phase 1.2 UX placement.

Q2 Is invoice payment-receipt attachment a single PDF or multiple files? Affects Phase 3 column shape (`attachment_object_key TEXT` vs `attachments JSONB`).

Q3 Auth refresh token lifetime + rotation policy: keep symmetric HS256, or move to RS256 + JWKS? Affects Phase 5.2 surface.

Q4 Excel import scope: still needed once QIR replaces the legacy intake path? If not, drop `xlsx` rather than swap to `exceljs`.

Q5 Coretax XML export priority vs the rest of phase 4: defer or include now?
