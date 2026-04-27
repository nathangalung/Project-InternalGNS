-- ADVANCED VERIFICATION QUERIES — GNS Quotation DB
-- Run per section (paste into psql / pgAdmin)
-- 8 categories:
-- A. Schema Introspection (struktur DB)
-- B. Business Logic Cross-Check (GENERATED columns akurat?)
-- C. Negative Tests (verify constraints enforce — expect ERROR)
-- D. Snapshot Drift Detection
-- E. Reconciliation (header vs items, tax math)
-- F. Data Quality Audit
-- G. Performance & Index Usage
-- H. Real-World Reporting Queries


-- A. SCHEMA INTROSPECTION

-- A.1 All tables + row count + size
SELECT
  schemaname AS schema,
  relname AS table_name,
  n_live_tup AS rows,
  pg_size_pretty(pg_total_relation_size(relid)) AS total_size,
  pg_size_pretty(pg_relation_size(relid)) AS table_size,
  pg_size_pretty(pg_indexes_size(relid)) AS index_size
FROM pg_stat_user_tables
ORDER BY n_live_tup DESC;

-- A.2 All FKs + delete behavior
SELECT
  tc.table_name AS child_table,
  kcu.column_name AS child_column,
  ccu.table_name AS parent_table,
  ccu.column_name AS parent_column,
  rc.delete_rule AS on_delete,
  rc.update_rule AS on_update
FROM information_schema.table_constraints tc
  JOIN information_schema.key_column_usage kcu
    ON tc.constraint_name = kcu.constraint_name
  JOIN information_schema.referential_constraints rc
    ON tc.constraint_name = rc.constraint_name
  JOIN information_schema.constraint_column_usage ccu
    ON rc.unique_constraint_name = ccu.constraint_name
WHERE tc.constraint_type = 'FOREIGN KEY'
  AND tc.table_schema = 'public'
ORDER BY tc.table_name, kcu.column_name;

-- A.3 All CHECK constraints (enum + range)
SELECT
  conrelid::regclass AS table_name,
  conname AS constraint_name,
  pg_get_constraintdef(oid) AS definition
FROM pg_constraint
WHERE contype = 'c'
  AND connamespace = 'public'::regnamespace
ORDER BY conrelid::regclass::text, conname;

-- A.4 All GENERATED columns (expect ~15 rows)
SELECT
  table_name,
  column_name,
  data_type,
  generation_expression
FROM information_schema.columns
WHERE table_schema = 'public'
  AND is_generated = 'ALWAYS'
ORDER BY table_name, ordinal_position;

-- A.5 All triggers (row_version + updated_at)
SELECT
  event_object_table AS table_name,
  trigger_name,
  action_timing || ' ' || event_manipulation AS event,
  action_statement
FROM information_schema.triggers
WHERE trigger_schema = 'public'
ORDER BY event_object_table;

-- A.6 All indexes grouped by table
SELECT
  tablename,
  indexname,
  indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;


-- B. BUSINESS LOGIC CROSS-CHECK
-- (Compute manually in SQL, compare with GENERATED)

-- B.1 Verify quotation_items GENERATED columns (per row)
SELECT
  line_number,
  qty, selling_price, cost_price, item_type,
  total_selling,
  (qty * selling_price) AS expected_total_selling,
  total_selling - (qty * selling_price) AS diff_total_selling,   -- must be 0

  discount_amount,
  CASE WHEN item_type = 'product' THEN qty * selling_price * 0.05 ELSE 0 END AS expected_discount,
  discount_amount - CASE WHEN item_type = 'product' THEN qty * selling_price * 0.05 ELSE 0 END AS diff_discount,

  subtotal,
  qty * selling_price * CASE WHEN item_type = 'product' THEN 0.95 ELSE 1 END AS expected_subtotal,
  profit_pct,
  ROUND((selling_price - cost_price) / NULLIF(cost_price, 0), 4) AS expected_profit_pct
FROM quotation_items
WHERE quotation_id = 1
ORDER BY line_number;

