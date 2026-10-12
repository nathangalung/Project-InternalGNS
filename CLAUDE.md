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

Five roles (migration 00104), named in `shared/roles` with what each may see
or change. The backend enforces them at the router mount (`requireRole`,
`readOnlyFor` in `internal/app`), per route (`rolegate.Deny` inside a
feature's `Routes`), in the handlers that hide figures or keep stored
prices, and at the storage proxy, whose bucket gate (`authorizeBucket`)
lets a role store only what its routes attach (`storage.CanWriteObject`).
The frontend mirrors them in `src/lib/rbac.ts`, whose capability
checks fail closed for an unknown role, and in the route guard
(`roleCanOpen`, which also keeps read-only roles out of the editors). User
management picks a role from a dropdown with an Indonesian label and hint
(`features/users/helpers`).

- superadmin (Super Admin): everything, including user management. Only
  superadmin moves a quotation (Dikirim, Disetujui, Ditolak, Dibatalkan) and
  revises it (`roles.MovesQuotations`), so the last word before and after a
  quotation reaches the client stays with the owner.
- operational (Kepala Operasional): quotations, purchase orders, the catalog
  and vendors, harga beli and harga jual. It edits drafts, sets selling
  prices and discounts, and downloads the quotation PDF, which is its last
  step; it runs a PO (file, number, notes, status, cancelling, the
  delivery note's row notes, its client and narahubung while Ubah PO is
  open)
  with superadmin (`roles.ManagesPOs`). It deletes an unused client or vendor
  for good (Hapus Permanen).
- operational_input (Input Data Operasional): client data, client requests,
  harga beli and the catalog (products, photos, vendors, product links). It
  writes quotation drafts but never sees or sets a selling figure: no harga
  jual, discount, shipping charge, totals, tax or profit, no harga jual
  history, no quotation PDF and no quotation or PO export. Its line and
  header saves keep the stored harga jual, discount and shipping charge
  (`quotations/price_guard.go`), and its new lines start at harga jual 0
  for a head to price. Since Tidak Ditawarkan stores harga jual 0, it marks
  only a line no head has priced: on a draft line with a harga jual, the
  toggle and a line save with `isAvailable` false are a 403
  (`ErrPricedNoOffer`, the price read after the quotation row lock, in the
  save's transaction), while its new lines may start unoffered and putting
  a line back on offer stays open to it. It moves a draft to another client
  like any draft writer. On a PO it only views and keeps the purchase data
  current: in Ubah PO it changes harga beli and vendor of the stored lines,
  everything the client ordered stays as stored (`keepStoredSale`; each line
  carries its PO line `id`, adding or dropping one is a 403), and it neither
  moves the PO nor touches its file, number, notes, client or delivery note
  notes. The storage proxy
  refuses it a PO document upload too. It deletes an unused client or
  vendor for good, as the heads do.
- finance (Kepala Keuangan): invoices, Kas Lain and the financial dashboard,
  and reads quotations, POs, products and vendors without changing them.
  Keeps client writes, so it fixes a client's NPWP and TKU and deletes an
  unused client for good, but never a vendor.
- finance_input (Input Data Keuangan): invoices and POs, with what is billed
  but no harga beli or profit. It records payment (Lunas is its one move,
  with the proof), prepares the Coretax export, and builds the payment
  reminders from the invoice export, whose Terlambat rows carry the days
  past due and the contact to write to. It reads clients without changing
  or deleting them, and adds and edits Kas Lain entries but neither deletes
  nor exports them. No quotations, no dashboards beyond the overview, no
  Pengganti, no invoice dates or attachment. In the invoice bucket it stores
  only a key directly under `invoices/<id>/payment/`, the proof folder.

A hidden figure is left out of the JSON, never zeroed: each money field
carries `omitempty`, each feature's `redact(role)` blanks what the role may
not see, and the web gates on the field being present (`seesSelling` on a
quotation, `poGrandTotal` on a PO, `hasCost` for profit). A total filter or
sort on a figure the role cannot see is a 403, so it cannot be probed. The
dashboard overview is open to everyone with financial fields zeroed;
financial figures reach only superadmin and the finance head.
`TestRouter_RoutePolicy` (`internal/app`) checks every role against the
gated routes, and `TestRouter_MasterDataByRole` the hidden keys.

Sessions end on expiry or by version. Every access and refresh token carries
the `users.session_version` it was minted under, and the auth middleware
refuses any other. A role change, a deactivation, a password change, or a
rotated refresh token replayed past its 10-second grace bumps the version
and revokes refresh tokens, so every open session of that user ends on its
next request.

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
make seed-dev       # Migrate, build the historical seed, load it with the master data (dev only)
make reimport-dev   # Replace business data with the historical seed, then verify (dev only)
make seed-build     # Rebuild the historical seed from Data/ and db/import/local/
make db-ui          # pgweb database browser (:8081)
make test           # Go tests, web typecheck, and Vitest
make test-api       # Go tests on a throwaway database, as CI runs them
make e2e            # Playwright against the running dev stack
make e2e-csp        # The suite under the enforced production CSP
make examples       # docs/example: one file of every export, invented data
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
                    background loops (refresh purge)
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
  seeds/            Master data; the historical seed is built, never committed
  import/           Excel-to-seed tool (uv)
```

Handlers stay thin; each feature owns its repo and DTOs. The API is mounted
under `/api/v1`. Errors are RFC 7807 problem+json (`shared/httperr`). List
endpoints return the total count in the `X-Total-Count` header. A stale
`If-Match` is a 409 from `httperr.VersionConflict()` with `code:
"version_conflict"` (a PO lock carries `po_locked`); the web branches on the
code through `lib/errors.ts`, never on the detail text. A PO's lines,
details, notes and client writes refuse a request without `If-Match` with
a 400, so no caller overwrites them unguarded. A plpgsql validation raise
(P0014) that names its input with `USING COLUMN = 'clientId'` renders as
that field's 422 (`httperr.FromDBErr`); one without a column stays prose.

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

Quotation, invoice and delivery-note numbers are a running number per
document type and per year that restarts at 00001 every year, five digits
wide and growing past 99999, then the Roman month and year of the WIB issue
date, the year the count belongs to: `Q-00011/GNS/X/2026`,
`INV-00007/GNS/X/2026`, `DN-00007/GNS/X/2026`, and `Q-00001/GNS/I/2027`
after the last quotation of 2026. `fn_next_doc_no(type)` takes the next
value from the `doc_counters` row of that type and the year of
`CURRENT_DATE` under its row lock, creating the row with the year's first
number, so concurrent callers queue and a rolled-back document leaves no
gap; it is never a SEQUENCE. Migration 00101 renumbered every number
issued before it within its year, in order, and the notes that copy one;
sorting a list by number orders by year first (`listq.DocNoOrder`). A
revision keeps its base number with `Rev.n`, so its base's year, and a
Pengganti draws a new invoice number. Numbers issued before 00098 keep their
legacy format (year, client number and a yearly count). A re-imported
document also keeps the number it was first issued under in `legacy_no`
(quotations, invoices) or `legacy_dn_no` (the PO's original DO): only the
import writes it (00099), the list searches match it as typed text but never
as a period, and the detail pages show it muted as No. lama. A purchase order's
number is the client's own PO number: accepting a quotation leaves
`po_number` NULL until a user enters it (blank means none), ON_PROGRESS and
DELIVERED require it (a `po_number` gap on the PO in the completeness gate,
and `fn_change_po_status` refuses it too), and a PO in either state cannot
clear it (`fn_update_po_details`, a 422 on `poNumber`). It is unique per
client (`uq_purchase_orders_client_po_number`), not globally, and the web
shows a missing one as Belum ada No. PO.

- Quotation: draft, sent, revision, accepted, rejected, cancelled.
  Draft goes to sent or cancelled; sent to accepted, rejected or cancelled;
  revision to rejected or cancelled. Nothing expires: a sent quotation stays
  sent until a user moves it, whatever its validity. Rejected and cancelled need a reason.
  Accepted creates the PO in the same transaction. Only drafts are editable.
  The client's own reference (No. Referensi Klien, `client_ref_no`, printed
  as Your Ref No.) is typed in the wizard's summary step and saved with the
  header; the client's four-digit number never stands in for it.
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
  harga beli or harga jual, and while `validity_days` is empty, since the
  PDF prints the Validity (a draft without one can still be cancelled). The web sends any typed validity, 0 included, so the
  server answers it with a field error instead of storing none. A line
  marked Tidak Ditawarkan (`is_available`
  false, `noOffer` in the wizard) is a request the company cannot offer:
  `fn_prepare_quotation_lines` stores it at harga jual 0 with no vendor, the
  PDF prints No Offer, it never blocks sending, `fn_create_purchase_order`
  leaves it out of the PO, and accepting needs at least one offered line.
  Putting it back on offer restores no price, so operational input marks
  only an unpriced line (see Roles), and the web toasts the refusal.
  The same function links a vendor a line names by `vendorId` when the item
  has no link to it yet, and refuses a `vendorProductId` that names another
  product (P0014). A save of a draft, the full `PUT` included, runs it only
  after locking the quotation row and passing the status checks, so a
  vendor link never locks before the quotation; a create runs it after the
  client checks.
  New lines, from the RFQ import or picked by hand,
  start from `fn_recommend_lines` (`GET /items/recommendations`): the vendor
  on this client's newest sent or accepted deal for the item at its current
  harga beli, else the cheapest active vendor, and the harga jual of this
  client's newest deal, else any client's; an item never sold starts at 0.
  Salin ke Offer makes the request the offer as a real catalog item: a
  picked catalog request is that item, and typed text goes through
  `POST /items/match-rows` with `autoCreate`, the Excel import's own
  matcher and threshold (see IMPA codes below): a request with a code
  reuses only the product holding that exact code, one without a code the
  closest name (a look-alike asks the user to check it), and anything else
  is added to the catalog, and the pick then applies the line recommendation as an
  import does. Its `minScore` defaults to 0.5, and one outside (0, 1] is a
  422 on the field, since above 1 nothing matches and `autoCreate` would
  add every row again. Every product line shows the
  request and the offer side by side at one size (`RequestOffer`, in the
  wizard cards, the summary and the detail table), and an offer that is not
  what was asked turns orange. A line's Belum lengkap badge opens its editor,
  and a draft's detail page counts the lines the send rule refuses
  (`incompleteLines`, mirroring `fn_change_quotation_status`) with a
  Lengkapi Sekarang button to the editor.
  Revisi is not a manual move: Buat Revisi (`POST /quotations/{id}/revise`,
  offered when `canRevise`, i.e. from sent) clones a new draft version with
  `parent_id` and a `Rev.n` number and moves the original to revision.
  A draft can move to another client, typically a company of the same
  holding (no holding is stored): `PATCH /quotations/{id}/client`
  (`{clientId, contactId?}`, `fn_quotation_update_client`) for every draft
  writer, refused past draft with a 409 that names Buat Revisi, since the
  PDF already reached that company; the revision's draft can move. It is a
  header change (the caller's header claim, no `If-Match`, since every line
  save bumps the draft's `row_version`) and notifies the open editors. It
  locks the quotation row, then the client row `FOR SHARE`; a missing or
  inactive client and a contact of another client or inactive are a 422
  on `clientId` or `contactId`. The client name snapshot and the contact
  are replaced (no `contactId` leaves none); the client's reference
  (`client_ref_no`) stays, since it is free text the summary step still
  edits, and so do the lines, prices and vendors (no recommendation is
  rerun). A history row keeps the status (draft to draft) and notes
  `Klien diganti dari <lama> menjadi <baru>`; the PDF date reads only a
  draft to sent move, so it is unaffected. The edit page's step 1 offers
  Ganti Klien (`ClientChangeModal`: the wizard's paged picker from
  `useClientPicker`, then the new client's narahubung, completed on the
  spot by `ContactCompletion`), claiming the header for itself and hidden
  while another user holds it; a sent quotation's client card says to
  revise instead.
  A quotation keeps its offer as it left draft: every move out of draft
  (and `fn_create_quotation` given a status past draft, and the historical
  seed) runs `fn_freeze_quotation_offer`, which copies each line's offered
  product name and IMPA code into `quotation_items.offered_name` and
  `offered_impa` (00112, which froze every quotation already past draft).
  The detail and the PDF (`quotations.get_items`), the vendor page's
  Quotation Terakhir (`vendors.recent_quotations`) and the PO made on
  acceptance (`fn_create_purchase_order`) read the frozen pair, so a catalog
  rename or code change never restates a quotation the client received. A
  draft, its Buat Revisi clone included, keeps both NULL and reads the
  catalog live. `offered_name` marks a frozen line, so a product that had no
  code when sent keeps none even after it gains one.
  The quotation PDF is dated at its last send, a draft to sent move, so
  the Validity it prints runs from the day the client received it; a draft
  prints today, and a row with no such move (legacy, or
  imported straight as sent, whose NULL to sent creation log carries the
  import time) prints its creation date. Its ATTN block prints the
  chosen contact's own email and phone, read by id even once that contact
  is deactivated, and none when the quotation has no contact. Its DELIVERY
  PLACE prints the shipping line's address, else the vessel.
  The list export (`GET /quotations/export.xlsx`) carries the stored
  breakdown with shipping in its own column: Total Produk, Diskon,
  Pengiriman (total minus total_produk), Sub Total, then PPN as text
  (12% or Tanpa PPN) beside Nilai PPN (0 without PPN), and Grand Total.
  These figures ride on the list row as `json:"-"` fields, so the list
  JSON stays as it was.
  A saved draft is edited live, by several users at once, one part each.
  The parts are the header (client, contact, client reference, shipping,
  terms, discount) and each line (`line:<id>`); `POST /quotations/{id}/locks`
  claims one for two
  minutes (`EditLockTTL`, renewed every 30 s by `useEditLocks`, which drops
  a claim only when the server refuses the renewal, a 4xx per
  `isFinalRefusal`, and keeps it through a network error or a 5xx for the
  next beat), and a part
  someone else holds is a 409 `edit_locked` whose detail names them. A line
  save, the header save and a client change need the caller's claim; add, delete, the
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
  CANCELLED are terminal, and the file is locked in both. The lines lock in
  both too, with one exception: while a delivered PO's invoice is cancelled
  and no live invoice replaces it, Ubah PO opens again, so the Pengganti
  issued afterwards bills the corrected lines (and a delivery-note reprint
  shows them); the Pengganti locks them again. `fn_po_lines_locked` is the
  rule `fn_update_po_items` and the PO read (`linesLocked`, which the web
  gates Ubah PO on) share, and a delivered PO with no invoice at all stays
  locked. A reopened edit keeps what DELIVERED required: one product line
  with a quantity, and the shipping address while any product line lacks
  its own destination; `fn_replace_invoice` also refuses a PO with no
  billable product line. A PO keeps at least
  one product line and every product line priced above zero: the line edit
  (`fn_update_po_items`) refuses otherwise, and so do ON_PROGRESS and
  DELIVERED, so no Rp 0 invoice is issued. A qty 0 line stays allowed, but
  ON_PROGRESS and DELIVERED need one product line with a quantity. Both
  moves also pass the completeness gate (the client's PO number, client,
  vendor and shipping-address data), a 422 `po_incomplete`; delivery runs it
  again, since ON_PROGRESS edits and client edits can reopen a gap. The
  gate and the move run in one transaction (`Repo.GatedTransition`): the PO
  row is locked first, so the gate judges the status the move starts from,
  and the gate's client read holds the client row `FOR SHARE`, so a client
  edit waits and DELIVERED copies the buyer the gate passed. Each PO line
  stores its own name and code (`item_name`, `item_code`), copied from the
  quotation's frozen offer, and the PO detail, delivery note and invoice
  read only those, never the catalog (00112 filled the blank ones with what
  they printed). Ubah PO saves the name and code each line sends and
  refuses a product line without a name (422, `fn_update_po_items`). Each PO
  line stores its own supplier (`vendor_product_id`), copied from the quotation line only when
  that link is for the line's product, and the items list and the gate
  read it from the PO line. The line edit takes `vendorProductId` (a link
  for the line's product) or `vendorId`, and refuses a `quotationItemId`
  from another quotation. A link the PO already stores is kept even after
  its vendor is deactivated; any other pick goes through
  `fn_link_vendor_item`, the link rule `fn_prepare_quotation_lines` shares,
  so an inactive vendor is refused there. A harga beli that Ubah PO changes
  becomes that vendor link's current catalog price and quote date
  (00106), so the next quotation starts from what was paid; a price the
  edit leaves as it was never touches the catalog.
  The delivery note's Address is where the goods go
  (`deliveryNoteAddress`): the shipping line's address, else the one place
  every addressed product line names (compared without case or spacing),
  else the client's own address, which stays live like the To. No row
  repeats it. Its last column is Notes, one note per product line in
  `purchase_order_items.dn_note` (00114, up to 500 characters), so a
  reprint prints the same notes. NULL means never saved: the row prints a
  default worked out at render and on the items read (`dnNoteDefault`),
  "Kirim ke:" and the line's own destination when that is not the
  Address, else nothing. A saved note replaces it for good, and an empty
  one prints nothing. `PATCH /purchase-orders/{id}/delivery-note` saves
  `{notes: [{lineId, note}]}` (`fn_update_po_dn_notes`): If-Match is
  required, only the rows sent change, each `lineId` must be a product
  line of this PO (else a 422), and outside ON_PROGRESS and DELIVERED it
  is a 409 `po_locked`. It is for the roles that run the PO (`header`
  gate: superadmin and operational, `managesPOs` on the web). Ubah PO
  carries each kept line's note over by its `id`, since it replaces every
  line; a new line starts with none. On the PO detail, Unduh Surat Jalan
  opens `DeliveryNoteModal` for those roles: each product row with its
  saved note or default, Simpan dan Unduh saves every row once any changed
  and then downloads, Unduh with no change only downloads, and a refusal
  shows in the dialog. Every other role, and the list's download button,
  downloads directly.
  A PO carries its own client and narahubung (`company_client_id`,
  `contact_id`), copied from the quotation on acceptance. The gate, the
  invoice's contact and the payment reminder read the PO's contact (the
  quotation's only for an invoice without a PO); 00116 first copied the
  quotation's contact onto every PO still on the quotation's client, so
  nothing shown changed. An accepted quotation's Ganti Narahubung also
  sets its PO's contact while the PO keeps the quotation's client. The
  roles that run the PO move it to another client, typically a company of
  the same holding, with `PATCH /purchase-orders/{id}/client`
  (`{clientId, contactId?}`, If-Match required, `fn_po_update_client`)
  exactly while Ubah PO is open (`fn_po_lines_locked`): PENDING, UPLOADED
  or ON_PROGRESS, and a DELIVERED PO while its invoice is cancelled and no
  live invoice replaces it, so the Pengganti issued afterwards copies the
  new client as it is at issue (cancelling the invoice and issuing a
  Pengganti is how a bill to the wrong company of a holding is corrected).
  A CANCELLED PO, a DELIVERED one with a live invoice or none at all, and
  any PO with a live invoice are a 409 `po_locked`, since the invoice
  copied the buyer, and the cancelled invoice keeps the buyer it was filed
  with. It locks the PO row, then the
  client row `FOR SHARE`, the gate's order; a missing or inactive client
  and a contact of another client or inactive are a 422 on `clientId` or
  `contactId`, and a PO number the new client already uses
  (`uq_purchase_orders_client_po_number`) is a 422 on `clientId`. The same
  client with another contact only changes the narahubung; nothing
  changed is a no-op. Each change is a history row that keeps the status
  and notes `Klien diganti dari <lama> menjadi <baru>` (or `Narahubung
  diganti menjadi <nama>`, `Narahubung dikosongkan`). The quotation keeps
  its own client. Everything that names the PO's client reads it live by
  id: the list and its search, the delivery note's To and its Address
  fallback, the gate, the invoice made at DELIVERED (`fn_create_invoice`
  copies the buyer from the PO's client) and Total Pembelian, which counts
  a deal for its PO's client (the quotation's while it has no PO). The PO
  read carries `contactId`, `contactName`, `contactEmail` and
  `contactPhone`, read by id even once deactivated, and the PO detail's
  client card shows the PO's client and narahubung (only the client's
  reference comes from the quotation). Its Ganti Klien opens the same
  `ClientChangeModal` for `managesPOs` roles while `poClientEditable`
  (not CANCELLED and not `linesLocked`, the same signal as Ubah PO), and
  the gate's `contact_inactive` gap opens it too.
- Invoice: draft, sent, paid, cancelled; overdue is stored only on legacy
  rows. Draft goes to sent; sent or overdue to paid, which stamps `paid_at`
  and takes an optional proof stored under `invoices/<id>/payment/`; marking
  a paid invoice paid again is a no-op, or a 422 when it carries a proof. Draft,
  sent or overdue go to cancelled with a reason, and only when the invoice has
  a PO; `POST /invoices/{id}/replacement` then issues a Pengganti draft for
  the same PO. The web keeps the two apart (Batalkan Invoice, then
  Terbitkan Pengganti on the cancelled invoice), since Ubah PO opens only
  in between. The invoice stores its buyer's name, NPWP and address
  (`buyer_*`, copied by `fn_create_invoice`), and the detail, list, PDF and
  Coretax read those. A client edit never restates an invoice, draft
  included (the PO gate already required a valid NPWP and address at
  DELIVERED); only a Pengganti, which copies the client as it is then,
  changes it. Coretax refuses an invoice without a valid NPWP with that
  Pengganti route.
  The same way it keeps its quotation's payment terms (`payment_terms`,
  trimmed, NULL when blank, 00110), which the PDF prints as PAYMENT TERMS
  and the detail shows as Syarat Pembayaran; an invoice without terms (its
  quotation named none, or it was made before 00110) prints
  `PDF_PAYMENT_TERMS`, so a reprint never changes. A new invoice
  or Pengganti falls due on its date plus the day count the terms name
  (`fn_terms_days`: 1 to 365, an optional Net, then day, days or hari, any
  case or spacing, so "7 days", "Net 45 days", "14 hari", "30days"), else
  30 days ("Payment in Advance", "TRANSFER - CASH", "30 hari kerja", none).
  The web never computes a due date.
  An invoice without PPN (`ppn_enabled` false, see convention 9) has no
  faktur: its Coretax XML is a 422 and the bulk XLSX leaves it out.
  Country, email and TKU stay live. Terlambat is derived, never set: `fn_invoice_effective_status`
  (a stored overdue, or a draft or sent past its due date) is the one rule the
  list, summary and dashboard read. The invoice list leaves cancelled
  invoices out until Dibatalkan is picked in its filter; a cancelled row
  opens itself with `?invoiceId`, since the quotation route shows the newest
  invoice, its Pengganti once one exists, and offers no Coretax XML, which
  the API refuses for a cancelled invoice.

Status labels are Indonesian and come from the API (`StatusLabel` in each
package); `src/lib/status.ts` mirrors them for fields that carry only the key.

Clients get a four-digit number from the server. A blank number on create is
filled by `fn_next_client_number`; a typed one must be four digits and unused.
It stays editable after quotations use it, since no document number embeds
it.

A client or vendor entered by mistake is deleted for good (Hapus Permanen,
`DELETE /clients/{id}`, `DELETE /vendors/{id}`, no migration) only while no
document uses it: for a client no quotation, PO or invoice, counted in any
status and including a document that names one of its contacts; for a
vendor no quotation or PO line through any of its links. Active and
inactive records alike. A used one is a 409 `in_use` (`httperr.InUse`)
whose detail says where, for example "Klien ini sudah dipakai di 3
quotation, 1 PO dan 1 invoice. Nonaktifkan saja.", and deactivating stays
the way to retire it; a missing one is a 404. The client's contacts or the
vendor's links (`vendor_products`; there is no price history table) go in
the same transaction, the linked items stay. The repo locks the row and its
children `FOR UPDATE NOWAIT` before counting: a document being saved holds
a key lock on them, so the delete is refused at once with a retryable 409
(SQLSTATE 55P03, mapped by `httperr.FromDBErr`) instead of queueing into a
deadlock, and a document saved after the locks waits and then fails its
foreign key as a 404. The handler logs `permanent delete` with the user,
entity, id and name, since the row is gone. The logo object stays for
`cmd/orphan-blobs`, which sweeps any key no row names. The mount gates
already decide who may: the client writers (all but finance input) and the
catalog writers (superadmin and both operational roles), mirrored by
`editsClients` and `canWriteCatalog` on the detail pages, whose
`PermanentDelete` dialog shows any refusal inline.

A client's NPWP follows one rule, `validate.ClientNPWP`, mirrored by
`optionalNpwpError` in the web: an Indonesian client (country IDN or blank)
has the 16 digits Coretax files, typed with or without separators and stored
as digits only (`validate.StoredNPWP`; the printed form overflows the
20-character column); a foreign buyer keeps its own tax id. The PO gate
refuses ON_PROGRESS and DELIVERED on a malformed Indonesian NPWP, since the
invoice issued at DELIVERED would fail the Coretax export.

A contact needs an email or a phone. Create, and a PATCH whose result keeps
neither (a stored email the body leaves out still counts), is a 422 with
`clients.MsgContactReach` on both fields, mirrored by `contactReachError` in
the web; a missing client or contact is a 404 first. Imported contacts may
lack both: they stay listed and deletable, and the quotation wizard
completes a picked one in place (`ContactCompletion`, step 1 waits for it).
An active contact's email is unique within its client only
(`idx_company_contacts_email`, 00102), since one person can serve two
clients of a group. The client card on the quotation, PO and wizard pages
shows the document's own contact: the quotation detail and the PO read
carry `contactEmail` and `contactPhone`, read by id like the PDF, and the
card never borrows the company email or the client's first contact. The
wizard's client rows name the client only, and its picker
(`useClientPicker`, shared with Ganti Klien) pages every active client by
name ten at a time (`pickerWindow`), a search paging its hits the same way.

Two web links follow one rule. A vendor link's `product_url` is where the
vendor sells that product (Link Produk), and a vendor's own `store_url`
(00115) is its shop (Link Toko). `validate.ProductURL` and
`validate.StoreURL` keep only an http or https address with a host (a 422 on
`productUrl` or `storeUrl`, each with its own message), mirrored by
`productUrlError` and `storeUrlError` in `lib/store-link`, so the anchor
never runs script. The vendor create and edit forms (`VendorAddModal`,
`VendorDetail`) write Link Toko, with the vendor writes' roles; a blank one
stores NULL and, since PUT replaces the vendor, an absent one clears it.
The vendor, product vendor, quotation line and PO line reads carry it
(`storeUrl`, `vendorStoreUrl`), and `StoreLink kind="store"` shows it beside
the vendor's name on the vendor list and page, the product page and under
each quotation and PO line. Internal names keep the older store wording
for the product link (`StoreLinkModal`, `onEditStoreLink`, `storeLinks`).
Only `POST /items/{id}/vendors` writes Link Produk, and a cleared link
is sent as null. An unsent `costPrice` keeps the stored harga beli and its
quote date, so Ubah sends the price only when it was changed. Three places
write it: the Tambah Vendor and Ubah dialogs on the product page, and
`features/items/StoreLinkModal` (Tambah Link Produk, Ubah Link Produk), which
sends only `vendorId` and `productUrl` and is opened beside the picked
vendor in the quotation and PO product dialog and under each line on
the quotation and PO detail. It is offered only to the roles that write the catalog
(`canWriteCatalog`, passed as `storeLinks` to `ProductAdd` and as
`onEditStoreLink` to `ProductTable`), and in the dialog only for a vendor
the product already links (`vendorProductId`), since a link alone would
create one at harga beli 0. A save refreshes the item's vendors and the
quotation and PO queries, which read the link live. Every other role only
sees it.
`StoreLink` shows Link Produk in a new tab on the product and vendor pages, under
each offer on the quotation and PO detail, and beside the picked vendor in
the quotation product dialog.

One IMPA code belongs to one active product (`uq_items_impa_code_active`).
The import and Salin ke Offer match the code first, so a row whose code an
active product holds reuses it whatever its name, and only an unknown code
is auto-created, under the request text as typed. When that text was abbreviated or wrong, Tambah Produk Baru with
the right name and the same code is refused: the 422 on `impaCode` (create
and `PUT /items/{id}`) keeps its field message and carries `code:
"impa_taken"` with `impaHolder` (`items.IMPATakenProblem`: id, name, code,
default unit), never the item being saved. Inside a document's product
dialog the refusal names the holder and offers Pakai Produk Ini, which
picks it as a search hit does, and, for roles that write the catalog, Ganti
Nama Jadi the typed name. That calls `POST /items/{id}/rename`, which
changes the name only, wherever the product is used: a quotation past draft
keeps its frozen offer, and PO and invoice lines their own name, so a
rename reaches only the catalog and the drafts that read it, exactly as the
product page Ubah (`PUT /items/{id}`) always has. Items carry no row
version, so the rename takes no `If-Match`. The product page Ubah and the
catalog's Tambah Produk link the holder's name to its page instead.

## IMPA codes

An IMPA code is six digits. `validate.IMPA` (mirrored by `lib/impa` in the
web, `fn_impa_code` in the database and `values.impa_code` in the import,
all pinned by `validate/testdata/impa_rules.json`) reduces the forms people
type (`IMPA 190105`, `(190105)`, `19 01 05`) to the digits and reads a blank
or "-" as no code. Anything else is a 422 on its field with
`validate.IMPAMessage`: `impaCode` on item create and update,
`items[i].requestedImpa` on quotation lines, `requestImpa` on client
requests, `items[i].itemCode` in Ubah PO and `rows[i].impaCode` in
match-rows. A CHECK on `items.impa_code`, `quotation_items.requested_impa`
and `offered_impa`, `quotation_item_requests.request_impa` and
`purchase_order_items.item_code` (00113) keeps every other value out; 00113
validates each one only when no stored row breaks it and otherwise names
the count in a notice and leaves the row as it was. An RFQ code cell that
is not an IMPA code (a row number, the client's own code) is dropped.

Matching (`items/matchrows.go`, the RFQ import and Salin ke Offer): a row
with a code resolves only by that exact code among active products. When
no product holds it, `autoCreate` adds one under that code, else the row
stays unmatched; it is never matched by name. Only a row without a code
goes through `fn_match_request` with today's name tiers and threshold. A
search whose query is a code (`fn_search_items`, search-advanced) returns
only its holder, and no search compares codes by trigram similarity; a
partly typed code still finds codes containing it.

A name never repeats its own row's code. `fn_impa_split(name, code, move)`
takes the code out of the text, bare, marked `IMPA` (with or without a
space) or in brackets, with its ` - ` separator, and tidies the line it
was on; a code inside a longer token (`XJ-190105-B`, `A190105`), another
row's code and words like IMPACT stay, and a text that was only the code
keeps it. With `move`, an empty code takes the one code the text marks
`IMPA`. Triggers run it on every write: requests (`requested_name`,
`request_text`) move, offers and PO lines (copies of the catalog) and
products only strip. A product's marked code moves into its empty field
only in the item create and update handlers and in the import, after
checking no other active product holds it, since a trigger could hand it
to the wrong row in a bulk load. 00113 cleaned every stored product,
quotation line, request and PO line the same way. Invoice lines are never
touched: they are what went to DJP through Coretax.

The web keeps Kode IMPA and Nama Produk as two fields: the product dialog
has a typed Kode IMPA Request beside Nama Produk Request, and a read-only
Kode IMPA Offer (the picked product's) beside the Nama Produk Offer search,
which still takes a code or a name. Lists, the request and offer cells
(`RequestOffer`) and the pickers show the code apart from the name, a
missing one as "-" (`impaLabel`, display only). The PDFs print the name,
then the code in brackets.

## Units

A unit (Satuan) keeps the short code every document prints and exports
(PCS, PKT), never changed once used, so a reprint stays as filed. Units 1
to 33 carry the DJP Coretax names and codes UM.0001 to UM.0033; the
ship-supply units map to UM.0033 and are named by the long form of their
code (TIN Tin, PKT Packet, RLS Rolls), one name with no slash. Every other
way a unit is written is an alias in `unit_aliases` (migrations 00109 and
00111):
PC, PIECES and EA for PCS, CAN for TIN, SHEET and LEMBAR for LBR, PACK for
PKT. An alias is stored normalised by `fn_unit_text` (upper case, one
space between words, no trailing dot), and triggers refuse an alias equal
to a code and a code equal to an alias, so one text names one unit; an
ambiguous text (MT is Metrik Ton, LB is also the pound) stays out.
`GET /units` lists each unit's `aliases`, and the web resolves typed and
imported unit text through one helper (`features/units/match`:
`unitIndex`, `resolveUnit`, the same normalisation), used by the wizard
check and its submit, the RFQ import (which shows the resolved code), Ubah
PO and the unit picker, whose row reads `CODE - Name` and names the alias
a query matched. Never add a unit for a new spelling: add an alias. A new
unit or alias comes in a migration that names units by code in JOIN form
(a database without master data skips it), and the same rows go into
`db/seeds/01_master.sql` and `testutil.SeedMasterIfMissing`; a migration
test keeps the three alias lists equal. The server reads no unit text, so
nothing there resolves one. The historical import (`db/import/unit_map.py`)
reads the codes and aliases from `01_master.sql`, so it resolves a spelling
as the app does; only its reviewed `IMPORT_OVERRIDES` come first, each to
OTH (AMP in the old files is an ampoule, never Ampere).

## Kas Lain

Kas Lain (`/cash-entries`, `internal/cashentries`, migration 00105) records
money in and out beyond the sales and purchases the documents already
record: a date, Masuk or Keluar, a free-text category (the form suggests
those in use), an amount above zero and a note, all required. Superadmin
and the finance roles reach it; finance input lists, adds and edits, and
only the finance head and superadmin delete or export it. An edit needs
`If-Match` with the entry's `rowVersion`. The page totals Masuk, Keluar and
their difference over the current filter. The entries do not feed the
financial dashboard or Laba Bersih, which stay paid DPP minus cost of
goods: a capital injection or a loan is not profit. The amount input reads
Indonesian (dots group thousands, a comma starts the sen).

## Frontend layout (`apps/web`)

Feature-based with file-based routing:

```
src/
  routes/            TanStack Router, auto-generated route tree
  features/          One folder per feature: api.ts, hooks.ts, components
  components/shared/ Sidebar, Modal, tables, pagination, states, links
  hooks/             Cross-feature hooks
  lib/               api-client, session (in-memory token), rbac, format,
                     status, entity-link, nav-trail, chart helpers, ui (tailwind class
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

Every detail and edit page knows the way it was reached. A link or
navigate into another page passes `state` from `useTrailState()`
(`hooks/useNavTrail`): the crumbs behind the current page plus the page
itself, each with its href, an Indonesian label (Quotation Q-00012/GNS/X/2026,
Produk Tali Tambat, Daftar Quotation) and the history index it was left at.
The trail lives in router history state, so a reload of the same entry keeps
it and a new tab, a bookmark or the menu starts without one. `lib/nav-trail`
reads it defensively (well formed crumbs on this origin only), cuts it where
the page already appears, so going back and forth adds nothing, and keeps
the newest five. `EntityLink`, the list Lihat actions, Ubah and the invoice
self links pass it. `NavTrail` (below) shows it, and `useNavTrail(fallback)`
gives each page `back` and `goTo`: a crumb left one history entry after
another is reached with a real history back, anything else is opened with
the crumbs before it. Without a trail a page shows and follows its fallback,
the list (and, on an edit page, the detail). The editors save with
`leaveTo(detail)`, so the save returns along the trail, and a PO status move
returns along it too. A list keeps its state in its URL (below), so a crumb
or a history back to a list opens it as it was left, scrolled where the
reader was.

Shared pieces in `components/shared`, reuse them instead of copying markup:

- `EntityLink` links a document number or name to its detail page through
  `lib/entity-link.ts`. It renders a real anchor, and falls back to plain text
  when the id is missing or the viewer's role cannot open the target. PO and
  invoice routes are keyed by the quotation id, so those kinds take
  `quotationId`. It carries the navigation trail.
- `NavTrail` is the breadcrumb on every detail and edit page: a
  `nav aria-label="Breadcrumb"` with an ordered list of real anchors, the
  current page marked `aria-current="page"`, long labels truncated and the
  list wrapping at 320px. It takes the page's own label (`current`), which
  also names the crumb a link from the page leaves behind, and the
  `fallback` crumbs, a module constant or memoised, for a page opened
  without a trail.
- `Modal` is the dialog shell: focus trap, Escape to close, scroll lock,
  focus returned to the opener, and a stack so only the top modal reacts.
- `FilterFooter` is the Hapus Filter, Batal, Terapkan footer of every filter
  modal.
- `PermanentDelete` is the Hapus Permanen button and its confirm dialog on
  the client and vendor pages. It names the record, says the delete cannot
  be undone, and shows any failure inline, so its mutation hooks only toast
  the success and mark the views stale without refetching the open detail.
- Page states: `LoadingState`, `NotFoundState`, `RouteErrorFallback` and
  `RouteNotFound`, all built on `StateMessage`; table rows use `TableStates`.
- `LoadError` is the inline failed-lookup row with Coba Lagi. A query a form
  or dialog reads while it holds unsaved input (the Tambah Produk dialog, the
  quotation wizard's client step, Ganti Narahubung) opts out of the route
  error boundary, through `throwOnError: false` or `INLINE_LOOKUP` from
  `lib/query-client`, and shows its failure with `LoadError` instead, since
  the boundary would discard the document being edited.
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
`blob:` and `data:` and frames only from `blob:` (`frame-src blob:`), so show
one through `hooks/useObjectUrl` (a blob URL it revokes; `useObjectUrlState`
also tells a failed download from one loading) and never point an `<img>` or
an `<iframe>` at an API URL. The PO detail's Lihat Berkas
(`PurchaseOrderDetail/FilePreviewModal`) shows the PO file that way: a photo
in an `<img>`, a PDF in an `<iframe>` with Buka di Tab Baru for a browser
that shows no PDF inline, and a spreadsheet only downloads
(`previewKind`, by the extensions `storage/policy.go` allows). Closing the
modal unmounts it, which revokes the URL. Product photos are shrunk
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
debounce, filters, sort, page, per-page, and the reset-to-page-1 invariant.
Note which mutator resets the page — `setSearch`, `applyFilters`,
`setItemsPerPage` and `setSort` do, `clearSearch` and `patchFilters` do not,
because removing a filter chip must keep the reader in place. The state
lives in the route's search params, not in component state: each list route
(and the vendor page, for its product table's page) sets `validateSearch`
from its feature's `list-search.ts` schema, built on `lib/list-search.ts`.
Reading is tolerant, so a missing, unknown or malformed value reads as its
default and never reaches the error boundary, and writing leaves defaults
out, so a list in its default state has a plain URL and the menu, which
links the bare path, opens it that way. Keys are short English names (`q`,
`page`, `per`, `sort`, `dir`, `status`, `preset`, `from`, `to`, `min`, …)
and statuses go by API key, never by label. Every change replaces the
history entry (`replace`, `state: true` to keep the trail, `resetScroll:
false`), so the back button leaves the list instead of stepping through
keys; a typed search shows at once in the box and reaches the URL once it
settles (250 ms). Each screen passes its own route path
(`useListScreen(schema, "/quotations")`), every write targets that route,
and a write made after the list closed, or once history has already moved
to another page, does nothing, so list params never land on a detail URL. A total filter or sort a role cannot see is left out of
the query and its chips, so a shared URL never draws a 403. Each screen
still owns its query call and passes the server total to `usePageWithin`,
which moves the reader to the new last page when a narrower result ends
before the current one.
The shell scrolls `<main>`, not the window, so the router restores it:
`scrollRestoration` with `<main>`'s `data-scroll-restoration-id` in
`scrollToTopSelectors` (`main.tsx`, `MAIN_SCROLL_SELECTOR`). The router keeps
the scroll per history entry, so a history back or a crumb that goes back
through history restores the list where the reader left it, and a new
navigation starts at the top. Client-side tables (the quotation product tables) clamp the same way
through `clampPage` in `lib/pagination.ts`, and every pager renders
`components/shared/PageButtons`.
`useListScreen` also reports `narrowed` (a search, or filters off their
defaults), and every list's empty row goes through `emptyListText`
(`lib/list-empty.ts`), so a search or filter with no match says
`Tidak ada hasil untuk …` instead of the list's own "Belum ada …".
The quotation, PO and invoice lists read a search of a month and year
(`10/2026`, `X/2026`, `x / 2026`) as that period: `listq.Period` turns it into
the slash-anchored pattern `%/X/2026%`, which each list's own generated
numbers match instead of the typed text (the quotation number on Quotation,
the invoice number on Invoice, the delivery-note number on PO), so `I/2026`
never lists `II/2026`. The client's own PO number matches both the typed text
and the period pattern; names always match the typed text, and the quotation
number on the invoice and PO lists matches it only when the query is not a
period.
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
  `gns_csp_test`; `e2e/csp.spec.ts` proves the header is live, and that a
  `blob:` frame loads while a frame from another origin is refused. A new
  dependency that injects an inline `<style>` or loads from another host
  fails there: fix the cause, never add `unsafe-inline` or `unsafe-eval`.
- Lighthouse CI (`bun run lighthouse`, the CI `lighthouse` job) audits 12
  pages three times each and fails any category below 0.95.
  `lighthouse/login-fixture.cjs` signs in inside Chrome, so every page
  restores its session from the refresh cookie and is scored as itself, not
  as `/login`. Fix a failing audit at its cause; never lower a threshold or
  drop a URL.
- `docs/example` holds one file of every export (the three PDFs, the
  Coretax XML and workbook, and the list, dashboard and Kas Lain
  workbooks). `make examples` makes them by walking one invented sale
  through the real API (`apps/web/e2e/examples.ts`) on the throwaway
  `gns_examples_test`, with its settings in the Makefile and never from
  `apps/api/.env`, so no real signer, bank or tax id is printed. Rerun it
  after a template or export change and commit the result.

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
2. Backend errors are RFC 7807. The web reports a failed save once: the
   form shows what it can render inline, and the mutation hook toasts only
   what no caller renders. The user forms show field and conflict errors
   inline, so their hooks toast the rest (`isInlineFormError`); the client,
   vendor and product forms show every failure in their banner, so those
   hooks never toast; a caller with no inline slot (Tambah Kontak on the
   client detail) toasts in its own `onError`. Every other failure is a
   toast.
3. TypeScript is strict, no `any`, prefer `type` over `interface`.
4. Go errors are wrapped with `fmt.Errorf("...: %w", err)`; tests are
   table-driven.
5. SQL is snake_case, parameterized, and hand-written in `db/queries`.
6. RBAC is enforced at the router mount (`requireRole` on every subtree,
   `readOnlyFor` for the roles that only read one), per route with
   `rolegate.Deny`, and in the handlers that hide figures (`redact`) or keep
   stored prices, and is mirrored in the frontend (`lib/rbac`). The dashboard
   gates its financial figures in the handlers: the overview is open with
   them zeroed, timeseries gates per metric, and the XLSX export is for
   superadmin and the finance head. Each rule has a negative test.
7. Dates resolve to WIB. The pool session timezone is pinned from `Config.TZ`
   (Asia/Jakarta) in `shared/db.NewPool`, so `CURRENT_DATE`/`NOW()`, invoice
   dates, and document-number periods are business-zone. Go-side date
   formatting goes through `shared/tz`, never `time.Local`. Do not remove the
   pin or the startup timezone assertion.
8. All three PDF templates print the same letterhead, running header and
   head: A4 portrait at every length, content from the top, the title with
   the document number centred and large under it (`\DocTitle`), then the
   party block and the table with no lead-in sentence. Each `.tex.tmpl`
   carries its own copy of the shared sizes (`\Doc*`, `_base/` is empty), so
   change all three together. The quotation addresses To, Attn, Email and
   Contact No.; the delivery note To and Address only (the Address is where
   the goods go, and its table ends in a Notes column, see the PO status
   model), with no vessel or attention; the invoice its Client, NPWP and
   Address, with no vessel.
   The terms and the signature sit clear of the table, and a long terms
   value wraps whole words inside its block (`tabularx`,
   `TestLatexExports_LongPaymentTermsWraps`). All three keep 0.9 cm
   side margins and every table spans exactly the text width (`\LTleft`,
   `\LTright` 0pt, the text columns sharing what the fixed ones leave), so
   the letterhead, party block, table rules and signature start and end on
   the same two lines; `TestLatexExports_TableMeetsTextEdges` renders the
   page and checks the outer rules against the text edges. Text cells do
   not hyphenate. Every item table cell is centred vertically in its row
   (`m` columns, while the party and terms blocks stay top-aligned), and
   `TestLatexExports_TableCellsCentred` holds it. The quotation prints
   `PDF_QUOTATION_SIGNER_NAME` under the scanned `Signature.jpg`; the
   invoice prints `PDF_SIGNER_NAME` over blank space, signed by hand.
   No printed text carries a dash, a minus or a semicolon (the font's
   contextual alternates are off, `RawFeature = -calt`, since they swap a
   hyphen between digits for a minus sign), and `TestLatexExports_
   DocumentHead` checks all of it with `pdfinfo` and `pdftotext`.
   Geometry uses `includehead` and `includefoot` so the running header and
   the page count print on the sheet: the header 0.4 cm from the top, the
   count 0.75 cm from the bottom (`footskip` 16pt above it). The logo is
   5.2 cm wide (`\DocLogoWidth`), the title `\Large` and the number under
   it 11pt; `TestLatexExports_Margins` pins the margins, the logo width and
   the number set smaller than the title. The party block is a top-aligned `tabularx`
   whose value column is plain `\raggedright` `X` with hyphenation off
   (English patterns would split Indonesian names), and the client name goes
   through `pdfgen.LatexBreakable`, so a long name wraps instead of printing
   over the right-hand block. Every printed address (the party Address, the
   quotation's Delivery Place, the note's Notes, the invoice's Description)
   goes through `pdfgen.LatexAddress`: `NormalizeAddress` folds typed line
   breaks, stray spaces and doubled commas into one ", " between parts and
   keeps a house-number list such as "2,6,8", and a part up to `PartyKeep`
   (or `CellKeep` in a cell) characters never splits, so lines break at the
   commas, and Jl., Lt., No., Kav. and the like stay with their word. An
   empty party or terms value prints "-". The layout fixtures carry
   a long name and a full office address, and
   `TestLatexExports_LongPartyWraps` checks with `pdftotext -bbox` that they
   stay left of that block. `TestLatexExports_Clean` and `_MultiPage`
   fail on any overfull or underfull box, which is what keeps text from being
   cut. A cancelled invoice still downloads, marked DIBATALKAN beside its
   title, in its running header and as a page watermark (a kernel
   `shipout/background` hook, no extra package); a Pengganti prints
   `Pengganti dari <no>` at the top of its right-hand block. The export reads
   the one detail row (`invoices.get_detail_by_id`), so a failed read is a
   5xx, never a PDF with a blank party; `TestLatexExports_InvoiceMarks` keeps
   both marks on one clean sheet with five products and shipping.
9. Invoice tax figures are rounded per line, then summed to the header (matching
   DJP e-faktur), and `ppn_amount` is computed from the already-rounded DPP
   base. The quotation (`fn_line_dpp`, `fn_line_ppn`, stored by the functions
   that write its totals) and the PO (`v_po_totals`) use the same rule, so all
   three agree, and the web previews mirror it (`computeTaxBreakdown`).
   PPN is 12% or nothing: `ppn_enabled` (00107, default on) is chosen on the
   quotation, by the roles that set prices (the wizard's PPN switch on the
   product step, saved with the header), copied to its revision, its PO and
   the invoice, and a document without it stores DPP Nilai Lain and PPN as
   0 with the grand total equal to the net. Its PDFs leave those two rows
   out, and the web breakdown shows Tanpa PPN in their place.
   The quotation and invoice PDFs close their table with the same rows in
   the same order (`TestLatexExports_SummaryRows`): Total (every line,
   shipping included, since shipping is a table line and has no row of its
   own), Diskon Produk N% (only when there is a discount, N by
   `pdfgen.FormatPct`: "5", "2,5"), Sub Total (Total minus the discount, the
   invoice DPP), DPP Nilai Lain and PPN 12% when taxed, then Grand Total in
   bold. The label says Produk because shipping is never discounted. Rincian
   Biaya on the quotation, PO and invoice pages shows the same rows
   (`CostBreakdown`, `discountLabel`), and so does the quotation wizard's
   summary (`wizardSummary`, whose Sub Total includes shipping). Invoices snapshot `gross_unit_price`
   and `total_discount`, so the PDF prints a gross line plus a real discount
   row (Total − Diskon Produk = Sub Total) without reading the quotation;
   the invoice stores no percent, so its detail read derives `discountPct`
   from that snapshot (`total_discount` over the product gross, NULL when a
   product line predates the gross snapshot). Every PDF prints rupiah as the web's
   `formatRupiah` does (`pdfgen.FormatIDRCents`): "Rp2.000.000", no space
   and no ",00", and a figure with real sen keeps both digits, and the Go line
   math (`pdfgen.BigMul`) rounds half away from zero like Postgres `ROUND`,
   so a fractional quantity still adds up. Do not restate already-filed
   invoices: their amounts are never recomputed, and a wrong invoice is
   cancelled and replaced by a Pengganti. Only the invoice and due dates stay
   editable, and only until the invoice is paid or cancelled; the due date
   the payment terms set is only where it starts.

## Tooling and style

- Python (only the `apps/api/db/import` tool) runs through `uv`; never call
  python, python3, pip, or pip3 directly.
- The repository is public, so business data never enters git: `Data/`, the
  import's `out/`, its hand-made decisions in `local/`, its real-file tests
  in `tests_local/` and `db/seeds/03_historical.sql` are gitignored and live
  only on the operator's machine. `make seed-dev`, `reimport-dev` and
  `seed-build` stop and list what is missing without them. Tracked tests use
  invented numbers, contacts and amounts, never values from `Data/`.
- The JavaScript toolchain uses `bun` and `bunx`, not npm or npx.
- Comments are in English. Section, function, and class header comments stay
  within five words. No emoji and no decorative separator lines.
- UI text is Indonesian, written inline; there is no i18n layer. Problem
  details a user can read (business rules, validation) are Indonesian too.
- Copy a user reads is short plain sentences with no semicolon and no dash
  (em or en), in the UI, problem details, raise messages and PDFs, and never
  shows a database id, a row version, a raw status key or a date format.
  Four tests hold it: `src/lib/copy-guard.test.ts` (web source),
  `httperr.TestCopy_NoSemicolonOrDash` (Go strings), `db/functions`
  `TestLiterals_NoSemicolonOrDash` (function literals) and
  `TestLatexExports_DocumentHead` (printed text). One word per thing: Ubah
  (not Edit), Unggah, berkas, narahubung for the person, Riwayat, Jumlah and
  Satuan, Email. Field messages join as sentences (`joinFieldMessages`, the
  same rule as `httperr.Unprocessable`).
- Use conventional commits (`feat:`, `fix:`, `test:`, `docs:`).
