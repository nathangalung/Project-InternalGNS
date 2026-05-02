# Historical Excel quotation import

Imports yearly folders of Excel quotations from `D:\quotation\<YEAR>_data\`
into the InternalGNS database. Currently set up for 2024, 2025, 2026.

## Pipeline

```
<YEAR>_data/*.xlsx ─▶ parse.py ─▶ staged.json ─▶ load_<YEAR>.py ─▶ Postgres
```

`parse.py` is offline; reads every workbook in `SOURCE_DIRS`, normalises
customer names against `CANONICAL_CUSTOMERS`, parses dates (Indonesian +
English, full + short month names, slash-numeric fallback), extracts items
+ discount + vessel hint. Writes `staged.json`.

Loader scripts:

| Script | Behaviour |
|---|---|
| `load.py`        | Full rebuild — TRUNCATEs transactional tables and reloads from staged.json. Use only for fresh dev DB. |
| `load_2025.py`   | Additive — appends 2025 records to the live DB. Dedupes items/vendors/contacts/vendor_products against existing rows. Inserts new customers (4011–4015) if missing. |
| `load_2024.py`   | Additive — same as above for 2024 records. Adds customers 4016–4018. |

All loaders:

1. Insert any missing canonical customers (no-op via `ON CONFLICT`).
2. Insert master deltas only — items deduped by IMPA-or-normalised-name,
   vendors by normalised name, contacts by `(company, normalised name)`,
   vendor_products by `(vendor_id, item_id)`.
3. Insert quotations chronologically per `(company, year)`. Q-number is
   regenerated Python-side from the file's actual date so a March 2024 file
   gets `/III/2024`. Format: `Q-{YY}{co_no}{seq}/GNS/{Roman}/{YYYY}`.
4. Files sharing the same original Q-number → version chain
   (`parent_id` chain, oldest by date is v1).
5. Original Excel Q-no + source filename written to `quotations.notes` for
   traceability.
6. Upsert `doc_sequences` for `(Q, company, year)` so the API's
   `fn_next_doc_no` continues from the right `last_seq` going forward.
7. Files where every line has `selling_price <= 0` are loaded with
   `status='draft'` so users can finish them in the UI.

## Decisions baked in

| Topic | Behaviour |
|---|---|
| Status | `'sent'` (default) — `'draft'` for files with no positive selling_price |
| Discount source | PRINT sheet's `Diskon X%` label, else 0 |
| Vessel name | PRINT sheet hint OR second-slash entity (only when not a canonical customer — broker pattern: `MBSS / Aman Maritim Nusantara` → customer = Aman Maritim) |
| Date format | `Jakarta, 06 January 2026` / `Sept 2024` / `09/07/2024` all supported |
| Phone | Stripped to digits, leading 62/0 removed, kept only when 9–12 digits |
| Item dedup | By IMPA when present, else normalised name |
| Vendor / contact dedup | Normalised lowercase name; honorifics (Bp/Ibu/Bpk/Mr/Mrs) stripped |
| Email dedup | Globally unique by lowercased email; later contacts with the same email keep the contact row but drop the email field |
| `update_vendor_price` | Always `FALSE` (no retroactive vendor sync) |
| `profit_pct` overflow guard | If `sell/cost > 999×` (likely Excel typo), drop cost_price to NULL so `profit_pct` ends up NULL via NULLIF — avoids overflow on `NUMERIC(7,4)` |

## Usage

```bash
cd apps/api/db/import
pip install psycopg[binary] openpyxl

# 1. Edit parse.py SOURCE_DIRS to point at the year folder you want
# 2. Parse Excel → staged.json
python parse.py

# 3. Dry run against the dev DB (rolls back, prints reconciliation)
python load_2024.py --dry-run     # or load_2025.py / load.py

# 4. Real run (commits)
python load_2024.py
```

Connect via `DATABASE_URL` env var (default
`postgres://gns_app:gns_app@localhost:5432/gns_quotation?sslmode=disable`).

## Files

- `parse.py` — Excel reader (depends on `unit_map.py`)
- `unit_map.py` — raw unit string → canonical `units.code` mapping
- `load.py` — full-rebuild loader (TRUNCATE + reload)
- `load_2025.py` — additive 2025 loader (uses helpers from `load.py`)
- `load_2024.py` — additive 2024 loader (uses helpers from both)
- `generate_seed.py` — alternative path: emits `apps/api/db/seeds/03_historical_2026.sql`
- `apply_migrations.py` — fallback migrator when `goose` CLI is unavailable
- `staged.json` — output of `parse.py` (gitignored; regenerated each run)
