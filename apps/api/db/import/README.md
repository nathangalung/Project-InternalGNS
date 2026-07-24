# Historical Excel quotation import

Turns yearly folders of Excel quotations into the committed SQL seed that
`make seed-dev` loads. Set up for 2024, 2025, and 2026.

## Pipeline

```
<YEAR>_data/*.xlsx -> parse.py -> staged.json -> generate_seed.py -> 03_historical.sql -> make seed-dev
```

`parse.py` runs offline: it reads every workbook in `SOURCE_DIRS`, normalises
customer names against `CANONICAL_CUSTOMERS`, parses dates (Indonesian and
English, full and short month names, with a slash-numeric fallback), and
extracts items, discount, and a vessel hint. It writes `staged.json`.

`generate_seed.py` reads `staged.json` and writes one deterministic
`apps/api/db/seeds/03_historical.sql` that covers all three years in a single
truncate-and-rebuild seed. No live database is needed to generate it, and
`make seed-dev` applies it alongside `01_master.sql`.

## What the seed builder does

`generate_seed.py` emits, in order:

1. Any missing canonical customers, via `ON CONFLICT` no-ops.
2. Master deltas only: items deduped by IMPA or normalised name, vendors by
   normalised name, contacts by `(company, normalised name)`, vendor_products
   by `(vendor_id, item_id)`.
3. Quotations, chronologically per `(company, year)`. The Q-number is rebuilt
   from the file's actual date, so a March 2024 file gets `/III/2024`. Format:
   `Q-{YY}{co_no}{seq}/GNS/{Roman}/{YYYY}`.
4. Version chains for files that share an original Q-number (a `parent_id`
   chain, oldest by date is v1).
5. The original Excel Q-number and source filename into `quotations.notes` for
   traceability.
6. A `doc_sequences` upsert for each `(Q, company, year)` so the API's
   `fn_next_doc_no` continues from the right `last_seq`.
7. `status='draft'` for files where every line has `selling_price <= 0`, so
   users can finish them in the UI.

## Decisions baked in

| Topic | Behaviour |
|---|---|
| Status | `'sent'` by default; `'draft'` for files with no positive selling price |
| Discount source | The PRINT sheet's `Diskon X%` label, else 0 |
| Vessel name | PRINT sheet hint, or the second-slash entity when the first is not a canonical customer (broker pattern: `MBSS / Aman Maritim Nusantara` gives customer Aman Maritim) |
| Date format | `Jakarta, 06 January 2026`, `Sept 2024`, and `09/07/2024` are all supported |
| Phone | Stripped to digits, leading 62/0 removed, kept only when 9 to 12 digits |
| Item dedup | By IMPA when present, else normalised name |
| Vendor and contact dedup | Normalised lowercase name; honorifics (Bp/Ibu/Bpk/Mr/Mrs) stripped |
| Email dedup | Globally unique by lowercased email; a later contact with the same email keeps its row but drops the email field |
| `profit_pct` overflow guard | If `sell/cost > 999x` (a likely Excel typo), drop cost_price to NULL so `profit_pct` resolves to NULL via NULLIF and never overflows `NUMERIC(7,4)` |

## Usage

```bash
cd apps/api/db/import
uv sync                  # install dependencies from pyproject.toml
uv run parse.py          # Excel -> staged.json
uv run generate_seed.py  # staged.json -> apps/api/db/seeds/03_historical.sql
```

Then load the seed from the repo root with `make seed-dev`.

### Windows note

`make seed-dev` already handles the Windows quirk: it pipes each file via
stdin with `PGCLIENTENCODING=UTF8` (see the Makefile). Use it whenever
possible. Applying a seed with `psql -f file.sql` on Windows reads UTF-8 as
cp1252, which corrupts multi-byte characters and trips the varchar length
checks. Pipe via stdin instead:

```bash
PGCLIENTENCODING=UTF8 psql "$DATABASE_URL" -v ON_ERROR_STOP=1 < apps/api/db/seeds/03_historical.sql
```

## Files

- `parse.py` — Excel reader, depends on `unit_map.py`
- `unit_map.py` — raw unit string to canonical `units.code` mapping
- `generate_seed.py` — emits `apps/api/db/seeds/03_historical.sql`
- `staged.json` — output of `parse.py`
