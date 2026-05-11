-- Extra quotations beyond 03_historical.sql, sourced directly from
-- invoice_and_do/ files where the customer issued a PO without a matching
-- quotation in the historical Excel import.
--
-- Both are PT Karunia Aman Sentosa (id=4):
--   Q-668: file 016 - single Relay Schneider RXM4AB2P7
--   Q-669: file 025+026 - ComAp Inteli Nano Module 22-item bundle
--
-- Runs after 03_historical.sql (filename ordering) so the explicit IDs land
-- right after MAX(id)=667. 04_demo_po_invoice.sql skips these (status='accepted'),
-- and 05_real_purchase_orders.sql INSERTs their POs because no auto-PO exists.

BEGIN;

INSERT INTO quotations (
  id, quotation_no, version, parent_id, company_client_id, company_client_name,
  contact_id, contact_name, client_ref_no, vessel_name, status,
  payment_terms, discount_pct,
  total_produk, total, total_discount,
  notes, created_at, created_by, updated_by
) VALUES
  (668, 'Q-2640048/GNS/I/2026', 1, NULL, 4, 'PT. Karunia Aman Sentosa',
   NULL, NULL, NULL, NULL, 'accepted',
   '30 days', 0,
   375000.00, 375000.00, 0.00,
   'Reverse-engineered from invoice 016/INV-GNS/I/2026 (no historical Excel quote)',
   ((TIMESTAMP '2026-01-10 10:00:00') AT TIME ZONE 'Asia/Jakarta'), 1, 1),
  (669, 'Q-2640050/GNS/II/2026', 1, NULL, 4, 'PT. Karunia Aman Sentosa',
   NULL, NULL, NULL, NULL, 'accepted',
   '30 days', 0,
   24522000.00, 24522000.00, 0.00,
   'Reverse-engineered from invoice 025+026/INV-GNS/II/2026 ComAp panel bundle',
   ((TIMESTAMP '2026-01-30 10:00:00') AT TIME ZONE 'Asia/Jakarta'), 1, 1);

