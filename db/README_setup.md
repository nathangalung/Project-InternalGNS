# Setup Database — GNS Quotation System

Panduan step-by-step setup database PostgreSQL untuk sistem quotation.

## Prasyarat

- PostgreSQL 14+ terinstall (cek: `psql --version`)
- Password user `postgres` diingat
- Punya akses `psql` atau pgAdmin 4

## Struktur file

```
D:\quotation\db\
├── 01_schema.sql        — DDL lengkap (tabel, generated cols, triggers, indexes, view)
├── 02_seed_master.sql   — Master data minimum (users, units, 3 company, items, vendors)
├── 03_sample_data.sql   — Sample transaksi end-to-end (quotation → PO → invoice)
└── README_setup.md      — File ini
```

---

## STEP 1 — Create database & user

Buka **cmd** atau **PowerShell**, masuk ke `psql` sebagai superuser:

```bash
psql -U postgres
```

Masukkan password `postgres`, lalu jalankan:

```sql
CREATE DATABASE gns_quotation;
CREATE USER gns_app WITH PASSWORD 'ganti_dengan_password_kuat';
GRANT ALL PRIVILEGES ON DATABASE gns_quotation TO gns_app;
\q
```

## STEP 2 — Apply schema

```bash
psql -U postgres -d gns_quotation -f D:\quotation\db\01_schema.sql
```

**Output yang diharapkan:** serangkaian `CREATE TABLE`, `CREATE INDEX`, `CREATE TRIGGER`, `CREATE VIEW`, tanpa error.

**Verify:**
```sql
-- Masuk ke DB
psql -U postgres -d gns_quotation

-- List tables
\dt
```

Harus muncul 14 tabel: `company_client`, `company_contacts`, `invoice_items`, `invoices`, `item_request_matches`, `items`, `purchase_order_items`, `purchase_orders`, `quotation_items`, `quotations`, `units`, `users`, `vendor_products`, `vendors`.

## STEP 3 — Seed master data

```bash
psql -U postgres -d gns_quotation -f D:\quotation\db\02_seed_master.sql
```

Verifikasi cepat:
```sql
SELECT COUNT(*) FROM users;           -- 3
SELECT COUNT(*) FROM units;           -- 16
SELECT COUNT(*) FROM company_client;  -- 3
SELECT COUNT(*) FROM items;           -- 14
```

## STEP 4 — Load sample transactions

```bash
psql -U postgres -d gns_quotation -f D:\quotation\db\03_sample_data.sql
```

Ini load 1 quotation (Q-264128), 1 PO, dan 1 invoice dengan data real dari `D:\quotation\data_existing\`.

## STEP 5 — Verifikasi schema & business logic

```sql
-- 1. Cek GENERATED columns di quotation header
SELECT quotation_no, total, total_discount, subtotal, dpp_nilai_lain, ppn_amount, grand_total
  FROM quotations WHERE id = 1;
-- Ekspektasi:
--   total=8141000, total_discount=407050
--   subtotal=7733950 (total - discount)
--   dpp_nilai_lain ≈ 7089037 (subtotal × 11/12)
--   ppn_amount ≈ 850684 (dpp × 0.12)
--   grand_total ≈ 8583755 (dpp + ppn = dpp × 1.12)

-- 2. Cek per-line GENERATED (profit, discount, subtotal)
SELECT line_number, qty, selling_price, cost_price,
       total_selling, discount_amount, subtotal,
       profit_amount, profit_pct
  FROM quotation_items WHERE quotation_id = 1
  ORDER BY line_number;

-- 3. Test reconciliation view (header vs SUM items)
SELECT * FROM quotation_reconciliation;
-- Kolom `diff` = total header - SUM(items.total_selling). Idealnya 0.

-- 4. Cek optimistic lock trigger
UPDATE quotations SET notes = 'test' WHERE id = 1;
SELECT row_version, updated_at FROM quotations WHERE id = 1;
-- row_version harus increment by 1, updated_at refresh ke NOW()

-- 5. Cek CHECK constraints (harus error)
INSERT INTO quotations (quotation_no, company_client_id, company_client_name, status, created_by)
VALUES ('Q-TEST', 1, 'Test', 'INVALID_STATUS', 1);
-- ERROR: check constraint "quotations_status_check"

-- 6. Cek CASCADE
SELECT COUNT(*) FROM quotation_items WHERE quotation_id = 1;  -- 13
-- Jangan hapus di production! Test di dev DB only:
--   DELETE FROM quotations WHERE id = 1 AND status = 'draft';
--   → akan error karena ada PO yang RESTRICT

-- 7. Cek fuzzy search (pg_trgm)
SELECT id, name, similarity(name, 'LAMP LED 100W') AS score
  FROM items
  WHERE name % 'LAMP LED 100W'
  ORDER BY score DESC;
```

---

## Troubleshooting

### Error: `extension "pg_trgm" is not available`
PostgreSQL installation tidak include pg_trgm. Install `postgresql-contrib`:
- Windows: reinstall PostgreSQL, pastikan "Contrib" checked
- Atau: download manual dari https://www.postgresql.org/download/

### Error: `syntax error near GENERATED`
PostgreSQL kamu di bawah v12. GENERATED STORED butuh v12+. Upgrade ke v14+.

### Error pada seed: `duplicate key value violates unique constraint`
Seed sudah pernah dijalankan. Drop DB lalu ulangi:
```sql
DROP DATABASE gns_quotation;
CREATE DATABASE gns_quotation;
-- Lalu ulangi dari STEP 2
```

### pgAdmin connection
Kalau pakai pgAdmin:
1. Register Server → Name: GNS Local
2. Connection tab: Host=localhost, Port=5432, Username=postgres
3. Password disimpan di .pgpass kalau mau auto-connect

---

## Catatan design penting

- **GENERATED columns (STORED)**: PostgreSQL auto-compute, tidak bisa ditulis langsung. App cukup INSERT base columns, DB isi sisanya.
- **row_version**: Auto-increment via trigger tiap UPDATE. App harus check via `WHERE row_version = ?` untuk optimistic locking.
- **updated_at**: Auto-update via trigger, app tidak perlu set manual.
- **Snapshot fields** (`company_client_name`, `contact_name`, `invoice_items.item_name`): Diisi app saat CREATE, **intentionally NOT FK** — dokumen historis harus frozen walaupun master data berubah.
- **ON DELETE**: CASCADE untuk items→header, RESTRICT untuk cross-doc dan master references. Jangan pernah DELETE invoice/PO yang sudah di-send — pakai status `cancelled`.

---

## Next steps

Setelah DB siap:
1. Connect aplikasi (Node/Python/Go) dengan connection string:
   `postgres://gns_app:password@localhost:5432/gns_quotation`
2. Implementasikan numbering sequence logic di app layer (atau tambahkan `doc_sequences` table — lihat memory pending items)
3. Backup strategy: `pg_dump` harian ke folder backup/cloud
