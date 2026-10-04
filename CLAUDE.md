# CLAUDE.md

Guidance for Claude Code when working in this repository.

## Project Overview

InternalGNS is the internal quotation to purchase-order to invoice system for
PT Global Niaga Sakti. It is a Go REST API and a React single-page app in a
Bun-managed monorepo.

- Backend (`apps/api`): Go 1.27, Chi v5 router, pgx v5 against PostgreSQL,
  Goose migrations, JWT auth with role-based access, slog logging. SQL is
  hand-written in `.sql` files that are embedded and parsed at startup
  (`apps/api/db/queries`); there is no ORM or code generator.
- Frontend (`apps/web`): React 19 with strict TypeScript, Vite 8, TanStack
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
  The MinIO server is the Silo fork (`pgsty/silo`, pinned by release tag and
  index digest in both compose files and `ci.yml`), since MinIO, Inc. pulled its images; its
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

The refresh token travels only in the `gns_refresh` cookie, never in a
response body: HttpOnly, Secure, SameSite=Strict, `Path=/api/v1/auth`,
host-only on the API host, with no Max-Age (only a development API on
plain-http loopback drops Secure; `shared/session`). Refresh reads the cookie
and nothing else. Refresh and logout are the only cookie-authenticated
routes, so `session.Guard` refuses them with a 403 unless `Origin` is listed
in `CORS_ALLOWED_ORIGINS` and `X-GNS-CSRF: 1` is sent. Logout, every refused
refresh, and any change that ends the caller's own session answer with a
Set-Cookie that expires the cookie; another user's cookie dies on its next
refresh. CORS grants credentials to exactly the listed origins, and config
refuses `*`, an empty list, or a malformed origin in every environment.
Details: `docs/backend_dev_guide.md` (Sessions and CORS).

The web keeps the access token in memory only (`lib/session.ts`) and never
writes a token to web storage; tokens an older build left in
`sessionStorage` are removed unread. Every page load, `/login` included,
restores the session with a credentialed refresh, and a refused restore is
not retried until the session changes. The tabs of a browser share the one
cookie, so every rotation and the logout run under one Web Lock, and the
rotating tab hands the new access token to the others on a
BroadcastChannel; a logout or a login in one tab ends the session in the
others. A 401 refreshes once and replays the request once; a failed refresh
ends the session and the authed shell leaves for `/login`.

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
make e2e-csp        # The suite under the enforced production CSP
make cover          # Both coverage gates
make lint           # go vet, golangci-lint when installed, and Biome
make fmt            # gofmt and Biome format
make gen-types      # Regenerate web API types from the Go DTOs
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
cmd/gentypes/       Web API types from the DTO allowlist
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
                    listq (list query builder), sheet (XLSX; money columns are
                    numbers so Excel can sum them), assetproxy
                    (descriptor-driven presign handlers, one set reused by
                    every slice), money, tz, validate (phone and email
                    rules the web mirrors), live (quotation change
                    notices, LISTEN and fan-out)
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
endpoints return the total count in the `X-Total-Count` header. A stale
`If-Match` is a 409 from `httperr.VersionConflict()` with `code:
"version_conflict"` (a PO lock carries `po_locked`); the web branches on the
code through `lib/errors.ts`, never on the detail text.

Every query key a repo reads is listed in `db/queries/required.go`, and
`Load()` fails at startup when one is missing; add the key in the same commit
as the query.

