# Historical Excel quotation import

Turns the Excel quotations in `Data/Data/Quotation` into staged JSON for the
historical re-import (`docs/data_reimport_plan.md`). Set up for 2024, 2025,
and 2026.

## Pipeline

```
Data/Data/Quotation/**/*.xlsx -> parse.py -> out/staged.json + out/parse_report.md
out/staged.json + local/overrides.json -> clean_products.py
  -> out/products.json + out/review_products.csv
Data/Data/{PO,Invoice} + local/docs_manifest.py -> build_docs.py
  -> out/pos.json + out/invoices.json + out/review_docs.csv
out/* + local/impa_enrichment.json + local/vendor_overrides.json
  -> build_seed.py -> ../seeds/03_historical.sql + out/seed_report.md
                      + out/review_vendors.csv
  -> make reimport-dev (replace_business_data.sql) -> verify_seed.py
```

## Where the data lives

The repository is public, so nothing derived from `Data/` is committed.
These paths are gitignored and exist only on the operator's machine:

| Path | Holds |
|---|---|
| `out/` | Everything the pipeline writes: staged quotations, products, POs, invoices, reports and review sheets |
| `local/` | The hand-made decisions: `docs_manifest.py` (the PO and invoice decisions), `overrides.json` (product merges, splits, codes and names), `vendor_overrides.json` (vendor merges), `impa_enrichment.json` (confirmed IMPA codes) |
| `tests_local/` | The checks against the real files; they run only with `GNS_DATA_DIR` set |
| `../seeds/03_historical.sql` | The seed, rebuilt by `make seed-build` or `make seed-sql` |

`local/` is the only record of the owner's decisions: back it up with the
business backups after every change (an encrypted archive off this
machine), and restore it before building on another machine. `make
seed-build` runs the whole pipeline; `make seed-sql` (which `make
seed-dev` and `make reimport-dev` run first) rewrites the SQL from the
last outputs. Both stop and list what is missing when `Data/` or a file in
`local/` is absent. Tracked tests use invented numbers, contacts and
amounts only.

## parse.py

Reads `GNS_DATA_DIR` (default `<repo>/Data/Data`) and never writes under it.

| Module | Role |
|---|---|
| `scan.py` | Recursive discovery, lock files and templates, file-name parts (number, suffix, client reference, vessel, topic, client, revision and copy markers) |
| `sheets.py` | DATA ENTRI and PRINT sheets read by header labels: the 15 item-table layouts, page headers and page totals, continuation rows, the PRINT reference, vessel rows, terms and totals block |
| `values.py` | Dates (Indonesian and English, typos, datetime cells), numbers, IMPA codes (six digits, known section), No Offer text, canonical clients |
| `unit_map.py` | Raw unit to `units.code`, reporting units it could not map |
| `quotation.py` | One record per quotation in a workbook (DATA/PRINT, DATA2/PRINT2, an embedded quotation sheet, a revised print sheet, a print-only export), lines, discount, PPN and computed totals |
| `dedup.py` | Identical copies dropped (kept as `aliases` with what differs), revisions chained by date, different quotations sharing a number kept apart and linked by `related_to` |
| `reconcile.py` | PDF matching (number before file name), the PDF content check and the totals comparison with a cause for every difference |

Decisions it applies:

- Lines come from DATA ENTRI; the printed amount wins over qty x unit price
  (the quantity follows when both amounts were computed for another one),
  and a DATA line the PRINT sheet did not total (missing, no amount, a kit
  component) is kept with `in_total: false` only when that reconciles a
  non-zero printed gross. A PRINT total of zero excludes nothing.
- A revision sheet ("Print revisi") revises the DATA sheet of its own
  workbook it shares lines with; one sharing none is a stale copy and is
  listed under Sheets not imported.
- Judgements the parser does not make (lines out of the totals, same-date
  revisions, revisions under a new number, copies with another number,
  reused workbooks, foreign references) are listed under Owner decisions.
- No Offer (in the offer, Nama Asli, or printed by the PRINT sheet) is an
  unavailable line at price 0.
- The discount is a percentage when the label or the amount says so,
  otherwise a fixed rupiah amount. PPN follows the printed block: none when
  it has no PPN row or prints zero, DPP Nilai Lain when it has that row.
- A brokered customer cell bills the first company; the second party is
  kept as `broker_note`.
- A numbered request row answered by unnumbered priced rows is one line,
  or one option line per answer named "request - option"; a heading
  ending in a colon with no quantity or price is never a line.
