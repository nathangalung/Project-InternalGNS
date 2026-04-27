# Backend API Spec — Quotation Creation Flow

This document spells out the Go API endpoints that back the quotation flow in `apps/web/src/components/quotation/`. For each endpoint it lists:

- HTTP method and path
- Handler and repo function names
- DB call (plain SQL through sqlc, or a callable function)
- Request/response shape for the non-trivial endpoints

---

## Contents

1. [Arsitektur & konvensi](#1-arsitektur--konvensi)
2. [Mapping flow FE → backend](#2-mapping-flow-fe--backend)
3. [Domain reference](#3-domain-reference)
   - [units](#units)
   - [countries](#countries)
   - [clients](#clients)
   - [items](#items)
   - [vendors](#vendors)
   - [quotations](#quotations)
4. [Reference: DB functions](#4-reference-db-functions)
5. [Walkthrough: alur "Buat Penawaran"](#5-walkthrough-alur-buat-penawaran)
6. [Migration index](#6-migration-index)

---

## 1. Arsitektur & konvensi

### Stack
- HTTP router: `chi`
- DB driver: `pgx/v5`
- Code generation: `sqlc` (`apps/api/sqlc.yaml`)
- Migrations: `goose`

### Layering

```
HTTP request
    ↓
Handler        — parse request, call repo, format response
    ↓
Repo           — orchestrate sqlc calls (mungkin multiple), transaction handling
    ↓
sqlc Queries   — type-safe wrapper di-generate dari .sql files
    ↓
DB             — plain SQL atau call function/view
```

### Rules
1. **No raw SQL in handlers or services** — every call goes through a sqlc-generated method.
2. **Plain CRUD** lives in a `.sql` query file.
3. **Complex logic** (search, atomic multi-step writes) calls a DB function, still wrapped by sqlc.
4. **DB-side triggers** (snapshot, cascade, validation) own the invariants. The backend trusts them.
5. **Response format** is JSON with camelCase keys. Errors look like `{"error":{"code","message"}}`.

### File structure per domain

```
internal/<domain>/
├── routes.go    # Routes(deps) chi.Router  — wire endpoints
├── handler.go   # Handler struct + HTTP method handlers
├── repo.go      # Repo struct + DB access methods (wrap sqlc)
└── dto.go       # Request/response DTO struct
```

### Sqlc query file mapping

```
apps/api/internal/<domain>/queries/<domain>.sql   # sqlc reads
apps/api/internal/<domain>/db/                    # generated Go code
```

---

## 2. Mapping flow FE → backend

| FE step | FE component | User action | HTTP call | DB call type |
|---|---|---|---|---|
| 1 | Step1Client | First render of the client list | `GET /clients` | sqlc plain SELECT |
| 1 | Step1Client | Typing in the search bar | `GET /clients/search?q=...` | **DB function `fn_search_clients`** |
| 1 | ClientAdd modal | Open the add-client modal | `GET /countries` (cache) | sqlc plain SELECT |
| 1 | ClientAdd modal | Pick country, prefill phone prefix | no API call, FE reads cached data | — |
| 1 | ClientAdd modal | Submit a new client | `POST /clients` | sqlc INSERT |
| 2 | ProductAdd modal | Search items by name or IMPA | `GET /items/search?q=...` | **DB function `fn_search_items`** |
| 2 | ProductAdd modal | Paste raw PDF text | `POST /items/match-request` | **DB function `fn_match_request`** |
| 2 | ProductAdd modal | List vendors for an item | `GET /items/{id}/vendors` | sqlc plain JOIN |
| 2 | ProductAdd modal | Search units | `GET /units` (cache) | sqlc plain SELECT |
| 2 | ProductAdd modal | Search vendors by name | `GET /vendors/search?q=...` | **DB function `fn_search_vendors`** |
| 2 | ProductAdd modal | Open the selling-price history | `GET /items/{id}/price-history` | **DB function `fn_suggest_selling_prices`** |
| 2 | ProductAdd modal | Edit cost and tick "Update vendor" | flag sent on submit, no extra call | trigger `trg_sync_vendor_cost` |
| 3 | Step3Shipping | Fill address, lead time, cost | no API call, FE state only | — |
| 4 | Step4Summary | Click **"Buat Penawaran"** | **`POST /quotations`** | **DB function `fn_create_quotation`** |

---

## 3. Domain reference

### units

Unit master (40 rows). FE fetches once and caches in memory for autocomplete.

| Method | Path | Handler | Repo | DB |
|---|---|---|---|---|
| GET | `/units` | `ListUnits` | `repo.ListAll(ctx)` | `SELECT * FROM units ORDER BY id` |

Response sample:
```json
[
  { "id": 1,  "code": "MT",  "name": "Metrik Ton", "coretax_code": "UM.0001" },
  { "id": 21, "code": "PCS", "name": "Piece",      "coretax_code": "UM.0021" },
  { "id": 34, "code": "TIN", "name": "Tin/Can",    "coretax_code": "UM.0033" }
]
```

---

### countries

Country master with ITU-T E.164 dial codes (251 rows). Used by the Step1 ClientAdd modal.

| Method | Path | Handler | Repo | DB |
|---|---|---|---|---|
| GET | `/countries` | `ListCountries` | `repo.ListAll(ctx)` | `SELECT code, name, dial_code FROM countries ORDER BY name` |

Response sample:
```json
[
  { "code": "IDN", "name": "Indonesia", "dialCode": "+62" },
  { "code": "SGP", "name": "Singapore", "dialCode": "+65" }
]
```

**FE pattern:** fetch once at app load and cache. When the user picks a country, take its `dialCode` and prefill the phone input.

---

### clients

Companies and their contacts (one company has many contacts). Used in Step1.

| Method | Path | Handler | Repo | DB |
|---|---|---|---|---|
| GET | `/clients/search?q=...&limit=10` | `SearchClients` | `repo.Search` | **`fn_search_clients`** |
| GET | `/clients?status=...&limit=&offset=` | `ListClients` | `repo.List` | sqlc SELECT + filter |
| GET | `/clients/{id}` | `GetClient` | `repo.GetByID` | sqlc |
| POST | `/clients` | `CreateClient` | `repo.Create` | sqlc INSERT |
| PATCH | `/clients/{id}` | `UpdateClient` | `repo.Update` | sqlc UPDATE |
| GET | `/clients/{id}/contacts` | `ListContacts` | `repo.ListContacts` | sqlc SELECT WHERE company_id |
| POST | `/clients/{id}/contacts` | `CreateContact` | `repo.CreateContact` | sqlc INSERT |

#### `GET /clients/search` — search company + contact

Wraps `fn_search_clients(q, min_score, limit)`. Return flat 1 row per (company × contact).

Query: `?q=imc&limit=10`

Response:
```json
[
  {
    "companyId": 1,
    "companyName": "PT. IMC Ship Management",
    "companyNumber": "2641",
    "companyNpwp": "0612345678901000",
    "companyAddress": "Graha Irama Lt. 8 ...",
    "companyEmail": null,
    "companyCountry": "IDN",
    "companyTku": null,
    "contactId": 1,
    "contactName": "Bp. Restu Umar Singgih",
    "contactEmail": "restu.singgih@imc-shipmanagement.com",
    "contactPhone": null,
    "contactTitle": "Procurement",
    "score": 0.95,
    "matchTier": "AUTO_MATCH"
  }
]
```

`matchTier`: `"AUTO_MATCH"` (≥0.9) | `"SUGGESTED"` (≥0.6) | `"FUZZY"` (≥0.3).

#### `POST /clients` — create new

Request:
```json
{
  "name": "PT. New Client",
  "npwp": "0612345678901000",
  "address": "Jakarta",
  "email": "info@newclient.com",
  "countryCode": "IDN",
  "tkuId": null
}
```

Response: `{ "id": 4 }` + 201 Created

---

### items

Master item catalog. Untuk Step2 ProductAdd modal.

| Method | Path | Handler | Repo | DB |
|---|---|---|---|---|
| GET | `/items/search?q=...` | `SearchItems` | `repo.Search` | **`fn_search_items`** |
| POST | `/items/match-request` | `MatchRequest` | `repo.MatchRequest` | **`fn_match_request`** |
| GET | `/items/{id}/vendors` | `ListVendorsForItem` | `repo.ListVendors` | sqlc JOIN vendor_products |
| GET | `/items/{id}/price-history` | `SuggestSellingPrices` | `repo.SuggestPrices` | **`fn_suggest_selling_prices`** |
| GET | `/items` | `ListItems` | `repo.List` | sqlc |
| GET | `/items/{id}` | `GetItem` | `repo.GetByID` | sqlc |
| POST | `/items` | `CreateItem` | `repo.Create` | sqlc INSERT |
| PATCH | `/items/{id}` | `UpdateItem` | `repo.Update` | sqlc UPDATE |
| GET | `/items/cheapest-vendor` | `ListWithCheapestVendor` | `repo.ListWithCheapestVendor` | `SELECT * FROM v_items_with_cheapest_vendor` |

#### `GET /items/search` — fuzzy search

Query: `?q=lamp%20led&limit=10`

Response:
```json
[
  {
    "id": 11,
    "name": "LAMP LED 12W (100W) 220V E-27, COOL WHITE",
    "impaCode": "790268",
    "defaultUnitId": 21,
    "score": 1.00,
    "matchTier": "AUTO_MATCH"
  }
]
```

#### `POST /items/match-request` — smart match with learning cache

Request:
```json
{ "requestText": "LAMP LED 12W (100W) 220V E-27", "limit": 5 }
```

Response:
```json
[
  {
    "itemId": 11,
    "itemName": "LAMP LED 12W (100W) 220V E-27, COOL WHITE",
    "impaCode": "790268",
    "confidence": 1.00,
    "source": "LEARNED_EXACT"
  }
]
```

`source`: `"LEARNED_EXACT"` | `"LEARNED_FUZZY"` | `"CATALOG_MATCH"`.

#### `GET /items/{id}/vendors` — vendors that supply this item

Plain JOIN, not function:
```sql
SELECT vp.id AS vendor_product_id, v.id AS vendor_id, v.name AS vendor_name,
       vp.cost_price, vp.last_quoted_at
FROM vendor_products vp
JOIN vendors v ON v.id = vp.vendor_id
WHERE vp.item_id = $1 AND vp.is_active AND v.is_active
ORDER BY vp.cost_price ASC;
```

Response:
```json
[
  { "vendorProductId": 11, "vendorId": 2, "vendorName": "CV Marine Supply",   "costPrice": 28000.00 },
  { "vendorProductId": 13, "vendorId": 2, "vendorName": "CV Marine Supply",   "costPrice": 30000.00 }
]
```

#### `GET /items/{id}/price-history`

Response sample:
```json
[
  {
    "quotationNo": "Q-264128/GNS/IV/2026",
    "quotationDate": "2026-04-01T09:00:00+07:00",
    "clientName": "PT. IMC Ship Management",
    "qty": 50,
    "costPrice": 28000.00,
    "sellingPrice": 48000.00,
    "profitPct": 0.7143
  }
]
```

---

### vendors

Vendor master. Used by the Step2 product modal.

| Method | Path | Handler | Repo | DB |
|---|---|---|---|---|
| GET | `/vendors/search?q=...` | `SearchVendors` | `repo.Search` | **`fn_search_vendors`** |
| GET | `/vendors` | `ListVendors` | `repo.List` | sqlc |
| GET | `/vendors/{id}` | `GetVendor` | `repo.GetByID` | sqlc |
| GET | `/vendors/{id}/items` | `ListItemsByVendor` | `repo.ListItems` | **`fn_search_items_by_vendor`** |
| POST | `/vendors` | `CreateVendor` | `repo.Create` | sqlc |
| PATCH | `/vendors/{id}` | `UpdateVendor` | `repo.Update` | sqlc |

---

### quotations

Quotation header + items. Step4 submit + list/detail/edit pages.

| Method | Path | Handler | Repo | DB |
|---|---|---|---|---|
| **POST** | **`/quotations`** | **`CreateQuotation`** | **`repo.Create`** | **`fn_create_quotation`** ⭐ |
| GET | `/quotations?status=...&limit=&offset=` | `ListQuotations` | `repo.List` | sqlc SELECT + filter |
| GET | `/quotations/{id}` | `GetQuotation` | `repo.GetByID` | sqlc + JOIN items |
| PATCH | `/quotations/{id}` | `UpdateQuotation` | `repo.Update` | sqlc UPDATE (only draft) |
| POST | `/quotations/{id}/send` | `SendQuotation` | `repo.UpdateStatus` | sqlc UPDATE status='sent' |
| POST | `/quotations/{id}/clone` (future) | `CloneToRevision` | `repo.CloneToRevision` | future: `fn_clone_quotation_to_revision` |

#### `POST /quotations` — create quotation atomic

Wraps `fn_create_quotation(...)`. Single round-trip — DB function:
1. Generate `quotation_no` via `fn_next_doc_no` (race-safe)
2. Snapshot company/contact name
3. Calculate totals from the items
4. INSERT header, items, and an optional shipping line
5. Triggers run: discount inherit, vendor cost sync (when flagged), learning cache populate

Request:
```json
{
  "companyClientId": 1,
  "contactId": 1,
  "clientRefNo": "8404/V-0006/REQ26",
  "vesselName": "MV YUXIN SATU",
  "paymentTerms": "30 days",
  "validityDays": 7,
  "discountPct": 0.07,
  "shippingAddress": "Pelabuhan Tanjung Priok, Jakarta",
  "shippingDays": 5,
  "shippingCost": 500000,
  "items": [
    {
      "requestedItemId": 11,
      "requestedImpa": "790268",
      "requestedName": "LAMP LED 12W (100W) 220V E-27",
      "offeredItemId": 11,
      "vendorProductId": 11,
      "qty": 50,
      "unitId": 21,
      "sellingPrice": 48000,
      "costPrice": 28000,
      "updateVendorPrice": false
    },
    {
      "requestedItemId": 13,
      "requestedName": "FLOODLIGHT FIXTURE LED SLD-150",
      "offeredItemId": 13,
      "vendorProductId": 13,
      "qty": 10,
      "unitId": 19,
      "sellingPrice": 450000,
      "costPrice": 270000,
      "updateVendorPrice": true
    }
  ]
}
```

Response: `201 Created`
```json
{ "id": 5, "quotationNo": "Q-2626413/GNS/IV/2026" }
```

#### `GET /quotations/{id}` — detail

Response:
```json
{
  "id": 5,
  "quotationNo": "Q-2626413/GNS/IV/2026",
  "status": "draft",
  "companyClientName": "PT. IMC Ship Management",
  "contactName": "Bp. Restu Umar Singgih",
  "discountPct": 0.07,
  "totalProduk": 6900000,
  "total": 7400000,
  "totalDiscount": 483000,
  "subtotal": 6917000,
  "dppNilaiLain": 6340583.33,
  "ppnAmount": 760870.00,
  "grandTotal": 7101453.33,
  "items": [
    {
      "lineNumber": 1,
      "itemType": "product",
      "requestedName": "LAMP LED 12W (100W) 220V E-27",
      "qty": 50,
      "sellingPrice": 48000,
      "costPrice": 28000,
      "discountPct": 0.07,
      "discountAmount": 168000,
      "subtotal": 2232000,
      "totalCost": 1400000,
      "profitAmount": 1000000,
      "profitPct": 0.7143
    }
  ]
}
```

---

## 4. Reference: DB functions

All eight callable DB functions already exist. The backend wraps each one through a sqlc query.

| Function | Signature | Used by |
|---|---|---|
| `fn_search_items(q, min_score, limit)` | `→ TABLE(id, name, impa_code, default_unit_id, score, match_tier)` | `GET /items/search` |
| `fn_search_items_by_vendor(vendor_id, limit)` | `→ TABLE(item_id, item_name, impa_code, vendor_sku, cost_price, last_quoted_at)` | `GET /vendors/{id}/items` |
| `fn_match_request(req_text, limit)` | `→ TABLE(item_id, item_name, impa_code, confidence, source)` | `POST /items/match-request` |
| `fn_search_clients(q, min_score, limit)` | `→ TABLE(company_*, contact_*, score, match_tier)` | `GET /clients/search` |
| `fn_search_vendors(q, min_score, limit)` | `→ TABLE(vendor_id, vendor_name, location, contact_info, score, match_tier)` | `GET /vendors/search` |
| `fn_suggest_selling_prices(item_id, limit)` | `→ TABLE(quotation_no, quotation_date, client_name, qty, cost_price, selling_price, profit_pct)` | `GET /items/{id}/price-history` |
| `fn_next_doc_no(doc_type, company_id)` | `→ TEXT` | Called internally by `fn_create_quotation` |
| `fn_create_quotation(...)` | `→ BIGINT (quotation_id)` | `POST /quotations` |

### Trigger functions (9 total, auto-fire so the backend never calls them directly)

| Function | Trigger | Behavior |
|---|---|---|
| `set_updated_at` / `set_updated_at_no_version` | BEFORE UPDATE on many tables | Auto-sets `updated_at = NOW()` and bumps `row_version` on transactional tables |
| `trg_fn_sync_vendor_cost` | AFTER INSERT on quotation_items | Syncs `vendor_products.cost_price` when `update_vendor_price = TRUE` |
| `trg_fn_learn_match` | AFTER INSERT on quotation_items | Upserts into `item_request_matches` |
| `trg_fn_inherit_quotation_discount` | BEFORE INSERT on quotation_items | Inherits `discount_pct` from the quotation header |
| `trg_fn_inherit_po_discount` | BEFORE INSERT on purchase_order_items | Inherits from the PO header |
| `trg_fn_po_inherit_quotation_discount` | BEFORE INSERT on purchase_orders | PO inherits from the source quotation |
| `trg_fn_protect_quotation_discount` | BEFORE UPDATE OF discount_pct | Blocks edits unless status is draft |
| `trg_fn_cascade_quotation_discount` | AFTER UPDATE OF discount_pct | Cascades the new discount to all items |

---

## 5. Walkthrough: the "Buat Penawaran" flow

Tracing the call from the Step4 button click until the data lands in the DB:

```
[FE: Step4Summary.tsx]
    User clicks "Buat Penawaran"
    │
    ▼
[FE: collect state from Step1-3, items array, and the per-item update_vendor_price flag]
    │
    ▼
POST /api/v1/quotations
Body: { companyClientId, contactId, ..., items: [...] }
    │
    ▼
[Go handler] quotations.CreateQuotation
    Validate body, parse items
    Marshal items into JSONB
    Call repo.Create(ctx, dto, itemsJSON, userID)
    │
    ▼
[Go repo] sqlc-generated CreateQuotation
    Executes: SELECT fn_create_quotation($1, $2, ..., $11::jsonb, $12)
    │
    ▼
[DB function] fn_create_quotation (single transaction)
    1. Validate items are non-empty and discount_pct is between 0 and 1
    2. Snapshot company.name and contact.name
    3. Pre-calc totals (total_produk, total, total_discount)
    4. fn_next_doc_no('Q', company_id)
       Atomic UPSERT into doc_sequences
       Returns something like "Q-2626413/GNS/IV/2026"
    5. INSERT into quotations (header) RETURNING id
    6. For each item in the JSONB array:
         INSERT into quotation_items (...)
         - trg_inherit_quotation_discount sets discount_pct from the header
         - GENERATED columns compute discount_amount, subtotal, profit_*
         - trg_sync_vendor_cost updates vendor_products.cost_price when update_vendor_price=TRUE
         - trg_learn_match upserts into item_request_matches
    7. If shipping_cost > 0, INSERT a quotation_items row with item_type='shipping'
    8. RETURN quotation_id
    │
    ▼
[Go handler] return { id, quotationNo } as 201 Created
    │
    ▼
[FE] redirect to /quotations/{id} or back to the list
```

Total: **1 HTTP call, 1 DB transaction, multiple side-effects via triggers**.

---

## 6. Migration index

Migration order (all live in `apps/api/db/migrations/`):

| # | File | Contents |
|---|---|---|
| 00001 | `00001_baseline_schema.sql` | 14 tabel + GENERATED + 11 updated_at triggers + view |
| 00002 | `00002_pricing_support.sql` | `update_vendor_price` flag + `trg_sync_vendor_cost` + `fn_suggest_selling_prices` |
| 00003 | `00003_search_and_match.sql` | `fn_search_items`, `fn_search_items_by_vendor`, `fn_match_request`, `trg_learn_match`, `v_items_with_cheapest_vendor` |
| 00004 | `00004_variable_discount.sql` | `discount_pct` per quotation + 4 inherit/cascade/protect triggers |
| 00005 | `00005_search_clients.sql` | `fn_search_clients` |
| 00006 | `00006_country_master.sql` | `countries` table + 251 ISO countries |
| 00007 | `00007_doc_sequences.sql` | `doc_sequences` + `fn_next_doc_no` (race-safe number gen) |
| 00008 | `00008_search_vendors.sql` | `fn_search_vendors` |
| 00009 | `00009_create_quotation.sql` | `fn_create_quotation` (atomic create — Step4 submit) |

Apply with `make -C apps/api migrate-up`, or call `goose` directly.

---

## 7. Backend TODO

- [ ] Build out the six domain folders: `units`, `countries`, `clients`, `items`, `vendors`, `quotations`
- [ ] Write sqlc query files (`db/queries/*.sql`) per domain
- [ ] Generate sqlc code with `make -C apps/api sqlc`
- [ ] Wire routes in `internal/app/router.go`
- [ ] Apply the JWT middleware to domain handlers, leaving public endpoints exposed
- [ ] Map PostgreSQL error codes to HTTP statuses in `internal/shared/db/pg_errors.go`
- [ ] Audit logging: pull `created_by` and `updated_by` from the JWT context
- [ ] Total: roughly 30 endpoints, 6 sqlc query files, 6 domain packages

---

**Last updated:** 2026-04-27, in sync with migration 00013
