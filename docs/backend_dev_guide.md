# Backend Dev Guide — Quotation System

Untuk teman backend yang akan handle implementasi, bug fix, dan deployment. Document ini menjelaskan **arsitektur, pattern, dan keputusan design** yang sudah ada di skeleton.

---

## 1. Arsitektur singkat

```
HTTP request
    ↓
chi router (internal/app/router.go) — mount /api/v1/{domain}
    ↓
Handler (internal/<domain>/handler.go) — parse, validate, call repo, render JSON
    ↓
Repo (internal/<domain>/repo.go) — encapsulate SQL, return Go structs
    ↓
pgx/v5 (pgxpool.Pool) — execute SQL, scan rows
    ↓
PostgreSQL — table + DB function + trigger
```

**Aturan layering:**
1. **Tidak ada SQL di handler atau service.** Semua SQL hidup di repo.
2. **Tidak ada DB types di handler signature.** Pakai DTO struct.
3. **Repo signature stabil** — body bisa di-swap ke sqlc-generated kalau butuh, signature tidak berubah.
4. **Triggers DB-side handle invariants** — backend tidak perlu replicate logic (snapshot, cascade, validation).

---

## 2. Stack & dependencies

| Komponen | Pilihan | Alasan |
|---|---|---|
| HTTP router | `go-chi/chi/v5` | Idiomatic Go, middleware pattern |
| DB driver | `jackc/pgx/v5` (pgxpool) | Native PG features (JSONB, arrays, COPY) |
| Migration | `pressly/goose` | Embedded FS, plain SQL files |
| Decimal | `shopspring/decimal` (di go.mod) | Untuk monetary di service layer (skeleton pakai string) |
| Config | `caarlos0/env/v11` | Env-based, type-safe |

Belum dipakai (TODO):
- **JWT auth middleware** — placeholder di `internal/shared/deps.CurrentUserID()` return 0
- **Logger** — minimal, bisa di-add (zap/slog)
- **sqlc** — config sudah ada di `sqlc.yaml`, generate kalau preferred
- **MinIO** — untuk file upload (PDF dokumen)

---

