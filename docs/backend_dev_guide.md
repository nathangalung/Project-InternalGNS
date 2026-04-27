# Backend Dev Guide — Quotation System

For the backend engineer who owns implementation, bug fixes, and deployment. This document covers the **architecture, patterns, and design decisions** baked into the skeleton.

---

## 1. Architecture in one diagram

```
HTTP request
    ↓
chi router (internal/app/router.go) mounts /api/v1/{domain}
    ↓
Handler (internal/<domain>/handler.go) parses, validates, calls the repo, renders JSON
    ↓
Repo (internal/<domain>/repo.go) wraps SQL, returns Go structs
    ↓
pgx/v5 (pgxpool.Pool) executes SQL and scans rows
    ↓
PostgreSQL — tables, DB functions, triggers
```

**Layering rules:**
1. **No SQL in handlers or services.** All SQL lives in the repo.
2. **No DB types in handler signatures.** Use DTO structs instead.
3. **Repo signatures stay stable.** The body can swap to sqlc-generated code without touching the signature.
4. **DB-side triggers own the invariants.** The backend never replicates that logic (snapshot, cascade, validation).

---

## 2. Stack and dependencies

| Component | Choice | Reason |
|---|---|---|
| HTTP router | `go-chi/chi/v5` | Idiomatic Go, clean middleware story |
| DB driver | `jackc/pgx/v5` (pgxpool) | Native Postgres features (JSONB, arrays, COPY) |
| Migrations | `pressly/goose` | Embedded FS, plain SQL files |
| Decimal | `shopspring/decimal` (already in go.mod) | For monetary math when we move past strings |
| Config | `caarlos0/env/v11` | Env-based, type-safe |

Not yet wired (TODO):
- **JWT auth middleware** — `internal/shared/deps.CurrentUserID()` still returns 0 in some paths.
- **Logger** — minimal; we can add zap or slog when noise becomes a problem.
- **sqlc** — `sqlc.yaml` is in place; opt in by writing query files.
- **MinIO** — for file uploads (PDF documents).

---

## 3. Directory layout

```
internal/
├── app/                       # bootstrap (main wiring)
│   ├── config.go
│   ├── router.go              # mount domain routes
│   └── server.go
├── shared/
│   ├── deps/deps.go           # Deps struct + ctx user helpers
│   ├── db/                    # pool, migrate, tx, pg_errors
│   ├── httperr/               # RFC 7807-ish error rendering
│   └── ...
├── units/                     # GET /units
├── countries/                 # GET /countries
├── clients/                   # CRUD, search, contacts (7 endpoints)
├── items/                     # CRUD, search, match, price-history (7 endpoints)
├── vendors/                   # CRUD, search, items-by-vendor (5 endpoints)
└── quotations/                # list, stats, detail, create, update, status (8 endpoints)
```

Each domain has four files: `routes.go`, `handler.go`, `repo.go`, `dto.go`.

---

## 4. Per-domain pattern

### 4.1 routes.go

```go
func Routes(d deps.Deps) chi.Router {
    r := chi.NewRouter()
    h := NewHandler(NewRepo(d.Pool))
    r.Get("/", h.List)
    r.Post("/", h.Create)
    r.Get("/{id}", h.Get)
    return r
}
```

### 4.2 handler.go

```go
func (h *Handler) Create(w http.ResponseWriter, r *http.Request) {
    var req CreateRequest
    if err := json.NewDecoder(r.Body).Decode(&req); err != nil {
        httperr.Render(w, httperr.BadRequest("invalid json"))
        return
    }
    if req.Name == "" {
        httperr.Render(w, httperr.Unprocessable(map[string]string{"name": "required"}))
        return
    }
    userID := deps.CurrentUserID(r.Context())
    result, err := h.repo.Create(r.Context(), req, userID)
    if err != nil {
        httperr.Render(w, httperr.Internal(err.Error()))
        return
    }
    writeJSON(w, http.StatusCreated, result)
}
```

### 4.3 repo.go

```go
func (r *Repo) Create(ctx context.Context, req CreateRequest, userID int64) (Client, error) {
    const q = `INSERT INTO company_client (...) VALUES (...) RETURNING ...`
    rows, err := r.pool.Query(ctx, q, req.Name, ..., userID)
    if err != nil {
        return Client{}, err
    }
    return pgx.CollectOneRow(rows, pgx.RowToStructByName[Client])
}
```