-- B.2 Verify quotation header GENERATED vs manual formula
SELECT
  quotation_no,
  total, total_discount,
  subtotal AS db_subtotal,
  (total - total_discount) AS expected_subtotal,
  dpp_nilai_lain AS db_dpp,
  ROUND((total - total_discount) * 11.0 / 12.0, 2) AS expected_dpp,
  grand_total AS db_grand,
  ROUND((total - total_discount) * 11.0 / 12.0 * 1.12, 2) AS expected_grand,
  grand_total - (dpp_nilai_lain + ppn_amount) AS diff_grand_vs_dpp_plus_ppn  -- must be 0 (rounding tolerance)
FROM quotations;

-- B.3 Verify invoice tax calculation
SELECT
  invoice_no, dpp, ppn_rate,
  dpp_nilai_lain,
  ROUND(dpp * 11.0 / 12.0, 2) AS expected_dpp_nl,
  ppn_amount,
  ROUND(dpp * 11.0 / 12.0 * 0.12, 2) AS expected_ppn,
  total,
  ROUND(dpp * 11.0 / 12.0 * 1.12, 2) AS expected_total
FROM invoices;


-- C. NEGATIVE TESTS (paste one at a time — expect ERROR)
-- Use BEGIN...ROLLBACK to avoid corrupting data

-- C.1 Invalid status enum
BEGIN;
INSERT INTO quotations (quotation_no, version, company_client_id, company_client_name, status, total, total_discount, created_by)
VALUES ('Q-TEST/GNS/IV/2026', 1, 1, 'Test', 'INVALID', 100, 0, 1);
-- EXPECTED: ERROR - check constraint "quotations_status_check" violated
ROLLBACK;

-- C.2 Invalid ppn_rate (must = 12.00)
BEGIN;
INSERT INTO invoices (invoice_no, quotation_id, company_client_id, invoice_date, dpp, ppn_rate, status, created_by)
VALUES ('INV-TEST', 1, 2, CURRENT_DATE, 1000000, 11.00, 'draft', 3);
-- EXPECTED: ERROR - ppn_rate must be 12.00
ROLLBACK;

-- C.3 Negative qty
BEGIN;
INSERT INTO quotation_items (quotation_id, line_number, item_type, requested_name, qty, selling_price, created_by)
VALUES (1, 99, 'product', 'Test', -5, 1000, 1);
-- EXPECTED: ERROR - qty must be >= 0
ROLLBACK;

-- C.4 Duplicate quotation_no (UNIQUE)
BEGIN;
INSERT INTO quotations (quotation_no, version, company_client_id, company_client_name, status, total, total_discount, created_by)
VALUES ('Q-264128/GNS/IV/2026', 1, 1, 'Dup', 'draft', 100, 0, 1);
-- EXPECTED: ERROR - duplicate key on quotation_no
ROLLBACK;

-- C.5 Duplicate (quotation_id, line_number)
BEGIN;
INSERT INTO quotation_items (quotation_id, line_number, item_type, requested_name, qty, selling_price, created_by)
VALUES (1, 1, 'product', 'Dup line', 1, 1000, 1);
-- EXPECTED: ERROR - UNIQUE (quotation_id, line_number) violated
ROLLBACK;

-- C.6 RESTRICT on DELETE company_client (referenced by quotation)
BEGIN;
DELETE FROM company_client WHERE id = 1;
-- EXPECTED: ERROR - update or delete violates foreign key constraint (quotations references company_client_id)
ROLLBACK;

-- C.7 CASCADE on DELETE quotation (items should be deleted too)
BEGIN;
DELETE FROM quotations WHERE id = 1;
-- Will ERROR if a PO references it (RESTRICT) — expected behavior
-- To test cascade: delete PO/invoice first in a draft DB
ROLLBACK;

-- C.8 ON DELETE SET NULL (delete contact → quotation.contact_id becomes NULL)
BEGIN;
DELETE FROM company_contacts WHERE id = 1;
SELECT id, contact_id FROM quotations WHERE id = 1;
-- EXPECTED: contact_id = NULL (bukan error)
ROLLBACK;


-- D. SNAPSHOT DRIFT DETECTION
-- Check if snapshot fields still match master (should match
-- for new data; drift expected for historical data)