Every type that crosses the wire is named (no map or anonymous struct
responses) and listed in `cmd/gentypes/allowlist.go` with its TS name; a test
there fails when a json-tagged struct is neither listed nor skipped with a
reason. After changing a DTO run `make gen-types` and commit
`apps/web/src/types/generated.ts` with it. A request field the server defaults
when absent carries `omitempty`, so the web type marks it optional.

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
  Validity and shipping days run from 1 to 365 (`validate.MaxDays`, a 422
  on the field; the database refuses only below 1), on the PO's shipping
  days too, and the web inputs carry the same bound. Shipping address, cost
  and days live on the one shipping line, kept when any of the three is
  given, on the quotation and in Ubah PO alike (`fn_update_po_items`); a
  line with no cost is no charge (harga jual 0) and the PDF prints only its
  Delivery Time. The address is optional until the PO gate; once the PO is
  ON_PROGRESS, Ubah PO requires it while any product line lacks its own
  destination.
  A draft may keep unfinished product lines, but sending refuses (with the
  count) while any offered product line lacks its product, unit, vendor,
  harga beli or harga jual, and while `validity_days` is empty, since a sent
  quotation without one would never expire (a draft without one can still
  be cancelled). The web sends any typed validity, 0 included, so the
  server answers it with a field error instead of storing none. A line
  marked Tidak Ditawarkan (`is_available`
  false, `noOffer` in the wizard) is a request the company cannot offer:
  `fn_prepare_quotation_lines` stores it at harga jual 0 with no vendor, the
  PDF prints No Offer, it never blocks sending, `fn_create_purchase_order`
  leaves it out of the PO, and accepting needs at least one offered line.
  The same function links a vendor a line names by `vendorId` when the item
  has no link to it yet, and refuses a `vendorProductId` that names another
  product (P0014). New lines, from the RFQ import or picked by hand,
  start from `fn_recommend_lines` (`GET /items/recommendations`): the vendor
  on this client's newest sent or accepted deal for the item at its current
  harga beli, else the cheapest active vendor, and the harga jual of this
  client's newest deal, else any client's; an item never sold starts at 0.
  Revisi is not a manual move: Buat Revisi (`POST /quotations/{id}/revise`,
  offered when `canRevise`, i.e. from sent) clones a new draft version with
  `parent_id` and a `Rev.n` number and moves the original to revision.
  Kedaluwarsa is set only by `fn_expire_quotations`, which expires sent
  quotations past `validity_days` from the last send, by WIB date. The API
  runs it at startup and then hourly (`quotations.RunExpiryLoop`), and
  `pg_try_advisory_xact_lock` keeps two replicas from both doing a run.
  A saved draft is edited live, by several users at once, one part each.
  The parts are the header (contact, shipping, terms, discount) and each
  line (`line:<id>`); `POST /quotations/{id}/locks` claims one for two
  minutes (`EditLockTTL`, renewed every 30 s by `useEditLocks`), and a part
  someone else holds is a 409 `edit_locked` whose detail names them. A line
  save and the header save need the caller's claim; add, delete, the
  Tidak Ditawarkan toggle and a contact change
  (`fn_quotation_update_contact`) need the part free; the edit page claims
  the header when a contact is picked and sends it while holding the
  header. The full-draft `PUT` and
  leaving draft are refused while another user holds a part. The client's
  requests (Permintaan, `/quotations/{id}/requests`) follow the same
  contract (`fn_quotation_request_*`): adding one needs only the draft, a
  save needs `If-Match` with the request's `rowVersion`, and a delete needs
  every line linked to it free, since it clears their `request_id`. Every
  change calls `fn_quotation_notify`, which `pg_notify`s
  `quotation_events`; one pooled connection LISTENs (`shared/live`) and
  fans the notices out to `GET /quotations/{id}/events`, a server-sent
  event stream the web reads with fetch (`lib/event-stream.ts`, since
  EventSource cannot send the token). A notice sent while that connection
  is down is lost, so every LISTEN after the first sends `resync` to each
  open stream. The stream ends after five minutes and on shutdown; the web
  reconnects and reloads the draft and its requests on every event and
  reconnect. The edit page shows another user's line or header read-only
  with their name and frees its claims on leave, including on pagehide.
