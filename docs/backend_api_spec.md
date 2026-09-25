# Backend API spec: quotation creation flow

The Go endpoints behind the quotation wizard in
`apps/web/src/features/quotations/` (`QuotationAdd.tsx` and `Step1Client` to
`Step4Summary`). For each call it lists the method and path, the handler, and
the database call: a named query from `apps/api/db/queries`, or a database
function reached through one.

Request and response shapes are not repeated here. The Go DTOs
(`internal/<feature>/dto.go`) and `apps/web/src/types/api.ts` are the
contract.

## 1. Conventions

- Router: chi, mounted under `/api/v1`, bearer JWT on every route.
- SQL: hand-written named queries in `apps/api/db/queries/<feature>.sql`
  (`-- name: <feature>.<key>`), embedded and loaded at startup. There is no
  code generator.
- Layering: handler (decode, validate, respond) → repo (`store.Get(key)`
  through pgx) → PostgreSQL (plain SQL, views, functions, triggers).
- Atomic multi-step writes and searches run as database functions; triggers
  own snapshots, discount inheritance and learning.
- Responses are camelCase JSON. Errors are RFC 7807 `application/problem+json`
  (`shared/httperr`); list endpoints set `X-Total-Count`.
- Updates use `PUT` for the full resource and `PATCH` for one field or
  sub-resource (`/status`, `/contact`, `/logo`).

## 2. Wizard steps to endpoints

| Step | Component | User action | HTTP call | DB call |
|---|---|---|---|---|
| 1 | Step1Client | Search clients | `GET /clients/search?q=` | `fn_search_clients` |
| 1 | Client form | Load countries | `GET /countries` | `countries.list_all` |
| 1 | Client form | Save a new client | `POST /clients` | `clients.create` (number from `fn_next_client_number` when blank) |
| 2 | Step2Product | Search the catalog | `GET /items/search-advanced?q=` | `fn_search_items` + vendor offers + request history, merged in Go |
| 2 | Step2Product | Import an RFQ spreadsheet | `POST /items/match-rows` | `fn_match_request` per row, in one statement |
| 2 | Step2Product | Vendors for an item | `GET /items/{id}/vendors` | `items.list_vendors_for_item` |
| 2 | Step2Product | Selling-price history | `GET /items/{id}/price-history` | `fn_suggest_selling_prices` |
| 2 | Step2Product | Units | `GET /units` | `units.list_all` |
| 2 | Step2Product | Edit cost with "update vendor" ticked | flag on submit | trigger `trg_fn_sync_vendor_cost` |
| 3 | Step3Shipping | Address, lead time, cost | none, wizard state | — |
| 4 | Step4Summary | Buat Penawaran | `POST /quotations` | `fn_create_quotation` |

## 3. Endpoints by feature

Only the routes the flow touches. `routes.go` in each package is the full
list.

### clients

| Method | Path | Handler | DB |
|---|---|---|---|
| GET | `/clients/search` | `Search` | `fn_search_clients` |
| GET | `/clients` | `List` | `clients.list_base` + `list_count_base` |
| GET | `/clients/{id}` | `Get` | `clients.get_by_id` |
| POST | `/clients` | `Create` | `clients.create` |
| PUT | `/clients/{id}` | `Update` | `clients.update` |
| GET | `/clients/{id}/contacts` | `ListContacts` | `clients.list_contacts` |
| POST | `/clients/{id}/contacts` | `CreateContact` | `clients.create_contact` |

### items

| Method | Path | Handler | DB |
|---|---|---|---|
| GET | `/items/search-advanced` | `SearchAdvanced` | `items.search_catalog`, `search_vendor_offers`, `search_request_history` |
| POST | `/items/match-rows` | `MatchRows` | `items.match_request_batch` |
| GET | `/items/{id}/vendors` | `ListVendorsForItem` | `items.list_vendors_for_item` |
| GET | `/items/{id}/price-history` | `PriceHistory` | `items.suggest_selling_prices` |
| GET | `/items` | `List` | `items.list_base` + `list_count_base` |
| GET | `/items/{id}` | `Get` | `items.get_by_id` |
| POST | `/items` | `Create` | `items.create` |
| PUT | `/items/{id}` | `Update` | `items.update` |

`/items/search` and `/items/match-request` are older single-tier endpoints
with no caller in the web app.

### vendors