`pgx.RowToStructByName` reads the `db:"..."` tag to map columns onto struct fields.

### 4.4 dto.go

```go
type Client struct {
    ID    int64   `db:"id"   json:"id"`
    Name  string  `db:"name" json:"name"`
    Email *string `db:"email" json:"email,omitempty"`
}
```

- `db` tag drives pgx scanning.
- `json` tag drives the wire format (camelCase).
- Nullable columns become `*string`, `*int64`, etc.

---

## 5. Existing endpoints

| Method | Path | Handler | DB call |
|---|---|---|---|
| GET | `/api/v1/units` | `units.List` | sqlc plain SELECT |
| GET | `/api/v1/countries` | `countries.List` | sqlc plain SELECT |
| GET | `/api/v1/clients` | `clients.List` | sqlc plain |
| POST | `/api/v1/clients` | `clients.Create` | sqlc INSERT |
| GET | `/api/v1/clients/search?q=` | `clients.Search` | **`fn_search_clients`** |
| GET | `/api/v1/clients/{id}` | `clients.Get` | sqlc |
| GET | `/api/v1/clients/{id}/contacts` | `clients.ListContacts` | sqlc |
| POST | `/api/v1/clients/{id}/contacts` | `clients.CreateContact` | sqlc INSERT (CHECK on phone digits) |
| GET | `/api/v1/items` | `items.List` | sqlc |
| POST | `/api/v1/items` | `items.Create` | sqlc INSERT |
| GET | `/api/v1/items/search?q=` | `items.Search` | **`fn_search_items`** |
| POST | `/api/v1/items/match-request` | `items.MatchRequest` | **`fn_match_request`** |
| GET | `/api/v1/items/{id}` | `items.Get` | sqlc |
| GET | `/api/v1/items/{id}/vendors` | `items.ListVendorsForItem` | JOIN sqlc |
| GET | `/api/v1/items/{id}/price-history` | `items.PriceHistory` | **`fn_suggest_selling_prices`** |
| GET | `/api/v1/vendors` | `vendors.List` | sqlc |
| POST | `/api/v1/vendors` | `vendors.Create` | sqlc INSERT |
| GET | `/api/v1/vendors/search?q=` | `vendors.Search` | **`fn_search_vendors`** |
| GET | `/api/v1/vendors/{id}` | `vendors.Get` | sqlc |
| GET | `/api/v1/vendors/{id}/items` | `vendors.ListItems` | **`fn_search_items_by_vendor`** |
| GET | `/api/v1/quotations` | `quotations.List` | sqlc + dynamic filter |
| GET | `/api/v1/quotations/stats` | `quotations.Stats` | GROUP BY |
| POST | `/api/v1/quotations` | `quotations.Create` | **`fn_create_quotation`** (atomic) |
| GET | `/api/v1/quotations/{id}` | `quotations.Get` | header + items + history |
| PUT | `/api/v1/quotations/{id}` | `quotations.Update` | **`fn_update_quotation`** (draft only) |
| PATCH | `/api/v1/quotations/{id}/status` | `quotations.ChangeStatus` | **`fn_change_quotation_status`** |
| POST | `/api/v1/quotations/{id}/send` | `quotations.Send` | wraps `fn_change_status('sent', ...)` |

Total: **27 endpoints**.

---

## 6. SQL functions (callable)

Ten callable functions that Go invokes. Their order is reflected in the migration files.

| Function | File | Used by |
|---|---|---|
| `fn_search_items(q, min_score, limit)` | 00003 | `items.Search` |
| `fn_search_items_by_vendor(vendor_id, limit)` | 00003 | `vendors.ListItems` |
| `fn_match_request(req_text, limit)` | 00003 | `items.MatchRequest` |
| `fn_suggest_selling_prices(item_id, limit)` | 00002 | `items.PriceHistory` |
| `fn_search_clients(q, min_score, limit)` | 00005 | `clients.Search` |
| `fn_next_doc_no(doc_type, company_id)` | 00007 | called inside `fn_create_quotation` |
| `fn_search_vendors(q, min_score, limit)` | 00008 | `vendors.Search` |
| `fn_create_quotation(...)` | 00009 (recreated in 00010) | `quotations.Create` (atomic) |
| `fn_change_quotation_status(id, new, user, note)` | 00012 (validated in 00013) | `quotations.ChangeStatus` |
| `fn_update_quotation(...)` | 00012 | `quotations.Update` (draft only) |