## 3. Layout direktori

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
├── clients/                   # CRUD + search + contacts (7 endpoints)
├── items/                     # CRUD + search + match + price-history (7 endpoints)
├── vendors/                   # CRUD + search + items-by-vendor (5 endpoints)
└── quotations/                # list + stats + detail + create + update + status (8 endpoints)
```

Setiap domain punya 4 file: `routes.go`, `handler.go`, `repo.go`, `dto.go`.

---

## 4. Pattern per domain

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

`pgx.RowToStructByName` reads `db:"..."` tag untuk map kolom ke field.

### 4.4 dto.go

```go
type Client struct {
    ID    int64  `db:"id"   json:"id"`
    Name  string `db:"name" json:"name"`
    Email *string `db:"email" json:"email,omitempty"`
}
```

- `db` tag → pgx scanning
- `json` tag → wire format (camelCase)
- Nullable: `*string`, `*int64`, etc

---

## 5. Endpoint lengkap (yang sudah ada)

| Method | Path | Handler | DB call |
|---|---|---|---|
| GET | `/api/v1/units` | `units.List` | sqlc plain SELECT |
| GET | `/api/v1/countries` | `countries.List` | sqlc plain SELECT |
| GET | `/api/v1/clients` | `clients.List` | sqlc plain |
| POST | `/api/v1/clients` | `clients.Create` | sqlc INSERT |
| GET | `/api/v1/clients/search?q=` | `clients.Search` | **`fn_search_clients`** |
| GET | `/api/v1/clients/{id}` | `clients.Get` | sqlc |
| GET | `/api/v1/clients/{id}/contacts` | `clients.ListContacts` | sqlc |
| POST | `/api/v1/clients/{id}/contacts` | `clients.CreateContact` | sqlc INSERT (CHECK phone 9-12 fire) |
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
| POST | `/api/v1/quotations` | `quotations.Create` | **`fn_create_quotation`** ⭐ atomic |
| GET | `/api/v1/quotations/{id}` | `quotations.Get` | header + items + history |
| PUT | `/api/v1/quotations/{id}` | `quotations.Update` | **`fn_update_quotation`** (DRAFT only) |
| PATCH | `/api/v1/quotations/{id}/status` | `quotations.ChangeStatus` | **`fn_change_quotation_status`** |
| POST | `/api/v1/quotations/{id}/send` | `quotations.Send` | wrapper → `fn_change_status('sent', ...)` |

Total: **27 endpoints**.

---

## 6. SQL functions (callable)

10 callable functions yang dipanggil dari Go, urutan bisa dilihat di migration files:

| Function | File | Untuk |
|---|---|---|
| `fn_search_items(q, min_score, limit)` | 00003 | `items.Search` |
| `fn_search_items_by_vendor(vendor_id, limit)` | 00003 | `vendors.ListItems` |
| `fn_match_request(req_text, limit)` | 00003 | `items.MatchRequest` |
| `fn_suggest_selling_prices(item_id, limit)` | 00002 | `items.PriceHistory` |
| `fn_search_clients(q, min_score, limit)` | 00005 | `clients.Search` |
| `fn_next_doc_no(doc_type, company_id)` | 00007 | dipanggil internal `fn_create_quotation` |
| `fn_search_vendors(q, min_score, limit)` | 00008 | `vendors.Search` |
| `fn_create_quotation(...)` | 00009 (re-created di 00010) | `quotations.Create` ⭐ atomic |
| `fn_change_quotation_status(id, new, user, note)` | 00012 (validated di 00013) | `quotations.ChangeStatus` |
| `fn_update_quotation(...)` | 00012 | `quotations.Update` (DRAFT only) |

**Trigger functions** (tidak dipanggil manual, fire otomatis):
- `set_updated_at` / `set_updated_at_no_version` — touch updated_at
- `trg_fn_sync_vendor_cost` — auto-sync cost ke vendor_products
- `trg_fn_learn_match` — auto-populate match cache
- `trg_fn_inherit_quotation_discount`, `trg_fn_inherit_po_discount` — discount inheritance
- `trg_fn_po_inherit_quotation_discount` — PO inherit dari quotation
- `trg_fn_protect_quotation_discount` — block UPDATE non-draft
- `trg_fn_cascade_quotation_discount` — cascade ke items
- `trg_fn_log_quotation_creation` — auto-log ke status_history saat INSERT

---

## 7. Konvensi penting

### 7.1 Phone format
- Disimpan **tanpa** dial code, e.g. `"812-3456-7890"` (11 digit)
- Field `country_code` (FK ke `countries.code`) menyimpan ISO alpha-3
- FE display logic combine `+{countries.dial_code} {phone}` saat render
- CHECK constraint: digit count BETWEEN 9 AND 12 (formatting diabaikan via REGEXP_REPLACE)

### 7.2 Discount percentage
- DB store **0-100** (e.g., `5` = 5%, bukan `0.05`)
- GENERATED column `subtotal` pakai `(1 - discount_pct / 100)`
- `fn_create_quotation` validate `0 ≤ discount_pct ≤ 100`

### 7.3 Status (canonical English)
- DB: `draft | sent | accepted | rejected | revision | expired`
- FE Bahasa labels: `Draf | Dikirim | Disetujui | Ditolak | Revisi | (Kadaluwarsa)`
- FE wajib map bolak-balik di translation layer
- State machine enforced di `fn_change_quotation_status`:
  - draft → sent | expired
  - sent → accepted | rejected | revision | expired
  - revision → sent | rejected
  - **accepted, rejected, expired = TERMINAL** (tidak bisa keluar)

### 7.4 Decimal/numeric handling
- Skeleton sekarang pakai **string** untuk monetary (cast `::text` di SQL)
- FE tinggal parse string → number
- Untuk arithmetic di backend (rare), gunakan `decimal.Decimal` (sudah di go.mod)
- Bisa upgrade ke pgx-shopspring-decimal codec kalau butuh native scan

### 7.5 Quotation creation flow
1. FE Step 4 submit `POST /quotations` dengan body lengkap (header + items array)
2. Handler decode → repo `Create()`
3. Repo build JSONB array dari items, call `fn_create_quotation`
4. DB function:
   - Validate
   - Snapshot `company_client_name` + `contact_name`
   - Generate `quotation_no` via `fn_next_doc_no` (atomic UPSERT)
   - INSERT header + items + optional shipping line
   - Trigger `trg_log_quotation_creation` fire → INSERT initial status_history entry
   - Trigger `trg_inherit_quotation_discount` fire per item → set discount_pct
   - Trigger `trg_sync_vendor_cost` fire untuk items dengan `update_vendor_price=true`
5. Return `quotation_id` ke FE

Backend layer tidak perlu replicate logic — DB fn + triggers handle semua.

### 7.6 Quotation edit flow (DRAFT only)
1. FE QuotationEdit submit `PUT /quotations/{id}` dengan body lengkap
2. `fn_update_quotation`:
   - Lock row + verify status='draft' (raise kalau bukan)
   - DELETE existing items
   - UPDATE header
   - INSERT new items (re-fire triggers)
3. Return `quotation_id`

Status non-draft → reject. FE harus handle error 4xx + tampilkan pesan.

### 7.7 Status change flow
1. FE submit `PATCH /quotations/{id}/status` dengan `{status, note}`
2. `fn_change_quotation_status`:
   - Lock row + get old_status
   - Validate transition (state machine)
   - Idempotent (no-op kalau same status)
   - UPDATE quotation + INSERT status_history
3. FE re-fetch detail untuk timeline

---

## 8. Yang masih TODO

| Item | Severity | Note |
|---|---|---|
| JWT auth middleware | HIGH | `deps.CurrentUserID()` return 0. Wire JWT verify + set `userIDKey` di context |
| Decimal codec registration | MED | Skeleton pakai string. Untuk arithmetic native, register `pgx-shopspring-decimal` |
| sqlc generation (optional) | MED | `sqlc.yaml` ready. Tulis `.sql` query files lalu `make sqlc` kalau preferred |
| Logger (slog/zap) | MED | Sekarang minimal, log error pakai stdlib |
| Test coverage | MED | Per-domain unit tests + integration tests |
| Pagination metadata | LOW | List endpoint return array saja, tidak ada `{data, totalCount, hasMore}`. FE asumsikan |
| Rate limiting | LOW | Untuk public endpoints |
| OpenAPI/Swagger | LOW | Auto-generate dari handler atau manual write |
| Audit log umum | LOW | Selain status_history, header field changes belum di-log |
| PDF export | MED | `GET /quotations/{id}/pdf` belum ada — perlu chromedp/wkhtmltopdf |
| Excel export | LOW | `GET /quotations/export.xlsx` |

---

## 9. Cara kerja dengan migration

**Aturan emas: forward-only.** Setelah file di-push/applied, JANGAN edit. Bikin migration baru.

```bash
# Bikin migration baru
make migrate-new NAME=add_payments
# generates: migrations/00014_add_payments.sql