- The issued PDF wins over a workbook edited after it (`issued.py`,
  `pdf_quote.py`): when its table adds up to its printed total, its lines,
  discount, number, date, reference and contact are imported, keeping each
  matched line's harga beli and vendor; otherwise the record is flagged
  `pdf_lines_unread` and the seed notes the PDF total. A workbook whose
  header was copied from another quotation takes the PDF's header, and a
  version that exists only as a PDF joins its revision chain by date.
  PDFs it could not read are listed under Issued PDFs.
- A print-only revision sheet takes harga beli and vendor from its
  workbook's lines; a signing line ("Jakarta, 20 Juli 2024") is not a
  delivery time.
- Nothing is guessed: a missing date stays null, and every judgement is a
  flag on the quotation or the line.

Each record carries its source paths, every number the workbook prints
(PRINT, DATA ENTRI, file name, PDF), the PRINT totals block, computed
totals, revision link, flags and the reconciliation result.
`out/parse_report.md` lists counts per year, every excluded file with its
reason, copies, revision chains, shared numbers, flags and every total off
by more than Rp 1 with its cause.

The reconciliation reads the survey oracles from `GNS_ORACLE_DIR` (default
`~/.cache/gns-reimport`: `pdf.tsv` with the PDF grand totals, `disc.json`
with the PRINT totals blocks) and fills totals the survey missed with
`pdftotext` when it is installed; without them that section is skipped.

## clean_products.py

Turns every staged line into one canonical product (`out/products.json`)
and lists what a person should check in `out/review_products.csv`. Rules
follow section 10 of the product-quality survey, with the plan's decisions
on top:

