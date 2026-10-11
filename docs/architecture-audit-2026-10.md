# Architecture audit, October 2026

Follow-up to `architecture-audit-2026-08.md`. Three read-only scouts
(prior-audit status, backend, frontend) checked the code at v0.31.0, then
separate agents fixed the verified defects test-first, each in its own
worktree, and the branches were merged and tested together (#90). Every
finding below cites code; nothing is carried over unverified.

## Fixed in v0.32.0

| Area | Defect | Fix | PR |
| --- | --- | --- | --- |
| Security | excelize v2.11.0 had nine HIGH advisories reachable from the RFQ upload (untrusted workbooks); Go 1.27.1 and x/net had net/http, HTTP/2 and TLS advisories | excelize fix commit, x/net v0.60.0, Go 1.27.2 | #83 |
| Correctness | The PO completeness gate read the status and client outside the move, so a raced move skipped it and a raced client edit reached a filed invoice | Gate and move in one transaction, PO locked, client share-locked | #86 |
| Security | The storage proxy let operational input write PO documents and finance input write invoice attachments, which their routes forbid | `CanWriteObject(role, bucket, key)` | #86 |
| Concurrency | PO details and notes accepted a write without If-Match | 400 without it, as every other versioned write | #86 |
| Performance | Match-rows ran one or two statements per row (about 1,000 for a 500-row RFQ) in one transaction under the 30 s budget | IMPA and price reads batched per chunk (10 statements for 500 rows) | #85 |
| Correctness | `FindByIMPA` read a server error as "no match" | Batched read through `pgx.CollectRows` | #85 |
| Correctness | `minScore` above 1 with `autoCreate` duplicated every row into the catalog | 422 outside (0, 1] | #85 |
| Performance | Since 00099 the quotation search ORs `legacy_no` with no index, so its two trigram indexes were unusable | 00108 trigram index (Seq Scan to BitmapOr on 50k rows) | #85 |
| UX, data loss | One network blip during the lock heartbeat dropped the claim, and the next line save failed after the dialog closed | Claim dropped only on a 4xx refusal | #84 |
| Copy | Network failures toasted the browser's English text | Fallback for `TypeError` and `SyntaxError` | #84 |
| Performance | ProductAdd queried the catalog while closed, and refetched three queries on every live save | Mounted only while open | #84 |
| Performance | Each own live save fetched the draft twice | Mutation invalidation joins the stream's refetch | #84 |
| Data | Units duplicated by abbreviation (PKT and PACK), slashed names, and RFQ units like PC or EA unmatched | Alias table, one text one unit, PACK folded into PKT | #88 |
| Seed | On a fresh database 00106 took ids 1 and 2, so the master seed skipped MT and WT | Seed inserts by code | #88 |

Toolchain note: Go 1.27.2's cover tool counts fewer statements per block,
which dropped four packages under 98% with no test lost. The gap was
closed with fault-path tests, never by lowering a threshold.

## Still open, ranked by production risk

1. **No `indisvalid` check.** About a dozen `CREATE INDEX CONCURRENTLY IF
   NOT EXISTS` migrations (00044, 00054, 00108 and others) can leave an
   invalid index after an interrupted build, and the next boot skips it
   silently, including `uq_invoices_po_id_live`. Fix: a boot or CI check
   that fails on any `pg_index.indisvalid = false`.
2. **`/readyz` as the API liveness probe** (`cmd/api/main.go`). A short
   Postgres blip fails three probes and the container is marked unhealthy,
   so Traefik drops the route and an autoheal restart would bounce a
   process that needed no restart. Weigh it before changing: with
   `/healthz` the route stays up through the blip and requests answer 503
   from the handlers instead of 404 from Traefik.
3. **Dashboard cost queries are unbounded** (`dashboard.sql`, the cost
   aggregates over all `purchase_order_items` and `quotation_items`). Fine
   at today's volume, linear in history. Fix: bound by the requested
   period, or a monthly rollup.
4. **Exports build the whole workbook in memory** (`listq.Unbounded` then
   `[]byte`). Fix: excelize `StreamWriter` straight to the response.
5. **Invoice and PO list search has no trigram indexes** and ORs across
   joined tables. Fix when volume grows: per-table indexes and an
   `id IN (... UNION ...)` rewrite.
6. **No write rate limit on the storage proxy or per-user SSE cap.** Any
   writer can fill MinIO 20 MB at a time until `cmd/orphan-blobs` runs,
   which has no schedule. Fix: a per-user limit on PUT, and schedule the
   sweep.
7. **`db/checks/01_verify_advanced.sql` B.3** still checks a removed
   formula and reports correct invoices as wrong (manual target only).
8. **Product list thumbnails** presign per row and download the full
   photo for a 40 px avatar. Fix: the download path in the list DTO, then a
   thumbnail rendition.
9. **Lock notices reseed every wizard line** (`QuotationEdit.tsx`, the
   effect on the whole `detail`). Fix: key on `detail.items` and the header
   fields.

## Owner decisions (v0.33.0)

The owner delegated these; each follows the rule the code already holds.

- **Coretax bulk export keeps drafts.** The faktur is prepared and
  uploaded before the invoice and FP go to the client together, so a
  draft is exactly the invoice that needs one. Cancelled and non-PPN
  invoices stay out. The line-less skip never fires: `fn_create_invoice`
  and `fn_replace_invoice` refuse a PO with no billable line, and prod has
  none.
- **Tidak Ditawarkan by operational input** is refused on a line a head
  priced, since it would set harga jual to 0 and that role never changes a
  selling figure. An unpriced line and a restore stay allowed. Remembering
  the old price was rejected: it adds state that can drift from the line.
- **Invoice payment terms** follow the quotation: migration 00110 copies
  them onto each new invoice and sets its due date from a plain day count.
  An invoice without terms still prints the setting, and filed invoices
  keep what they printed.
- **Quotation export** follows the PDF breakdown: Total Produk, Diskon,
  Pengiriman, Sub Total, PPN, Nilai PPN, Grand Total.

## Still for the owner

- **The import tool's unit map** (`db/import/unit_map.py`) disagrees with
  the alias table (ea to UNIT, coil to RLS, pail to OTH). Aligning it
  changes what a re-import stores.
- **Purchase-side shipping** (a vendor's delivery charge) is not recorded
  anywhere.