# Apply (di local atau staging/prod)
make migrate-up

# Status
make migrate-status

# Rollback satu migration (DESTRUCTIVE — data bisa hilang)
make migrate-down
```

Migrations 00001-00013 adalah baseline + iterations. Detail per file ada di header comment masing-masing.

---

## 10. Run locally

```bash
# Install deps
cd apps/api && go mod download

# Setup DB (one-time)
psql -U postgres -c "CREATE ROLE gns_app WITH LOGIN PASSWORD 'gns_app';"
psql -U postgres -c "CREATE DATABASE gns_quotation OWNER gns_app;"
psql -U postgres -d gns_quotation -c "GRANT ALL ON SCHEMA public TO gns_app;"

# Migrate + seed
make migrate-up
psql -v ON_ERROR_STOP=1 -f migrations/seeds/01_master.sql "postgres://gns_app:gns_app@localhost:5432/gns_quotation?sslmode=disable"
psql -v ON_ERROR_STOP=1 -f migrations/seeds/02_dev_samples.sql "postgres://gns_app:gns_app@localhost:5432/gns_quotation?sslmode=disable"

# Run
DATABASE_URL='postgres://gns_app:gns_app@localhost:5432/gns_quotation?sslmode=disable' \
JWT_SECRET=devsecret \
make run

# Test
curl http://localhost:8080/healthz
curl http://localhost:8080/api/v1/units
curl "http://localhost:8080/api/v1/clients/search?q=IMC"
curl http://localhost:8080/api/v1/quotations/stats
curl "http://localhost:8080/api/v1/quotations?status=sent&sortBy=created_at&sortDir=desc&limit=10"
```

---

## 11. Pertanyaan umum

**Q: Kenapa pakai pgxpool langsung, bukan sqlc-generated?**  
A: Tidak ada salah satu yang lebih benar. Skeleton pakai pgxpool karena: (a) tidak butuh codegen step, (b) repo signature stabil tetap, (c) backend dev bisa swap ke sqlc later tanpa change handler/dto.

**Q: Kenapa SQL ada di repo bukan di file `.sql`?**  
A: Untuk skeleton, inline SQL di Go file lebih cepat dibaca + edit. Kalau pakai sqlc nanti, query pindah ke `.sql` file dan repo method body tinggal call `q.MethodName(ctx, ...)`.

**Q: Kenapa monetary pakai string?**  
A: Trade-off: string bypass decimal precision concern di codec layer, FE tinggal parse. Kalau ada arithmetic di service (calc total dll), tetap pakai `decimal.Decimal`.

**Q: Kenapa banyak logic di DB (function + trigger) bukan di Go?**  
A: User preference: "no plain SQL in app layer". Plus: atomic operations + triggers yang mengikat invariant data lebih aman di-handle DB (single source of truth). Backend Go = thin orchestration layer.

**Q: Kenapa repo expose error langsung ke handler tanpa translation?**  
A: Skeleton pakai `httperr.Internal(err.Error())` untuk DB function errors. **TODO:** map specific PG errors (unique violation, FK violation, RAISE EXCEPTION) ke proper HTTP status. Ada helper di `internal/shared/db/pg_errors.go` (`IsUniqueViolation`, dll).

---

## 12. Checklist sebelum push ke main

- [ ] `go build ./...` sukses
- [ ] `go vet ./...` clean
- [ ] Migration baru sudah ada Up + Down
- [ ] Sanity test migration di local DB
- [ ] Update doc kalau ada endpoint baru atau pattern berubah