**Trigger functions** (auto-fire, never called by hand):
- `set_updated_at` and `set_updated_at_no_version` keep `updated_at` current.
- `trg_fn_sync_vendor_cost` syncs cost back into `vendor_products`.
- `trg_fn_learn_match` populates the match cache.
- `trg_fn_inherit_quotation_discount` and `trg_fn_inherit_po_discount` propagate discount on insert.
- `trg_fn_po_inherit_quotation_discount` carries the discount from quotation to PO.
- `trg_fn_protect_quotation_discount` blocks discount updates when status is not draft.
- `trg_fn_cascade_quotation_discount` cascades discount changes to items.
- `trg_fn_log_quotation_creation` writes the initial `status_history` row on insert.

---

## 7. Conventions worth knowing

### 7.1 Phone format
- Stored **without** the dial code, e.g. `"812-3456-7890"`.
- The `country_code` column (FK to `countries.code`) holds the ISO alpha-3.
- The FE renders `+{countries.dial_code} {phone}`.
- CHECK constraint: digit count is between 9 and 12 after stripping non-digits via `REGEXP_REPLACE`.

### 7.2 Discount percentage
- Stored as `0..100` (so `5` means 5%, not `0.05`).
- The GENERATED `subtotal` column uses `(1 - discount_pct / 100)`.
- `fn_create_quotation` enforces `0 <= discount_pct <= 100`.

### 7.3 Status (canonical English)
- DB values: `draft | sent | accepted | rejected | revision | expired`.
- Indonesian FE labels: `Draf | Dikirim | Disetujui | Ditolak | Revisi | Kadaluwarsa`.
- The FE maps both directions through its translation layer.
- `fn_change_quotation_status` enforces the state machine:
  - draft → sent | expired
  - sent → accepted | rejected | revision | expired
  - revision → sent | rejected
  - **accepted, rejected, expired are terminal** (no exit).

### 7.4 Decimal and numeric handling
- Today the skeleton ships monetary values as **strings** (cast `::text` in SQL).
- The FE just parses the string into a number.
- For backend arithmetic (rare), use `decimal.Decimal` (already in go.mod).
- Switching to the pgx-shopspring-decimal codec is a small change when needed.

### 7.5 Quotation creation flow
1. The Step 4 FE submits `POST /quotations` with the full body (header plus items array).
2. The handler decodes and calls `repo.Create()`.
3. The repo marshals items into a JSONB array and calls `fn_create_quotation`.
4. The DB function:
   - Validates the input.
   - Snapshots `company_client_name` and `contact_name`.
   - Generates `quotation_no` with `fn_next_doc_no` (atomic UPSERT).
   - Inserts the header, items, and an optional shipping line.
   - Triggers fire: `trg_log_quotation_creation` writes the initial status_history row, `trg_inherit_quotation_discount` sets `discount_pct` per item, `trg_sync_vendor_cost` updates vendor cost when `update_vendor_price = true`.
5. Returns `quotation_id` to the FE.

The backend never replicates this logic. The DB function and triggers handle every side effect.

### 7.6 Quotation edit flow (draft only)
1. The FE QuotationEdit page submits `PUT /quotations/{id}` with the full body.
2. `fn_update_quotation`:
   - Locks the row and verifies `status = 'draft'` (raises otherwise).
   - Deletes existing items.
   - Updates the header.
   - Inserts the new items, refiring the inheritance triggers.
3. Returns `quotation_id`.

Anything other than draft is rejected. The FE must handle the 4xx and surface a message.

### 7.7 Status change flow
1. The FE submits `PATCH /quotations/{id}/status` with `{status, note}`.
2. `fn_change_quotation_status`:
   - Locks the row and reads the previous status.
   - Validates the transition against the state machine.
   - Is idempotent (no-op when the status is unchanged).
   - Updates the quotation and inserts a `status_history` entry.
3. The FE refetches the detail to refresh the timeline.

---

## 8. Open backlog