- Name: the offer text when the line was offered, else the request. The
  request stays the name, with the offer in the description, when the
  offer only qualifies it (a brand or IMPA note, a bare code, a pack size
  such as "1 Strip 4 tablet", or a two-word fragment such as "DOUBLE
  WALL"); a placeholder offer ("please provide details", "To be
  Confirm") is kept as a note. Nama Asli is not used (it is the
  supplier's listing and often belongs to another row). The name is one
  line; the rest is the description. Catalogue prose, IMPA mentions and
  heading lines are stripped; an IMPA RFQ group heading moves behind the
  coded line only when the client wrote it (the offer kept the request's
  first line), so a GNS offer such as "Foil Wrapping - Plastic Cling Wrap
  Food Grade" stays the name. No catalogue text is fetched.
- Notes: request echoes ("REQUEST BAYGON 600 ml") and order or stock
  notes (min. order, pre-order, only N available, N working days, made to
  order, delivery time, ...) go to `notes`, out of the matching key; pack
  sizes go to `pack_note`. Application lines ("untuk Yanmar 6N18", "for
  engine store", "sesuai contoh A") stay in the description and the key.
  A request echo still adds its variant words and part numbers to the
  guards, so "Kampas rem / request kiri" never merges with "... kanan".
- Matching key: normalised text of the name and description (synonyms,
  units glued to numbers, stop words dropped, a few corpus spelling fixes).
- Guards: numbers, part numbers, variant words (colours, sides, sizes,
  tips, materials, condition, countries, ...), short tokens, item kinds
  (product, service, medicine, publication), IMPA codes, and the codes a
  line carried but could not use (cell and text disagreeing): two lines
  whose such codes differ never merge. Guards are checked against every
  member of an item, not only the pair that matched.
- One quotation: two lines of one quotation with different keys are
  different products by construction and never share an item; a repeated
  line does.
- Tiers: lines sharing a validated code merge when every guard passes and
  their texts reach token sort 60 (the code only lowers the text bar).
  Identical keys (or identical sorted tokens) merge when every guard
  passes. Fuzzy matches (token sort >= 90, or >= 92 on the space-free
  key) that pass every guard are review rows and never merge. Every item
  merged from texts with different keys is a `merged_texts_differ` row.
- IMPA: a valid cell is used; "IMPA nnnnnn" in the text fills an empty
  cell; a cell holding 0 or - is blank; a cell that disagrees with the
  text, an invalid cell and a bare six-digit number in brackets give no
  code (review rows). A code checked by the survey (sections 3b, 3e, 3f,
  e.g. 650878 only on a sounding tape, 7942xx/7943xx never on NYYHY) or
  from the wrong section for a bolt, welding consumable or shackle is
  rejected (`impa_suspect`). A code whose lines split into different
  products stays with the group matching the most requests written
  against it, then the text closest to those requests, then the most
  lines; an exact tie leaves it off. Every split is an `impa_split` row.
- Unit: the most used unit of the item's lines; mixed, missing and
  unmapped units are review rows.
- Never products: trade-in credits and other negative rows, and option or
  heading rows (folded into their parent line by the parser).
- Request codes: the client's IMPA code is kept off a product of another
  size or kind than it names (`impa_request_differs`), and stays on the
  quotation line's request.

Items have a stable id, a hash of their first source line. Each review
row carries both sides' source lines as `[quotation, line_no]` JSON, their
display text, the reason, a detail and a `decision` column.

Decisions go into `local/overrides.json` (a JSON list, never committed),
keyed by source lines, each with a `reason`, which the next run applies:

```json
[
  {"action": "merge", "lines": [["<quotation id>", 3], ["<quotation id>", 7]]},
  {"action": "split", "lines": [["<quotation id>", 4]]},
  {"action": "set_impa", "lines": [["<quotation id>", 2]], "impa": "650878"},
  {"action": "rename", "lines": [["<quotation id>", 2]], "name": "...", "description": "..."}
]
```

`split` and `set_impa` (a code, or null to clear) act on the listed lines
before any tier runs; `merge` joins the listed lines' items after the
automatic tiers but never two IMPA codes; `rename` sets the name of the
item holding the first line. A review row that an override touches shows
it in `decision`; an override naming unknown lines or a bad action or code
is an `override_invalid` row.

## build_seed.py

`build_seed.py` turns the staged quotations, the product master, the
confirmed IMPA codes, the vendor decisions, `out/pos.json` and
`out/invoices.json` into one deterministic
`apps/api/db/seeds/03_historical.sql` (the same bytes on every run),
`out/seed_report.md` and `out/review_vendors.csv`. No database is needed to build it. The rules live in
`seed_model.py` (pure Python, unit-tested), the SQL in `seed_sql.py`.

| Topic | Rule |
|---|---|
| Numbers | `Q-`, `INV-` and `DN-NNNNN/GNS/<Roman month>/<YYYY>`, one running counter per type in document-date order (ties by original number, then source path, then client), month and year from the document's own date. A revision keeps its base number plus ` Rev.n`, as Buat Revisi writes it. The number each document was issued under goes to `quotations.legacy_no` (the PDF's number when one was issued, without reference text after the year; other numbers a copy or the workbook printed go to the notes), `invoices.legacy_no` and `purchase_orders.legacy_dn_no` (the printed DO number), which the app searches. `doc_counters` ends at the highest loaded number of each type. |
| Quotation status | Accepted where a client PO exists; superseded by a revision: Revisi; otherwise Kedaluwarsa when date + validity is before the reference day (2026-10-04, `--as-of`), else Dikirim. No harga jual on any line: Draf in 2026, Dibatalkan (`Tidak pernah diberi harga jual`) when older with a harga beli, skipped when older with no price. Each status is written with its history: NULL to draft and draft to sent at the quotation date, sent to accepted at the PO date, sent to expired at date + validity (as `fn_expire_quotations` writes it, no actor), sent to revision at the revision's date. |
| Totals | The app's own `fn_recompute_quotation_totals` writes every quotation total (per-line DPP Nilai Lain and PPN), so PPN is always added. A difference of more than Rp 1 from the printed grand total (the PDF's when the lines came from it) puts `Grand total tercetak: Rp ...` in the notes, and a workbook edited after a PDF that could not be read notes `Grand total tercetak (PDF): Rp ...`; the report lists each with its cause. |
| Lines | Every staged line, with its product as `offered_item_id` and its vendor link. Lines the PRINT sheet left out of its total are ordinary lines, named in the notes. No Offer lines are Tidak Ditawarkan (harga jual 0, no vendor, no harga beli). A quantity that is missing or 0 follows the printed amount, else 1 (`quotation_items.qty > 0`); a negative line (a trade-in credit) is not a line but a note. An extra charge on the PRINT sheet, the delivery days (`N working days ...`) and the printed DELIVERY PLACE (its `ship_destination`, which the quotation PDF prints) become the one shipping line. A vendor cell naming several shops links the first and notes the rest. |
| Discount | The PRINT percentage; a fixed amount is stored as the nearest percentage, the printed amount in the notes. |
| Split and merge | A quotation ordered by two clients is one quotation per client with that client's PO quantities; a PO covering two quotations sits on the main one with the PO's real lines, and the other quotation is noted. A PO without a quotation in the files gets one rebuilt from its lines, with a product for each (the catalogue's when the name matches), a unit, and the PO's discount. |
| POs | The client's PO number, or none with the reason in the notes. Lines are the PO's own, each with the quotation line's product and vendor link; a line equal to the printed untaxed amount is the shipping line, and positions at Rp 0 are left out and noted. The shipping line carries the delivery place the PO prints (else the quotation's), at Rp 0 when nothing was charged. The vessel the PO names replaces a contradicting quotation vessel, which is noted, since the delivery note and invoice print it. A second company the PO prints is noted as `Pihak kedua`. Every PO is invoiced, so it is DELIVERED (Dikirim) with its delivery note dated the DO date (the invoice date when no DO is printed), with history PENDING, UPLOADED, ON_PROGRESS at the PO date and DELIVERED at the DO date. |
| Invoices | Dikirim, with dates, lines and header amounts as printed in `invoices.json`, never recomputed; the printed discount and PPN are spread over the lines so they sum to the header. The buyer is the one the invoice prints (name, address, NPWP when printed), even another company than the PO's client. Freight, cargo and boat lines are services (J). |
| Masters | One client per canonical name, numbered 0001 up by first quotation date, with the address its latest invoice billed to itself prints (no file prints an NPWP). Contacts from the quotations' ATTN data: two people in one ATTN are two contacts, contacts sharing an email or whose name is part of one other's merge, only a plain client mailbox (`validate.Email`'s pattern, not the seller's own) is kept, and an email shared across clients goes where it was used most. One vendor per merge key (case, spacing, legal form, honorific, Tehnik/Teknik and a place or marketplace suffix ignored) or per owner decision in `local/vendor_overrides.json`, with the phone and place from its Telp column; look-alikes no rule joined are rows in `out/review_vendors.csv`. Every product in `out/products.json`, with `impa_enrichment.json` codes applied when present and not taken; one vendor link per vendor and product, at the latest harga beli. |
| Actor | Every row is created by the oldest active superadmin, looked up in SQL. |