-- D.1 Quotation snapshot name vs master
SELECT
  q.id, q.quotation_no,
  q.company_client_name AS snapshot,
  cc.name AS current_master,
  CASE WHEN q.company_client_name = cc.name THEN 'MATCH' ELSE 'DRIFT' END AS status
FROM quotations q
JOIN company_client cc ON cc.id = q.company_client_id;

-- D.2 Invoice item snapshot vs current master
SELECT
  ii.id, ii.item_name AS snapshot_name, ii.item_code AS snapshot_impa,
  i.name AS current_master_name, i.impa_code AS current_master_impa,
  CASE WHEN ii.item_name = i.name THEN 'MATCH' ELSE 'DRIFT' END AS name_status
FROM invoice_items ii
LEFT JOIN quotation_items qi ON qi.id = ii.quotation_item_id
LEFT JOIN items i ON i.id = qi.offered_item_id;


-- E. RECONCILIATION (header totals vs SUM items)

-- E.1 Quotation reconciliation
SELECT * FROM quotation_reconciliation;

-- E.2 Deep reconciliation — per category (product vs shipping)
SELECT
  q.id, q.quotation_no,
  q.total_produk AS header_total_produk,
  SUM(CASE WHEN qi.item_type = 'product' THEN qi.total_selling ELSE 0 END) AS actual_total_produk,
  q.total AS header_total,
  SUM(qi.total_selling) AS actual_total_all,
  q.total_discount AS header_discount,
  SUM(qi.discount_amount) AS actual_discount
FROM quotations q
JOIN quotation_items qi ON qi.quotation_id = q.id
GROUP BY q.id, q.quotation_no, q.total_produk, q.total, q.total_discount;

-- E.3 Invoice vs PO items vs Quotation items lineage check
SELECT
  inv.invoice_no,
  po.po_number,
  q.quotation_no,
  (SELECT SUM(total_selling) FROM quotation_items WHERE quotation_id = q.id) AS quote_total,
  (SELECT SUM(total_selling) FROM purchase_order_items WHERE po_id = po.id) AS po_total,
  (SELECT SUM(qty * unit_price) FROM invoice_items WHERE invoice_id = inv.id) AS invoice_total_before_discount
FROM invoices inv
JOIN purchase_orders po ON po.id = inv.po_id
JOIN quotations q ON q.id = inv.quotation_id;


-- F. DATA QUALITY AUDIT

-- F.1 Orphan snapshot — quotations with valid FK to company?
SELECT q.id, q.quotation_no
FROM quotations q
LEFT JOIN company_client cc ON cc.id = q.company_client_id
WHERE cc.id IS NULL;
-- Should return 0 rows (FK enforced)

-- F.2 Quotations without items (empty draft?)
SELECT q.id, q.quotation_no, q.status
FROM quotations q
LEFT JOIN quotation_items qi ON qi.quotation_id = q.id
WHERE qi.id IS NULL;

-- F.3 Accepted quotations without PO (pending conversion)
SELECT q.id, q.quotation_no, q.status, q.created_at
FROM quotations q
LEFT JOIN purchase_orders po ON po.quotation_id = q.id
WHERE q.status = 'accepted' AND po.id IS NULL;

-- F.4 PO DELIVERED without invoice (pending billing)
SELECT po.id, po.po_number, po.status, po.po_date
FROM purchase_orders po
LEFT JOIN invoices inv ON inv.po_id = po.id
WHERE po.status = 'DELIVERED' AND inv.id IS NULL;

-- F.5 Items without vendor_product (cannot be sourced)
SELECT i.id, i.name, i.impa_code
FROM items i
LEFT JOIN vendor_products vp ON vp.item_id = i.id AND vp.is_active
WHERE vp.id IS NULL AND i.is_active
ORDER BY i.name;

-- F.6 Active vendor_products with inactive vendor or item
SELECT vp.id, v.name AS vendor, v.is_active AS vendor_active,
       i.name AS item, i.is_active AS item_active
FROM vendor_products vp
JOIN vendors v ON v.id = vp.vendor_id
JOIN items i ON i.id = vp.item_id
WHERE vp.is_active AND (NOT v.is_active OR NOT i.is_active);