| Item | Severity | Note |
|---|---|---|
| JWT auth middleware | HIGH | Wire JWT verification and set `userIDKey` on the context. |
| Decimal codec registration | MED | Skeleton uses strings; register `pgx-shopspring-decimal` if we move to native arithmetic. |
| sqlc generation (optional) | MED | `sqlc.yaml` is ready. Add `.sql` queries and run `make sqlc` when convenient. |
| Logger (slog/zap) | MED | Currently minimal; errors go to stdlib. |
| Test coverage | MED | Per-domain unit tests plus integration tests. |
| Pagination metadata | LOW | List endpoints return arrays only; no `{data, totalCount, hasMore}`. |
| Rate limiting | LOW | For public endpoints. |
| OpenAPI / Swagger | LOW | Auto-generated from handlers, or hand-written. |
| Generic audit log | LOW | Header field changes are not logged outside `status_history`. |
| PDF export | MED | `GET /quotations/{id}/pdf` is missing; pick chromedp or wkhtmltopdf. |
| Excel export | LOW | `GET /quotations/export.xlsx`. |

---

## 9. Working with migrations

**Golden rule: forward only.** Once a file ships or is applied, do not edit it. Add a new migration instead.

```bash
# Create a new migration
make migrate-new NAME=add_payments
# generates: db/migrations/00014_add_payments.sql

# Apply (locally, in staging, or prod)
make migrate-up

# Show status
make migrate-status

# Roll back the last migration (DESTRUCTIVE; data may be lost)
make migrate-down
```

Migrations 00001-00013 are the baseline plus iterations. Each file has a header comment that explains what it does.

---

## 10. Run it locally

```bash
# Install deps
cd apps/api && go mod download

# One-time DB setup
psql -U postgres -c "CREATE ROLE gns_app WITH LOGIN PASSWORD 'gns_app';"
psql -U postgres -c "CREATE DATABASE gns_quotation OWNER gns_app;"
psql -U postgres -d gns_quotation -c "GRANT ALL ON SCHEMA public TO gns_app;"

# Migrate and seed
make migrate-up
psql -v ON_ERROR_STOP=1 -f db/seeds/01_master.sql "postgres://gns_app:gns_app@localhost:5432/gns_quotation?sslmode=disable"
psql -v ON_ERROR_STOP=1 -f db/seeds/02_dev_samples.sql "postgres://gns_app:gns_app@localhost:5432/gns_quotation?sslmode=disable"

# Run
DATABASE_URL='postgres://gns_app:gns_app@localhost:5432/gns_quotation?sslmode=disable' \
JWT_SECRET=devsecret \
make run

# Smoke test
curl http://localhost:8080/healthz
curl http://localhost:8080/api/v1/units
curl "http://localhost:8080/api/v1/clients/search?q=IMC"
curl http://localhost:8080/api/v1/quotations/stats
curl "http://localhost:8080/api/v1/quotations?status=sent&sortBy=created_at&sortDir=desc&limit=10"
```

---

## 11. FAQ

**Q: Why pgxpool directly instead of sqlc-generated code?**
A: Neither is strictly better. The skeleton uses pgxpool because (a) we skip a codegen step, (b) repo signatures stay stable, and (c) we can swap to sqlc later without touching handlers or DTOs.

**Q: Why is the SQL inline in repo.go instead of in `.sql` files?**
A: For the skeleton, inline SQL is faster to read and edit. When we adopt sqlc, the queries move into `.sql` files and the repo body shrinks to a single `q.MethodName(ctx, ...)` call.

**Q: Why use strings for monetary values?**
A: Trade-off. Strings sidestep decimal codec concerns and the FE just parses them. Anywhere we add arithmetic in the service layer, we use `decimal.Decimal`.

**Q: Why does so much logic live in DB functions and triggers instead of Go?**
A: Two reasons. The user explicitly wants no plain SQL in the app layer. And atomic operations plus invariant-binding triggers belong next to the data — single source of truth. Backend Go is a thin orchestration layer.

**Q: Why does the repo surface raw errors to the handler with no translation?**
A: For the skeleton, `httperr.Internal(err.Error())` is enough. The TODO is to map specific PG errors (unique violation, FK violation, RAISE EXCEPTION) onto proper HTTP statuses. Helpers live in `internal/shared/db/pg_errors.go` (`IsUniqueViolation`, etc.).

---

## 12. Pre-merge checklist

- [ ] `go build ./...` succeeds.
- [ ] `go vet ./...` is clean.
- [ ] New migrations include both Up and Down.
- [ ] Migration was sanity-tested against a local DB.
- [ ] Docs updated when endpoints or patterns change.