The SQL refuses to load unless migration 00099 is applied, 01_master.sql
is loaded, a superadmin exists and every business table is empty, so `make
seed-dev` on a populated database stops with a pointer to `make
reimport-dev`. It loads in one transaction, writes the history the
creation triggers log at load time with its real dates, and turns
`trg_quotations_updated_at` off only while the app's total function runs,
so `updated_at` ends as the last status move.

`replace_business_data.sql` empties every business table (users, refresh
tokens, countries, units and goose state stay) and loads the seed in the
same transaction, carrying over what users entered in the app (client tax
fields, logos and numbers, clients the seed lacks that existed before the
last historical quotation, kept without documents, contacts, vendor
contact fields, products made in the app or holding photos, PO files;
never rows the test suites created) and printing a carry-over report of what it could not place; `make reimport-dev` runs it on a local
database and then `verify_seed.py`. The carry-over rules and the prod
steps are in `docs/data_reimport_plan.md`.

`verify_seed.py DSN` checks a loaded database inside a rolled-back
transaction: quotation totals against `fn_recompute_quotation_totals`,
invoice amounts against `invoices.json`, number formats and periods,
`doc_counters`, POs at work without a PO number, status against history,
`fn_expire_quotations` on the reference day, the numbers documents were
issued under, invoice buyers against the printed ones, PO product lines
above Rp 0, a product and unit on every offered line of an accepted
quotation, and rows per table against the report (master tables the
carry-over adds to may hold more). It exits 1 on any failure.

## Usage

The tool runs on Python 3.14 (`.python-version`) and needs uv 0.12.19 or
newer (`[tool.uv] required-version`); `uv self update` upgrades an older uv.

```bash
make seed-build          # from the repo root: the whole pipeline below

cd apps/api/db/import
uv sync                  # install dependencies from pyproject.toml
uv run parse.py          # Data/Data/Quotation -> out/staged.json, out/parse_report.md
uv run clean_products.py # out/staged.json -> out/products.json, out/review_products.csv
uv run build_docs.py     # Data/Data/{PO,Invoice} -> out/pos.json, out/invoices.json
uv run validate_docs.py  # arithmetic, links, dates, files; exits 1 on any error
uv run build_seed.py     # -> apps/api/db/seeds/03_historical.sql, out/seed_report.md
uv run pytest            # synthetic tests; tests_local/ skips without GNS_DATA_DIR
GNS_DATA_DIR=/path/to/Data/Data uv run pytest   # plus the checks on the real files
GNS_FULL_CORPUS=1 GNS_DATA_DIR=/path/to/Data/Data uv run pytest -k full   # slow
uv run ruff check . && uv run ruff format --check .
```