-- F.7 Snapshot fields that should not be NULL
SELECT id, quotation_no FROM quotations WHERE company_client_name IS NULL OR company_client_name = '';
SELECT id, line_number FROM quotation_items WHERE requested_name IS NULL OR requested_name = '';
SELECT id FROM invoice_items WHERE item_name IS NULL OR item_name = '';


-- G. PERFORMANCE & INDEX USAGE

-- G.1 Index usage stats (identify unused indexes)
SELECT
  schemaname, relname AS table,
  indexrelname AS index,
  idx_scan AS scans,
  idx_tup_read AS tuples_read,
  pg_size_pretty(pg_relation_size(indexrelid)) AS size
FROM pg_stat_user_indexes
WHERE schemaname = 'public'
ORDER BY idx_scan DESC;
-- idx_scan = 0 → index never used (with traffic, candidate for drop)

-- G.2 Cache hit ratio (target > 99%)
SELECT
  relname,
  heap_blks_read, heap_blks_hit,
  ROUND(heap_blks_hit::NUMERIC / NULLIF(heap_blks_hit + heap_blks_read, 0) * 100, 2) AS cache_hit_pct
FROM pg_statio_user_tables
WHERE heap_blks_read + heap_blks_hit > 0
ORDER BY cache_hit_pct;

-- G.3 Fuzzy search via pg_trgm (test GIN index usage)
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, name, similarity(name, 'LAMP LED 100W COOL WHITE') AS score
FROM items
WHERE name % 'LAMP LED 100W COOL WHITE'
ORDER BY score DESC
LIMIT 5;
-- Check Planning + Execution Time. Should use "Bitmap Index Scan on idx_items_name_trgm"

-- G.4 Slow query for status filter (check idx_quotations_status_created)
EXPLAIN (ANALYZE)
SELECT id, quotation_no, company_client_name, grand_total
FROM quotations
WHERE status = 'sent'
ORDER BY created_at DESC
LIMIT 20;
-- Should use "Index Scan using idx_quotations_status_created"


-- H. REAL-WORLD REPORTING QUERIES

-- H.1 Top clients by revenue (grand_total)
SELECT
  cc.name AS client,
  COUNT(DISTINCT q.id) AS quotation_count,
  COUNT(DISTINCT po.id) AS po_count,
  COUNT(DISTINCT inv.id) AS invoice_count,
  COALESCE(SUM(inv.total), 0) AS total_invoiced,
  COALESCE(SUM(CASE WHEN inv.status = 'paid' THEN inv.total ELSE 0 END), 0) AS total_paid
FROM company_client cc
LEFT JOIN quotations q ON q.company_client_id = cc.id
LEFT JOIN purchase_orders po ON po.company_client_id = cc.id
LEFT JOIN invoices inv ON inv.company_client_id = cc.id
GROUP BY cc.id, cc.name
ORDER BY total_invoiced DESC;

-- H.2 Profit margin analysis per quotation
SELECT
  q.quotation_no,
  q.company_client_name,
  SUM(qi.total_selling) AS revenue,
  SUM(qi.total_cost) AS cost,
  SUM(qi.profit_amount) AS profit,
  ROUND(AVG(qi.profit_pct) * 100, 2) AS avg_profit_pct,
  ROUND(SUM(qi.profit_amount) / NULLIF(SUM(qi.total_cost), 0) * 100, 2) AS weighted_profit_pct
FROM quotations q
JOIN quotation_items qi ON qi.quotation_id = q.id
WHERE qi.item_type = 'product'
GROUP BY q.id, q.quotation_no, q.company_client_name
ORDER BY profit DESC;

-- H.3 Top-selling items + profit
SELECT
  i.name,
  i.impa_code,
  SUM(qi.qty) AS total_qty_sold,
  COUNT(DISTINCT qi.quotation_id) AS appeared_in_n_quotes,
  ROUND(AVG(qi.selling_price), 2) AS avg_price,
  ROUND(AVG(qi.profit_pct) * 100, 2) AS avg_margin_pct