| Method | Path | Handler | DB |
|---|---|---|---|
| GET | `/vendors` | `List` | `vendors.list_base` + `list_count_base` |
| GET | `/vendors/{id}` | `Get` | `vendors.get_by_id` |
| GET | `/vendors/{id}/items` | `ListItems` | `vendors.list_items` + `list_items_count` |
| POST | `/vendors` | `Create` | `vendors.create` |
| PUT | `/vendors/{id}` | `Update` | `vendors.update` |

### quotations

| Method | Path | Handler | DB |
|---|---|---|---|
| POST | `/quotations` | `Create` | `fn_create_quotation` |
| GET | `/quotations` | `List` | `quotations.list_base` + `list_count_base` |
| GET | `/quotations/stats` | `Stats` | `quotations.stats` |
| GET | `/quotations/{id}` | `Get` | header, items and history queries |
| PUT | `/quotations/{id}` | `Update` | `fn_update_quotation_versioned` with `If-Match`, else `fn_update_quotation` (draft only) |
| PATCH | `/quotations/{id}/status` | `ChangeStatus` | `fn_change_quotation_status` |
| POST | `/quotations/{id}/send` | `Send` | `fn_change_quotation_status` to sent |
| POST | `/quotations/{id}/revise` | `Revise` | `fn_revise_quotation` |
| GET | `/quotations/{id}/revisions` | `Revisions` | `quotations.list_revisions` |
| GET | `/quotations/{id}/pdf` | `ExportPDF` | header and items, rendered by xelatex |

`POST /quotations` answers `201` with `{"id": <quotation id>}`. The allowed
status moves are in the detail response (`allowedTransitions`, `canRevise`);
see the Status model section of `CLAUDE.md`.

## 4. Database functions in the flow

| Function | Called by |
|---|---|
| `fn_search_clients(q, min_score, limit)` | `GET /clients/search` |
| `fn_next_client_number()` | `clients.create` when the number is blank |
| `fn_search_items(q, min_score, limit, is_active)` | `GET /items/search-advanced` |
| `fn_match_request(req_text, limit)` | `POST /items/match-rows` |
| `fn_suggest_selling_prices(item_id, limit)` | `GET /items/{id}/price-history` |
| `fn_next_doc_no(doc_type, company_id)` | inside `fn_create_quotation` |
| `fn_create_quotation(...)` | `POST /quotations` |
| `fn_update_quotation_versioned(...)`, `fn_update_quotation(...)` | `PUT /quotations/{id}` |
| `fn_change_quotation_status(id, status, user, note)` | `PATCH /quotations/{id}/status`, `POST /quotations/{id}/send` |
| `fn_revise_quotation(id, user, note)` | `POST /quotations/{id}/revise` |

Triggers fire on their own; the backend never calls them:

| Function | Effect |
|---|---|
| `set_updated_at`, `set_updated_at_no_version` | Keep `updated_at` current and bump `row_version` |
| `trg_fn_log_quotation_creation` | First `quotation_status_history` row on insert |
| `trg_fn_inherit_quotation_discount` | Line inherits the header `discount_pct` on insert |
| `trg_fn_protect_quotation_discount` | Refuses a discount change outside draft |
| `trg_fn_cascade_quotation_discount` | Pushes a header discount change to the lines |
| `trg_fn_sync_vendor_cost` | Writes the line cost back to `vendor_products` when `update_vendor_price` is set |
| `trg_fn_learn_match` | Records request text to item matches in `item_request_matches` |
| `trg_fn_qir_lock_parent` | Refuses item-request edits on a locked quotation |

`db/functions/` holds the current body of each one.

## 5. Walkthrough: Buat Penawaran

```
[Step4Summary.tsx] user clicks "Buat Penawaran"
    │  wizard state from steps 1 to 3, lines, per-line update_vendor_price
    ▼
POST /api/v1/quotations
    ▼
[quotations.Handler.Create]
    decode, validate lines, quantities and discount (0 to 100)
    ▼
[quotations.Repo.Create]  store.Get("quotations.fn_create")
    SELECT fn_create_quotation($1, ..., $n::jsonb, ...)
    ▼
[fn_create_quotation], one transaction
    1. check the lines and the discount
    2. snapshot the client and contact names
    3. fn_next_doc_no('Q', company_id): atomic upsert on doc_sequences,
       number built from the four-digit client number and the WIB period
    4. insert the header, the lines and an optional shipping line;
       triggers inherit the discount, sync vendor cost, learn matches, and
       log the draft in quotation_status_history
    5. return the quotation id
    ▼
201 {"id": ...}, and the wizard returns to /quotations
```

One HTTP call, one transaction.

## 6. Migrations

The schema history is `apps/api/db/migrations/`; see its README for the
numbering and ordering rules.