Then load the seed from the repo root: `make seed-dev` on a new database,
`make reimport-dev` on one that already holds business data.

The seed integration test loads the SQL into a throwaway database and runs
the verification, then runs the replacement over app-style edits and checks
the carry-over; it needs `GNS_DATA_DIR`, `goose` and `TEST_DATABASE_URL`
naming a database whose name ends in `test`, which it drops and recreates
(`GNS_MIGRATIONS_DIR` points goose at another migrations folder):

```bash
GNS_DATA_DIR=/path/to/Data/Data \
TEST_DATABASE_URL=postgres://gns_app:gns_app@localhost:5432/gns_seed_test \
  uv run pytest tests_local/test_seed_integration.py
```

### Windows note

`make seed-dev` pipes each seed via stdin with `PGCLIENTENCODING=UTF8` (see
the Makefile). Applying a seed with `psql -f file.sql` on Windows reads
UTF-8 as cp1252, which corrupts multi-byte characters and trips the varchar
length checks. `replace_business_data.sql` includes the seed by a relative
path, so `make reimport-dev` runs it with `-f`: run it from Linux or WSL.

## Client POs and invoices

`out/pos.json` and `out/invoices.json` are the curated client purchase
orders and invoices for the re-import (`docs/data_reimport_plan.md`), with
amounts as printed and each PO traced to the quotation workbook it came
from.

`docs_extract.py` reads the Pelita portal PDFs, the DO and invoice
workbooks (the printed buyer block, and the DO sheet's units for invoice
lines that print none) and the quotation workbooks. `local/docs_manifest.py`
holds what a person decided: the photographed and scanned orders
transcribed by hand, the quotation behind each PO with its evidence, the
split and merge cases, kept and dropped workbooks, and year-typo fixes.
Change a decision there and rebuild; never edit the JSON by hand.

What the importer reads besides amounts:

- `quotation`: the workbook behind the PO, with `other_files` (merged
  quotations), `sibling_files` (each with a `relation`: `copy` to drop,
  `earlier_version` printing the same number, `different_number` to import
  as its own quotation) and `changed_after_order` when the workbook gained
  lines after the order.
- `synthetic_quotation`: set when no quotation in Data can be the source
  (a workbook overwritten with another quote, a price agreed before any
  quotation, freight quoted outside the files). Build one from the PO's
  lines, dated `date` (the PO date); `overwritten_file` names the workbook
  that must not be imported under the lost number.
- `po_date_source`: `document`, `invoice`, `correction`, or
  `billing_fallback` (earliest DO or invoice date, for invoice-only orders
  printing no PO date). `client_po_number_missing_reason` explains a null
  PO number.
- Invoices: `buyer` (the printed name, address and NPWP), `corrections`
  (printed value, fix and reason), `do_source_file` when the DO lives in
  another workbook, `extra_dos` for later partial deliveries; a dropped
  workbook with `used_for` still supplies a DO sheet.

`validate_docs.py` also checks date order: every quotation on or before its
PO, every invoice on or after its DO and its PO.

## Files

- `parse.py` — quotation parser CLI (modules in the table above)
- `issued.py`, `pdf_quote.py` — read issued quotation PDFs and apply them
- `paths.py` — every input and output location, in one place
- `tests/` — pytest suite on synthetic workbooks and records (tracked)
- `tests_local/` — the checks against the real files (gitignored)
- `local/` — the hand-made decisions (gitignored; back it up)
- `out/staged.json` — one quotation per line, with its evidence
- `out/parse_report.md` — counts, exclusions, duplicates, reconciliation
- `clean_products.py` — product master cleanup and review sheet
- `out/products.json` — canonical products with their source lines and counts
- `out/review_products.csv` — merges, IMPA codes and items to check by hand
- `unit_map.py` — raw unit string to canonical `units.code` mapping
- `build_seed.py` — writes `apps/api/db/seeds/03_historical.sql`,
  `out/seed_report.md` and `out/review_vendors.csv` (rules in
  `seed_model.py`, vendor names in `vendors.py`, SQL in `seed_sql.py`)
- `build_docs.py`, `docs_extract.py`, `validate_docs.py` — client POs and
  invoices to `out/pos.json` and `out/invoices.json`, and their checks
- `out/seed_report.md` — counts, skipped and flagged records, totals that
  differ from the printed ones, and the number mapping of every document
- `replace_business_data.sql` — empties the business tables and loads the
  seed in one transaction (`make reimport-dev`)
- `verify_seed.py` — checks a loaded database; exits 1 on any failure