FROM items i
JOIN quotation_items qi ON qi.offered_item_id = i.id
WHERE qi.is_available
GROUP BY i.id, i.name, i.impa_code
ORDER BY total_qty_sold DESC
LIMIT 20;

-- H.4 Low-margin items (flagging)
SELECT
  q.quotation_no, qi.line_number,
  qi.requested_name, qi.selling_price, qi.cost_price,
  ROUND(qi.profit_pct * 100, 2) AS margin_pct
FROM quotation_items qi
JOIN quotations q ON q.id = qi.quotation_id
WHERE qi.profit_pct < 0.15  -- margin < 15%
  AND qi.is_available
  AND qi.item_type = 'product'
ORDER BY qi.profit_pct ASC;

-- H.5 Invoice aging (overdue analysis)
SELECT
  invoice_no,
  company_client_id,
  invoice_date, due_date,
  CURRENT_DATE - due_date AS days_overdue,
  total,
  status,
  CASE
    WHEN status = 'paid' THEN 'PAID'
    WHEN CURRENT_DATE <= due_date THEN 'ON_TIME'
    WHEN CURRENT_DATE - due_date <= 30 THEN '1-30_DAYS'
    WHEN CURRENT_DATE - due_date <= 60 THEN '31-60_DAYS'
    WHEN CURRENT_DATE - due_date <= 90 THEN '61-90_DAYS'
    ELSE 'OVER_90_DAYS'
  END AS aging_bucket
FROM invoices
ORDER BY days_overdue DESC NULLS LAST;

-- H.6 Vendor performance — revenue from each vendor
SELECT
  v.name AS vendor,
  COUNT(DISTINCT qi.quotation_id) AS used_in_quotes,
  SUM(qi.qty) AS total_units_sold,
  SUM(qi.total_cost) AS total_cost_from_vendor,
  SUM(qi.profit_amount) AS gross_profit_generated
FROM vendors v
JOIN vendor_products vp ON vp.vendor_id = v.id
JOIN quotation_items qi ON qi.vendor_product_id = vp.id
GROUP BY v.id, v.name
ORDER BY gross_profit_generated DESC;

-- H.7 Running number usage — check gaps in sequence
WITH parsed AS (
  SELECT
    id, quotation_no,
    -- Extract running seq: Q-{YY}{company_code}{SEQ}/GNS/...
    SUBSTRING(quotation_no FROM 'Q-\d{2}\d{4}(\d+)/GNS') AS seq_str
  FROM quotations
)
SELECT seq_str, COUNT(*), STRING_AGG(quotation_no, ', ')
FROM parsed
WHERE seq_str IS NOT NULL
GROUP BY seq_str
HAVING COUNT(*) > 1;  -- Detect duplicate sequence (shouldn't happen with UNIQUE)

-- H.8 Learning table — most frequent request matches
SELECT
  request_text,
  i.name AS matched_item,
  match_count,
  last_used_at
FROM item_request_matches irm
LEFT JOIN items i ON i.id = irm.matched_item_id
ORDER BY match_count DESC
LIMIT 20;

-- H.9 Concurrency lock behavior — simulate row_version check
BEGIN;
-- Read row_version
SELECT row_version FROM quotations WHERE id = 1;
-- Simulate stale update (WHERE row_version = actual-1)
UPDATE quotations SET notes = 'stale_write' WHERE id = 1 AND row_version = 0;  -- replace 0 with value smaller than actual
-- Expected: 0 rows affected = conflict detected
ROLLBACK;

-- Actual valid update path:
BEGIN;
SELECT id, row_version FROM quotations WHERE id = 1;
-- E.g. row_version = 1, use that value:
UPDATE quotations SET notes = 'fresh_write'
WHERE id = 1 AND row_version = 1;  -- REPLACE with actual row_version
-- Expected: 1 row affected, row_version auto-increments to 2 via trigger
SELECT row_version FROM quotations WHERE id = 1;
ROLLBACK;


-- CLEANUP: Reset sample data if needed
-- TRUNCATE invoice_items, invoices, purchase_order_items, purchase_orders,
-- quotation_items, quotations, item_request_matches
-- RESTART IDENTITY CASCADE;
-- (master data stays — only transactions are reset)