- Purchase order: PENDING, UPLOADED, ON_PROGRESS, DELIVERED, CANCELLED.
  PENDING and UPLOADED follow the PO file: attaching it moves PENDING to
  UPLOADED and removing it moves back, and neither is a manual move. Every
  attach (PO file, logo, item image, invoice attachment or proof) first stats
  the object, so a key with no upload behind it is a 422. UPLOADED
  goes to ON_PROGRESS; ON_PROGRESS to DELIVERED or back to UPLOADED; any open
  state to CANCELLED with a reason. The delivery-note number is stamped on
  ON_PROGRESS or DELIVERED together with its WIB issue date
  (`delivery_note_date`), which the note prints as its Date above the PO No
  and PO Date rows, and DELIVERED creates the invoice. DELIVERED and
  CANCELLED are terminal, and the file is locked in both. A PO keeps at least
  one product line and every product line priced above zero: the line edit
  (`fn_update_po_items`) refuses otherwise, and so do ON_PROGRESS and
  DELIVERED, so no Rp 0 invoice is issued. A qty 0 line stays allowed, but
  ON_PROGRESS and DELIVERED need one product line with a quantity. Both
  moves also pass the completeness gate (client, vendor and shipping-address
  data), a 422 `po_incomplete`; delivery runs it again, since ON_PROGRESS
  edits and client edits can reopen a gap. Each PO line stores its own
  supplier (`vendor_product_id`), copied from the quotation line only when
  that link is for the line's product, and the items list and the gate
  read it from the PO line. The line edit takes `vendorProductId` (a link
  for the line's product) or `vendorId`, and refuses a `quotationItemId`
  from another quotation. A link the PO already stores is kept even after
  its vendor is deactivated; any other pick goes through
  `fn_link_vendor_item`, the link rule `fn_prepare_quotation_lines` shares,
  so an inactive vendor is refused there.
- Invoice: draft, sent, paid, cancelled; overdue is stored only on legacy
  rows. Draft goes to sent; sent or overdue to paid, which stamps `paid_at`
  and takes an optional proof stored under `invoices/<id>/payment/`; marking
  a paid invoice paid again is a no-op, or a 422 when it carries a proof. Draft,
  sent or overdue go to cancelled with a reason, and only when the invoice has
  a PO; `POST /invoices/{id}/replacement` then issues a Pengganti draft for
  the same PO. Terlambat is derived, never set: `fn_invoice_effective_status`
  (a stored overdue, or a draft or sent past its due date) is the one rule the
  list, summary and dashboard read. The invoice list leaves cancelled
  invoices out until Dibatalkan is picked in its filter; a cancelled row
  opens itself with `?invoiceId`, since the quotation route shows the newest
  invoice, its Pengganti once one exists, and offers no Coretax XML, which
  the API refuses for a cancelled invoice.

Status labels are Indonesian and come from the API (`StatusLabel` in each
package); `src/lib/status.ts` mirrors them for fields that carry only the key.

Clients get a four-digit number from the server. A blank number on create is
filled by `fn_next_client_number`; a typed one must be four digits and unused,
and it is locked once a quotation uses it, because every document number
embeds it.

A client's NPWP follows one rule, `validate.ClientNPWP`, mirrored by
`optionalNpwpError` in the web: an Indonesian client (country IDN or blank)
has the 16 digits Coretax files, typed with or without separators and stored
as digits only (`validate.StoredNPWP`; the printed form overflows the
20-character column); a foreign buyer keeps its own tax id. The PO gate
refuses ON_PROGRESS and DELIVERED on a malformed Indonesian NPWP, since the
invoice issued at DELIVERED would fail the Coretax export.

## Frontend layout (`apps/web`)

Feature-based with file-based routing:

```
src/
  routes/            TanStack Router, auto-generated route tree
  features/          One folder per feature: api.ts, hooks.ts, components
  components/shared/ Sidebar, Modal, tables, pagination, states, links
  hooks/             Cross-feature hooks
  lib/               api-client, session (in-memory token), rbac, format,
                     status, entity-link, chart helpers, ui (tailwind class
                     primitives), useListScreen, validation (form field
                     rules), form-errors (422 to inputs), event-stream
                     (server-sent events over fetch)
  styles/            tailwind.css (entry, @theme tokens, base layer)
  test/              renderHook, query and browser-tab fakes for hook tests
  types/             generated.ts (from Go DTOs) and api.ts
```

Server state is TanStack Query; `lib/api-client.ts` attaches the in-memory
JWT from `lib/session.ts` and maps errors. The API contract is
`types/generated.ts`, written by `make gen-types` from the Go DTOs
allowlisted in `apps/api/cmd/gentypes`; CI regenerates it and fails on any
diff. `types/api.ts` re-exports it under the app's names and adds
only what Go does not carry: narrowed unions for text the database fixes and
query-only types. There is no OpenAPI spec.

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
- `EntityLogo` is the list avatar: initials, or an image when given `src`.
- `RecentQuotations` is the Quotation Terakhir section of the product, vendor
  and client pages: the five newest quotations that reached the client (every
  status but draft and cancelled) from `GET /items/{id}/quotations`,
  `/vendors/{id}/quotations` and `/clients/{id}/quotations`, with the
  quotation status badge; each page passes only its own columns. A failed
  load shows in the section (`throwOnError: false`), never on the route
  error boundary, so the page and its unsaved form stay.

Stored files (logos, product photos, attachments) come through the
authenticated API proxy, and the enforced CSP allows images only from self,
`blob:` and `data:`, so show one through `hooks/useObjectUrl` (a blob URL it
revokes) and never point an `<img>` at an API URL. Product photos are shrunk
in the browser before upload (`lib/image-shrink`, WebP within 1600px). A
product keeps up to eight (`item_images`, `MaxItemImages`, enforced by
`fn_item_image_add`); `items.image_object_key` names the cover (Foto Utama),
which every list, search hit and thumbnail reads. `features/items/ProductPhoto`
shows the cover and adds photos, several at once; `ProductGallery` is the
swipeable scroll-snap slider below it, loading only the shown photo and its
neighbours, with Jadikan Foto Utama and Hapus Foto. Removing a photo only
drops its row (a removed cover passes to the oldest left), leaving the object
to `cmd/orphan-blobs`, which keeps every gallery key. Upload keys are stamped
in nanoseconds, so repeated camera names never share one.

List screens share one state machine, `lib/useListScreen.ts`: search with
debounce, filters, page, per-page, and the reset-to-page-1 invariant. Note which
mutator resets the page — `setSearch`, `applyFilters` and `setItemsPerPage` do,
`clearSearch` and `patchFilters` do not, because removing a filter chip must
keep the reader in place. Each screen still owns its own filter defaults and
query call, and passes the server total to `usePageWithin`, which moves the
reader to the new last page when a narrower result ends before the current
one. Client-side tables (the quotation product tables) clamp the same way
through `clampPage` in `lib/pagination.ts`, and every pager renders
`components/shared/PageButtons`.
`useListScreen` also reports `narrowed` (a search, or filters off their
defaults), and every list's empty row goes through `emptyListText`
(`lib/list-empty.ts`), so a search or filter with no match says
`Tidak ada hasil untuk …` instead of the list's own "Belum ada …".
Every list shows what narrows it as chips (`components/shared/ActiveFilters`);
the master-data lists build them with `filterChips` (`lib/filter-chips.ts`),
and every chip removes only its own filter.

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
- The PDF tests skip without xelatex. CI runs them in the API runtime image
  (the `pdf layout (xelatex)` job) with a Postgres service, so the layout
  tests, the delivery note, quotation and invoice downloads and the PDF
  acceptance steps all run there, and any skip fails the job. A local skip
  is not a pass.
- Web logic tests are Vitest in node (`src/**/*.test.ts`). Hook tests are
  `*.hook.test.ts(x)` in a happy-dom project and render through
  `src/test/renderHook.tsx`. `bun run test` runs both projects.
- Components and routes are covered by Playwright in `apps/web/e2e`: one
  scenario per main or alternative flow, plus the role matrix. The setup
  project creates or reactivates the `e2e.*@globalsakti.com` users and saves
  an access token per role for the specs' API calls; the teardown project
  deactivates the users, since users cannot be deleted. `fixtures.ts` signs
  every test context in for real and starts it from that login's
  storageState, on its own `x-forwarded-for` address
  (`test.use({ session: "finance" })`). The address is added by a route on
  API requests, not as an extra header, which a cross-origin API would refuse
  in CORS. Never share one saved refresh cookie
  between contexts: the first page load rotates it, and the API answers the
  next context's replay by revoking every session of that user. Every page
  load spends one refresh (20 per minute per address), so the own address
  also keeps parallel tests from throttling each other. `make e2e` runs
  against the dev stack from `make dev`, with admin credentials from
  `apps/api/.env`; `E2E_BASE_URL` and `E2E_API_URL` point it elsewhere.
  Login allows 10 attempts per minute per address and account under a
  ceiling of 100 per address, so a rerun inside a minute may wait out the
  window.
- The SPA content policy is enforced (the web label in `compose.prod.yml`),
  so every test fails on a violation its browser reports. `make e2e-csp` (and
  the CI e2e job) builds the SPA against a separate API origin, serves `dist`
  with that policy, and runs the whole suite against the throwaway
  `gns_csp_test`; `e2e/csp.spec.ts` proves the header is live. A new
  dependency that injects an inline `<style>` or loads from another host
  fails there: fix the cause, never add `unsafe-inline` or `unsafe-eval`.
- Lighthouse CI (`bun run lighthouse`, the CI `lighthouse` job) audits 12
  pages three times each and fails any category below 0.95.
  `lighthouse/login-fixture.cjs` signs in inside Chrome, so every page
  restores its session from the refresh cookie and is scored as itself, not
  as `/login`. Fix a failing audit at its cause; never lower a threshold or
  drop a URL.

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
   instead of off its top edge. The party block (To, Address and the rest)
   is a top-aligned `tabularx` whose value column is ragged-right `X` with
   hyphenation off (English patterns would split Indonesian names), and
   the client name and address go through `pdfgen.LatexBreakable`, so a long
   name or address wraps instead of printing over the number and date block.
   The layout fixtures carry a long name and a full office address, and
   `TestLatexExports_LongPartyWraps` checks with `pdftotext -bbox` that they
   stay left of that block. `TestLatexExports_Clean` and `_MultiPage`
   fail on any overfull or underfull box, which is what keeps text from being
   cut.
9. Invoice tax figures are rounded per line, then summed to the header (matching
   DJP e-faktur), and `ppn_amount` is computed from the already-rounded DPP
   base. The quotation (`fn_line_dpp`, `fn_line_ppn`, stored by the functions
   that write its totals) and the PO (`v_po_totals`) use the same rule, so all
   three agree, and the web previews mirror it (`computeTaxBreakdown`).
   Invoices snapshot `gross_unit_price` and `total_discount`, so the PDF
   prints a gross line plus a real discount row (`TotalProduk − Diskon = DPP`)
   without reading the quotation. Every PDF prints the sen, and the Go line
   math (`pdfgen.BigMul`) rounds half away from zero like Postgres `ROUND`,
   so a fractional quantity still adds up. Do not restate already-filed
   invoices: their amounts are never recomputed, and a wrong invoice is
   cancelled and replaced by a Pengganti. Only the invoice and due dates stay
   editable, and only until the invoice is paid or cancelled.

## Tooling and style

- Python (only the `apps/api/db/import` tool) runs through `uv`; never call
  python, python3, pip, or pip3 directly.
- The JavaScript toolchain uses `bun` and `bunx`, not npm or npx.
- Comments are in English. Section, function, and class header comments stay
  within five words. No emoji and no decorative separator lines.
- UI text is Indonesian, written inline; there is no i18n layer. Problem
  details a user can read (business rules, validation) are Indonesian too.
- Use conventional commits (`feat:`, `fix:`, `test:`, `docs:`).
