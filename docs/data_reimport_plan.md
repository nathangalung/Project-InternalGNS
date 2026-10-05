# Historical data re-import plan

Rebuild every business table from `Data/Data` (quotations 2024 to 2026,
client POs, DO and invoice workbooks) into a clean database, renumber all
documents, and clean the product master. Owner decisions, October 2026.

## Decisions

| Topic | Decision |
|---|---|
| Quotation, invoice and delivery-note numbers | 5-digit running number per document type that restarts at 00001 every year (the year of the document's own WIB date, the one the number prints): `Q-00011/GNS/X/2026`, `INV-00007/GNS/X/2026`, `DN-00007/GNS/X/2026`, and `Q-00001/GNS/I/2027` after the last 2026 quotation (migration 00101; numbers issued earlier were renumbered within their year, in order). The Roman month and the year stay in the number, and search accepts `10/2026` or `X/2026` to find a month. |
| Historical numbers | Renumbered by document date. The number each document was issued under is kept, searchable, in `quotations.legacy_no`, `invoices.legacy_no` and `purchase_orders.legacy_dn_no` (migration 00099). |
| PO number | The client's own PO number. A PO created by accepting a quotation has no number until it is entered; Dalam Progres requires it. |
| Client number lock | Removed: no document number embeds the client number any more. |
| IMPA codes | Filled only on a confident match; the rest go to a review sheet. |
| Target | Dev first, then prod after a backup. User accounts are kept. |
| Test data | Only records from `Data/` remain: no e2e, fixture or app-made demo rows. |
| Revisions | A historical revision (same number with `-R`, `rev`, `revisi`, `(1)` and changed content) keeps its base number with `Rev.n`, as Buat Revisi does; identical copies are dropped. |
| Status | Written directly with a status-history row (the send and accept gates are for live work, and historical lines often lack vendor or harga beli). Accepted where a client PO exists; Dikirim otherwise, whatever the validity: nothing expires on its own (migration 00100 retired Kedaluwarsa). |
| Quotations without a harga jual | 2026: Draf. Older with a harga beli: Dibatalkan with the reason "Tidak pernah diberi harga jual". Older with no price at all: skipped. |
| PO split and merge | One PO per quotation. A quotation ordered by two clients is copied into one quotation per client, each with its own share. A PO covering two quotations sits on the main one with the PO's real lines; the other stays as it was. |
| Invoices | Dibayar when dated before 2026-09-05, more than a month before the 2026-10-05 rebuild (`PAID_BEFORE` in `seed_model.py`): paid at 09:00 WIB on the due date (the invoice date when none is printed), with a sent to paid history row. Dikirim when dated later. Amounts are the ones printed on the source workbooks. |
| Brokered names | The client is the first company in the customer cell; the second party goes to the notes. |
| Freight-only quotations | Imported as ordinary quotations with service lines. |
| What the client received | The issued PDF wins over a workbook edited after it: its lines, discount, number and date are imported when its table adds up to its printed total; otherwise the workbook stays and the PDF's grand total is noted. A version that exists only as a PDF joins its revision chain the same way, or is listed in the parse report. |
| Delivery place | The printed DELIVERY PLACE is the shipping line's destination, which the quotation PDF prints (the vessel only when there is none). A PO's shipping line carries the delivery place the client PO prints, at Rp 0 when nothing was charged. |
| Buyer and client details | Each invoice keeps the buyer it prints (name, address, NPWP when printed), even when that is another company than the PO's client. A client's address is the one its latest invoice billed to itself prints. |
| PO lines | Positions a client PO lists at Rp 0 (never offered, delivered or billed) are left out of the PO, its delivery note and invoice, and named in the PO notes. The vessel the client PO names replaces a contradicting quotation vessel, which is noted. |
| Products, vendors and contacts | Option and heading rows are never products; a client's request IMPA code that does not fit the offered product stays on the request only. Duplicates merge only by rule (spacing, case, legal form, Tehnik/Teknik, place or marketplace suffix) or by a recorded owner decision with its reason; the rest are review rows. Two people in one ATTN are two contacts, same-person spellings merge, and only a plain client mailbox is kept. |

## Why the current data cannot stay

- Seeds 05 and 06 attach POs and invoices to quotations three ids away from
  their real source (03_historical was regenerated and its ids moved), so
  most POs and invoices sit on the wrong quotation and carry wrong totals.
- 120 workbooks (most of 2026) were never parsed, and 309 files lost their
  offer text, 14 their sell prices, and 6 lines ended at a "Total" in an
  item name.
- The product master holds header residue, 271 IMPA codes with conflicting
  names, and typo duplicates.

## Pipeline (`apps/api/db/import`)

1. `parse.py` (rewritten for `Data/Data`): recursive scan, skip lock files,
   templates, blank `000` files, print-only exports and editor copies;
   detect the 15 DATA ENTRI layouts; read request, IMPA, offer, unit, qty,
   sell, cost, vendor; map "No Offer" to Tidak Ditawarkan lines; read the
   PRINT discount (percent or fixed amount), terms and totals; take the
   client reference and vessel from the file name when the sheet lacks
   them; resolve identical copies, revisions and different quotations that
   share a number.
2. `clean_products.py`: normalise names, validate IMPA codes, cluster
   duplicates with hard guards (numbers, part numbers, variant words and
   IMPA conflicts block a merge), write `products.json` plus
   `review_products.csv` for uncertain merges.
3. IMPA enrichment (`local/impa_enrichment.json`): verified codes and
   suggestions with source and score; only confident matches are applied.
   Codes are identifiers; names stay our own cleaned names, so no catalogue
   text is copied.
4. `build_docs.py` writes `out/pos.json` and `out/invoices.json` from the
   client PO files and the DO and invoice workbooks, each linked to its
   source quotation by evidence (client PO number, client reference, lines
   and prices) recorded in `local/docs_manifest.py`.
5. `build_seed.py`: numbers every document by date, restarting each year,
   writes statuses with their history, POs with client numbers, delivery
   notes and invoices with the amounts printed on the source files, and
   sets `doc_counters` per type and year so new documents continue after
   the highest number of their year. It writes
   `apps/api/db/seeds/03_historical.sql` and `out/seed_report.md` (counts,
   skipped and flagged records, totals that differ from the printed ones,
   and the number mapping) and `out/review_vendors.csv`;
   `apps/api/db/import/README.md` lists every rule.
6. `replace_business_data.sql` replaces the business tables with the seed
   in one transaction, and `verify_seed.py` checks the result.

## App changes

- `fn_next_doc_no`: `TYPE-NNNNN/GNS/<Roman>/<YYYY>`, one sequence per type and year (00101).
- PO number nullable until entered; the PO gate requires it.
- Client number editable after use.
- Search normalises `MM/YYYY` to the Roman form.
- Tests, CLAUDE.md and docs updated.

## Verification

- Every imported quotation, PO and invoice reconciles with its source:
  line count, totals, PPN and grand total within one rupiah.
- Spot checks per client and per year; the e2e suite on the rebuilt dev DB.
- Prod: backup, replace, smoke, counts.

## Table plan for the replacement

| Table | Action |
|---|---|
| users, refresh tokens | Kept |
| countries, units | Kept (master reference) |
| company_client, company_contacts, vendors, items, vendor_products, item_images | Rebuilt from Data |
| quotations, quotation_items, quotation_item_requests, item_request_matches, quotation_status_history, quotation_edit_locks | Rebuilt |
| purchase_orders, purchase_order_items, po_status_history | Rebuilt |
| invoices, invoice_items, invoice_status_history | Rebuilt |
| doc_counters | Emptied, then one row per type and year at the highest imported number of that year |

## Running the replacement

`apps/api/db/import/replace_business_data.sql` empties every table the
table plan rebuilds (users, refresh tokens, countries, units and goose
state stay) and loads `apps/api/db/seeds/03_historical.sql` in the same
transaction: an error anywhere rolls everything back. It refuses to run
unless migration 00101 is applied. The seed itself refuses to load into
non-empty business tables, so a plain `make seed-dev` never doubles data.

Data users entered in the app is carried over in the same transaction,
matched by normalised name (case, spaces and punctuation ignored, a
leading PT. or CV. and a trailing Tbk dropped). Test data never carries
over: rows the e2e users (`e2e.*@globalsakti.com`, `e2e-*`) or users with
a test mail domain (`@test.local`, `@example.test`) created, rows whose
names carry a test-suite prefix (`E2E<hex>`, `E2E-FA-`, the word `E2E`,
`Qzvx <run id>`, `ATDD `, `BDD AutoCreate Unknown`, `RFQ Kabel <digits>`,
`Test Fixture `), and contacts with a test mail domain, with everything
under them. The report counts them by kind, without names.

| Old rows | Carried over |
|---|---|
| Clients | NPWP, address, country, TKU, email and logo fill what the seeded client lacks; the old four-digit number stays when no other client holds it. An invoice billed to its own client then takes the NPWP and address it printed none of; an invoice billed to another company keeps its printed buyer. A client the seed lacks that existed before the last historical quotation and owns no document created in the app is kept as a client with no documents, with its master fields and contacts; its number stays when free, else it takes the next one. |
| Contacts | Added to the seeded client when it lacks the person (name without honorific, the email, or a shorter name only one seeded contact starts with); a matched contact gets the email, phone and title it lacks. An email is trimmed of stray separators and left out when it is not one plain mailbox (the app's rule) or another active contact uses it. The schema has no main-contact flag. |
| Vendors | Location, contact info and logo of vendors users edited fill a seeded vendor's gaps. |
| Products | Created after the last historical quotation, or holding photos: one matching a seeded product (IMPA code, then name) gives it its photos (8 at most, the cover first); one matching none is added again with its photos and vendor links, adding a vendor the seed lacks. |
| PO files | Attached to the seeded PO with the same client and PO number. |

What it cannot place is not loaded: clients that match no seeded client
and were created after the last historical quotation or own a document
created in the app (with their contacts and those documents), edited
vendors with no match, PO files with no matching
PO, and quotations, POs and invoices created in the app (an imported one
carries `legacy_no` or an import note). The script ends with a carry-over
report of counts, of the clients kept without documents (new id, number
and name) and of these rows by id and name, never NPWP or email values.

The seed SQL is never committed: the repository is public and the SQL
carries client prices, numbers and contacts. It is built on the operator's
machine from `Data/` and the decision files in `apps/api/db/import/local/`
(`make seed-build` runs the whole pipeline; `make seed-sql`, which
`make seed-dev` and `make reimport-dev` run first, rewrites the SQL from
the last outputs). Both stop and name what is missing when `Data/` or a
decision file is absent. `local/` exists only on that machine, so back it
up with the other business backups after every change; a fresh clone
cannot build the seed without it.

### Dev

```bash
make reimport-dev            # DATABASE_URL from the Makefile, local hosts only
```

The target refuses any `DATABASE_URL` whose host is not local (the same
guard as `db-clean-testdata`), runs the script with `psql -f`, and then
`verify_seed.py`, which exits non-zero on any failed check. Run it from
Linux or WSL (see the import README's Windows note). Stop `make dev` first
or expect the open browser tabs to show the old rows until they reload.

### Prod

The SQL is built on the operator's machine and copied to the VPS over
ssh; it never goes through git. On the operator's machine, from the
deployed commit with `Data/` and `local/` in place:

```bash
make seed-build                       # out/, seed_report.md, 03_historical.sql
ssh <vps> 'install -d -m 700 /tmp/reimport'
scp apps/api/db/seeds/01_master.sql apps/api/db/seeds/03_historical.sql \
    apps/api/db/import/replace_business_data.sql <vps>:/tmp/reimport/
```

Then on the VPS, from a checkout of the deployed commit (the api migrates
to 00101 on its first start):

1. Take a backup and confirm it ends with `backup ok`:
   `/opt/internalgns-ops/backup.sh` (or `systemctl start
   internalgns-backup.service`; see `docs/backup_restore.md`).
2. Rehearse on that backup and show the owner the carry-over report:
   restore it into a new database (`restore.sh <snapshot> gns_reimport_rehearsal`,
   with a rehearsal bucket as in `docs/backup_restore.md`), run step 4
   against that database with its output saved, and drop it afterwards.
3. Stop the api and web so nothing writes during the replacement:
   `docker stop <project>-api-1 <project>-frontend-1`.
4. Copy the three files into the Postgres container, keeping the layout
   the script includes the seed by, load the master data first (it adds
   any unit the seed needs, such as LGH, and changes nothing else), run
   the script there keeping its carry-over report, and remove every copy:

   ```bash
   PG=<project>-gns-postgres-1
   docker exec "$PG" mkdir -p /tmp/reimport/import /tmp/reimport/seeds
   docker cp /tmp/reimport/replace_business_data.sql "$PG":/tmp/reimport/import/
   docker cp /tmp/reimport/01_master.sql "$PG":/tmp/reimport/seeds/
   docker cp /tmp/reimport/03_historical.sql "$PG":/tmp/reimport/seeds/
   docker exec -e PGCLIENTENCODING=UTF8 "$PG" sh -c \
     'psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
        -f /tmp/reimport/seeds/01_master.sql'
   docker exec -e PGCLIENTENCODING=UTF8 "$PG" sh -c \
     'psql -X -q -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" \
        -f /tmp/reimport/import/replace_business_data.sql' | tee reimport-report.txt
   docker exec "$PG" rm -rf /tmp/reimport
   rm -rf /tmp/reimport
   ```

   A non-zero exit means nothing changed. Step 2's rehearsal runs the same
   commands against the rehearsal database.
5. Verify from the operator's machine (it needs `out/`) through an ssh
   tunnel: `cd apps/api/db/import && uv run verify_seed.py "<prod DSN>"`;
   every check must print PASS.
6. Start the api and web (`docker start`, or Dokploy **Deploy**), check
   `/readyz`, log in, open a quotation, a delivery note and an invoice PDF,
   and search the quotation list for a month (`10/2025`).

Photos, logos and PO files the carry-over could not place stay in MinIO
without a row; `cmd/orphan-blobs` lists them (dry run first, after a
fresh backup).

### Databases loaded before the paid rule

A database loaded with an older seed holds Kedaluwarsa quotations and
imported invoices left Dikirim. Migration 00100 moves every expired
quotation back to Dikirim on the api's first start. The invoices need
the one-off `apps/api/db/import/fix_imported_invoices_paid.sql`, which
holds no data, runs in one transaction, prints the counts before and
after, and changes nothing on a second run. After a backup:

```bash
# dev
psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f apps/api/db/import/fix_imported_invoices_paid.sql
# prod, from a checkout of the deployed commit on the VPS
PG=<project>-gns-postgres-1
docker cp apps/api/db/import/fix_imported_invoices_paid.sql "$PG":/tmp/
docker exec "$PG" sh -c \
  'psql -X -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /tmp/fix_imported_invoices_paid.sql'
docker exec "$PG" rm /tmp/fix_imported_invoices_paid.sql
```

`verify_seed.py` then passes as it does on a fresh load.

### Databases loaded before yearly numbers

A database loaded with a seed built before migration 00101 numbers each
type with one counter across years (`Q-00462/GNS/I/2026` for the first
quotation of 2026). Migration 00101 renumbers it on the api's first
start, within each year in the old order, so it holds the same numbers a
seed built now would load, and rewrites the notes that copy a number
(Revisi dari, Direvisi menjadi, Dipesan bersama, berasal dari); the
legacy numbers stay. Nothing needs running by hand: take the backup the
deploy takes anyway, and `verify_seed.py` then passes as it does on a
fresh load. Rebuild the seed (`make seed-build`) before any later
reimport: a seed built before 00101 refuses nothing on a 00101 database
but would load numbers the yearly counters do not know.

## Source and safety

- `Data/` is untracked and gitignored; the parser reads its root from
  `GNS_DATA_DIR` (default `<repo>/Data/Data`).
- Nothing derived from `Data/` is committed: the generated `out/` files,
  the seed SQL, the decision files in `apps/api/db/import/local/`
  (`docs_manifest.py`, `overrides.json`, `vendor_overrides.json`,
  `impa_enrichment.json`) and the tests that check the real files
  (`tests_local/`, run only with `GNS_DATA_DIR`) are gitignored and live
  only on the operator's machine. Back up `local/` with the business
  backups; it is the only record of the hand decisions.
- Reconciliation oracles from the survey (PDF grand totals, PRINT totals
  blocks, DO and invoice cell dumps) live outside the repo in
  `~/.cache/gns-reimport`.