INSERT INTO quotation_items (
  quotation_id, line_number, item_type,
  requested_item_id, requested_impa, requested_name,
  offered_item_id, vendor_product_id,
  qty, unit_id, selling_price, cost_price, discount_pct,
  update_vendor_price, created_by, updated_by
) VALUES
  -- Q-668: single Relay Schneider RXM4AB2P7 (PCS=21)
  (668, 1, 'product', NULL, NULL,
   'Relay Schneider RXM4AB2P7 230VAC, 50/60 Hz, 6 A, 14 Pin/Kaki',
   NULL, NULL, 3, 21, 125000.00, NULL, 0.00, FALSE, 1, 1),

  -- Q-669: ComAp panel bundle, 22 lines (units: UNIT=18, BOX=22, PCS=21, RLS=39, PKT=36)
  (669, 1,  'product', NULL, NULL, 'ComAp Inteli Nano Module',                                                    NULL, NULL, 2,  18, 3875000.00, NULL, 0.00, FALSE, 1, 1),
  (669, 2,  'product', NULL, NULL, 'Box Panel 40x35x18 cm',                                                       NULL, NULL, 2,  22,  540000.00, NULL, 0.00, FALSE, 1, 1),
  (669, 3,  'product', NULL, NULL, 'GAE Fuse 10x38 2A 500V + Holder Fuse With Indicator',                          NULL, NULL, 2,  21,   70000.00, NULL, 0.00, FALSE, 1, 1),
  (669, 4,  'product', NULL, NULL, 'GAE Fuse 10x38 32A 500V + Holder Fuse With Indicator',                         NULL, NULL, 6,  21,   70000.00, NULL, 0.00, FALSE, 1, 1),
  (669, 5,  'product', NULL, NULL, 'Schneider MCB DOMAE 3 PHASE 6A',                                               NULL, NULL, 2,  21,  500000.00, NULL, 0.00, FALSE, 1, 1),
  (669, 6,  'product', NULL, NULL, 'Relay Flosser 24V 20/30a Kaki 5 Relay Pemutus 87a+Socket Relay Keramik',       NULL, NULL, 6,  21,  230000.00, NULL, 0.00, FALSE, 1, 1),
  (669, 7,  'product', NULL, NULL, 'Fort Box Push Button & Emergency Stop 22mm 1inch + Contact Block 1NO',         NULL, NULL, 2,  21,  120000.00, NULL, 0.00, FALSE, 1, 1),
  (669, 8,  'product', NULL, NULL, 'Pilot Lamp XB5-AV/XB5AV 220VAC 24 VDC Shemsco Schneider - Hijau, 220 VAC',     NULL, NULL, 2,  21,   80000.00, NULL, 0.00, FALSE, 1, 1),
  (669, 9,  'product', NULL, NULL, 'EWIG PILOT LAMP BUZZER LED 22 mm, DC 24V, Merah',                              NULL, NULL, 2,  21,   70000.00, NULL, 0.00, FALSE, 1, 1),
  (669, 10, 'product', NULL, NULL, 'Schneider Selector Switch 3 Posisi XB2 Metal 2 No 22mm-XB2BD53C',              NULL, NULL, 2,  21,  250000.00, NULL, 0.00, FALSE, 1, 1),
  (669, 11, 'product', NULL, NULL, 'DIN Rail MCB Alumunium 1 Meter',                                               NULL, NULL, 4,  21,   30000.00, NULL, 0.00, FALSE, 1, 1),
  (669, 12, 'product', NULL, NULL, 'PM Kabel Duck Lubang Abu-Abu 45X32 1,7 Meter',                                 NULL, NULL, 4,  21,   65000.00, NULL, 0.00, FALSE, 1, 1),
  (669, 13, 'product', NULL, NULL, 'NYAF 0.75 mm2 100meter - Kabel Metal Indonesia Listrik Serabut - Hitam',       NULL, NULL, 2,  39,  385000.00, NULL, 0.00, FALSE, 1, 1),
  (669, 14, 'product', NULL, NULL, 'NYAF 4 mm2 100meter - Kabel Metal Indonesia Listrik Serabut - Hitam',          NULL, NULL, 2,  39, 1950000.00, NULL, 0.00, FALSE, 1, 1),
  (669, 15, 'product', NULL, NULL, 'Kabel Super NYAF 2.5mm 100meter SNI - Hitam',                                  NULL, NULL, 4,  39, 1200000.00, NULL, 0.00, FALSE, 1, 1),
  (669, 16, 'product', NULL, NULL, 'Skun Kabel Tusuk Ferulles Ferrules 0.75mm E7508',                              NULL, NULL, 4,  36,   20000.00, NULL, 0.00, FALSE, 1, 1),
  (669, 17, 'product', NULL, NULL, 'Skun Kabel Tusuk Ferulles Ferrules 2.5mm E2508',                               NULL, NULL, 2,  36,   30000.00, NULL, 0.00, FALSE, 1, 1),
  (669, 18, 'product', NULL, NULL, 'Phoenix Contact UK 5 N Terminal Block (0,5 - 6mm kabel)',                      NULL, NULL, 60, 21,   15000.00, NULL, 0.00, FALSE, 1, 1),
  (669, 19, 'product', NULL, NULL, 'Kabel Ties 2.5x100mm Hitam (100 pcs)',                                         NULL, NULL, 4,  36,   10000.00, NULL, 0.00, FALSE, 1, 1),
  (669, 20, 'product', NULL, NULL, 'Cylinder Current Transformer 100/5A CT Bulat RCT-35 TAB 100% Original',        NULL, NULL, 6,  21,   75000.00, NULL, 0.00, FALSE, 1, 1),
  (669, 21, 'product', NULL, NULL, 'Baut L Stainles M5X12',                                                        NULL, NULL, 40, 21,    5100.00, NULL, 0.00, FALSE, 1, 1),
  (669, 22, 'product', NULL, NULL, 'Kabel Gland PG36 Hitam',                                                       NULL, NULL, 4,  21,   32000.00, NULL, 0.00, FALSE, 1, 1);

-- Realign sequences so future API inserts don't collide with hand-set ids.
SELECT setval('quotations_id_seq',      (SELECT MAX(id) FROM quotations));
SELECT setval('quotation_items_id_seq', (SELECT MAX(id) FROM quotation_items));

-- Backfill quotation_item_requests for these reverse-engineered lines, mirroring
-- the historical pattern (1 qir row per qi row, qir.id = qi.id). Lock trigger
-- blocks INSERT for non-draft parents — disable for the seed-time write, then
-- re-enable. DDL stays inside the txn, so rollback would revert the disable too.
ALTER TABLE quotation_item_requests DISABLE TRIGGER trg_qir_lock_parent;

INSERT INTO quotation_item_requests (
  id, quotation_id, line_no, request_text, request_impa, requested_qty, requested_uom,
  matched_item_id, match_status, source_type, notes,
  reviewed_by, reviewed_at, created_by, updated_by
)
SELECT qi.id, qi.quotation_id, qi.line_number, qi.requested_name, qi.requested_impa,
       qi.qty, NULL, qi.offered_item_id, 'matched', 'import',
       'Backfilled from 03b reverse-engineered quotation',
       1, NOW(), 1, 1
  FROM quotation_items qi
 WHERE qi.quotation_id IN (668, 669);

SELECT setval('quotation_item_requests_id_seq', (SELECT MAX(id) FROM quotation_item_requests));

UPDATE quotation_items SET request_id = id WHERE quotation_id IN (668, 669);

ALTER TABLE quotation_item_requests ENABLE TRIGGER trg_qir_lock_parent;

-- Also append status_history rows so the 'accepted' state has audit trail
INSERT INTO quotation_status_history (quotation_id, from_status, to_status, note, changed_by)
VALUES
  (668, 'sent', 'accepted', 'Customer issued PO JKT-PO/005.005/OFFICE/0126',         1),
  (669, 'sent', 'accepted', 'Customer issued PO JKT-PO/022.038/M/12/0226',           1);

COMMIT;
