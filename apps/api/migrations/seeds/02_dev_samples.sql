-- ============================================================
-- SAMPLE TRANSACTIONS — end-to-end flow
-- Quotation Q-264128 → PO 8404/O-0079 → Invoice 077/INV-GNS
-- Berdasarkan data real di D:\quotation\data_existing\
-- Run after 02_seed_master.sql
-- ============================================================
-- Catatan: ini subset dari data asli (13 baris dari 117) supaya
-- mudah di-inspect. Bisa ditambahkan sesuai kebutuhan.
-- ============================================================

BEGIN;

-- ═══════════════════════════════════════════════════════════
-- QUOTATION Q-264128/GNS/IV/2026
-- Client: PT. IMC Ship Management, Vessel: MV YUXIN SATU
-- Ref client: 8404/V-0006/REQ26, date: 1 April 2026
-- ═══════════════════════════════════════════════════════════
INSERT INTO quotations (
  id, quotation_no, version, company_client_id, company_client_name,
  contact_id, contact_name, client_ref_no, vessel_name, status,
  payment_terms, validity_days, discount_pct,
  total_produk, total, total_discount,
  notes, created_by, updated_by
) VALUES (
  1, 'Q-264128/GNS/IV/2026', 1, 1, 'PT. IMC Ship Management',
  1, 'Bp. Restu Umar Singgih', '8404/V-0006/REQ26', 'MV YUXIN SATU', 'sent',
  '30 days', 3, 0.05,
  -- Subset 13 items; total_produk = total (karena no shipping line di subset ini)
  8141000, 8141000, 407050,
  'Subset 13 baris untuk demo. Original quotation punya 117 baris.',
  2, 2
);
SELECT setval('quotations_id_seq', 1, true);

-- Line items (line 1-3, 7-8, 12, 15-16, 25, 29-31 dari dokumen asli)
INSERT INTO quotation_items (
  quotation_id, line_number, item_type,
  requested_item_id, requested_impa, requested_name,
  offered_item_id, vendor_product_id,
  qty, unit_id, selling_price, cost_price,
  created_by, updated_by
) VALUES
  -- unit_id mapping: 19=SET, 21=PCS, 34=TIN, 35=TUB, 36=PKT
  -- Line 1: Punching tool set
  (1, 1, 'product', 1, NULL,
   'PUNCHING TOOL SET DIES & TABLE, 6-38MM 16S',
   1, 1, 1, 19, 2000000, 1200000, 2, 2),
  -- Line 2: Prusian Blue (10 tubes)
  (1, 2, 'product', 2, NULL,
   'BLUE PASTE 120GRM For lapping of bearings, high',
   2, 2, 10, 35, 145000, 90000, 2, 2),
  -- Line 3: Carborundum #2000
  (1, 3, 'product', 3, NULL,
   'CARBORUNDUM PASTE GRIT#2000, MICRO FINE 450GRM',
   3, 3, 1, 34, 68000, 40000, 2, 2),
  -- Line 4: Carborundum #1500
  (1, 4, 'product', 4, NULL,
   'CARBORUNDUM PASTE GRIT#1500, MICRO FINE 450GRM',
   4, 4, 1, 34, 68000, 40000, 2, 2),
  -- Line 5: Carborundum #800
  (1, 5, 'product', 5, NULL,
   'CARBORUNDUM PASTE GRIT#800, MICRO FINE 450GRM',
   5, 5, 1, 34, 68000, 40000, 2, 2),
  -- Line 6: Puller 8"
  (1, 6, 'product', 6, NULL,
   'PULLER GEAR & WHEEL 3-ARM, 0-200MM Drop forged',
   6, 6, 1, 19, 750000, 450000, 2, 2),
  -- Line 7: Puller 6"
  (1, 7, 'product', 7, NULL,
   'PULLER GEAR & WHEEL 3-ARM, 0-125MM Drop forged',
   7, 7, 1, 19, 445000, 270000, 2, 2),
  -- Line 8: Rivet 3.2x8.0
  (1, 8, 'product', 8, NULL,
   'RIVET BLIND OPENTYPE ALUM-BODY, STEEL-MANDREL 3.2X8.0MM',
   8, 8, 1, 36, 185000, 110000, 2, 2),
  -- Line 9: Rivet 3.2x6.3
  (1, 9, 'product', 9, NULL,
   'RIVET BLIND OPENTYPE ALUM-BODY, STEEL-MANDREL 3.2X6.3MM',
   9, 9, 1, 36, 215000, 130000, 2, 2),
  -- Line 10: Wrench hook
  (1, 10, 'product', 10, NULL,
   'WRENCH HOOK SPANNER 68-75MM, STAINLESS STEEL',
   10, 10, 3, 21, 535000, 320000, 2, 2),
  -- Line 11: LED 12W
  (1, 11, 'product', 11, '790268',
   'LAMP LED 12W (100W) 220V E-27, COOL WHITE',
   11, 11, 50, 21, 48000, 28000, 2, 2),
  -- Line 12: LED 8W
  (1, 12, 'product', 12, '790265',
   'LAMP LED 8W (60W) 220V E-27, COOL WHITE',
   12, 12, 50, 21, 50000, 30000, 2, 2),
  -- Line 13: Floodlight
  (1, 13, 'product', 13, '791836',
   'FLOODLIGHT FIXTURE LED SLD-150',
   13, 13, 10, 19, 450000, 270000, 2, 2);

-- ═══════════════════════════════════════════════════════════
-- PURCHASE ORDER 8404/O-0079/P025
-- Issued by: PT. IMC Ship Management (via Pak Restu)
-- Berdasarkan quotation Q-264128 — client accept & order
-- ═══════════════════════════════════════════════════════════
INSERT INTO purchase_orders (
  id, po_number, quotation_id, company_client_id, contact_id,
  po_date, status, delivery_note_number, notes,
  created_by, updated_by
) VALUES (
  1, 'PO-264129/GNS/IV/2026', 1, 1, 1,
  '2026-04-05', 'DELIVERED', 'DN-264131/GNS/IV/2026',
  'Original PO Ref: 8404/O-0079/P025. Delivery ke MV YUXIN SATU.',
  2, 2
);
SELECT setval('purchase_orders_id_seq', 1, true);

-- PO items (subset sama dengan quotation, qty same)
-- Line 1-4 dari LED & floodlight yang paling value
INSERT INTO purchase_order_items (
  po_id, quotation_item_id, line_number, item_type, offered_item_id,
  qty, unit_id, selling_price, cost_price, created_by, updated_by
) VALUES
  (1, 11, 1, 'product', 11, 50, 21, 48000, 28000, 2, 2),
  (1, 12, 2, 'product', 12, 50, 21, 50000, 30000, 2, 2),
  (1, 13, 3, 'product', 13, 10, 19, 450000, 270000, 2, 2),
  (1, 1,  4, 'product', 1,  1,  19, 2000000, 1200000, 2, 2);

-- ═══════════════════════════════════════════════════════════
-- INVOICE 077/INV-GNS-8/2025
-- Billed to: PT. Yuxin Shipping Line (NPWP 0618956270022000)
-- NOTE: Invoice billed ke entity BEDA (Yuxin), PO issued by IMC!
-- Faktur Pajak Coretax: 04002500242787250
-- Tax code 04 = DPP Nilai Lain
-- ═══════════════════════════════════════════════════════════
INSERT INTO invoices (
  id, invoice_no, quotation_id, po_id, company_client_id,
  invoice_date, due_date, subtotal, dpp,
  ppn_rate, tax_transaction_code, faktur_type, status,
  created_by, updated_by
) VALUES (
  1, '077/INV-GNS-8/2025', 1, 1, 2,  -- company_client_id=2 = Yuxin (bukan IMC!)
  '2025-08-07', '2025-09-06',
  7744000,   -- subtotal = total after 5% discount
  7744000,   -- dpp = base for tax
  12.00, '04', 'Normal', 'paid',
  3, 3
);
SELECT setval('invoices_id_seq', 1, true);

-- Invoice items (snapshot dari PO items, untuk 4 line yang di-invoice)
INSERT INTO invoice_items (
  invoice_id, quotation_item_id, line_type,
  item_name, item_code, goods_or_service, unit_code,
  qty, unit_price, dpp, dpp_nilai_lain, ppn_rate, ppn_amount,
  created_by, updated_by
) VALUES
  (1, 11, 'product', 'LAMP LED 12W (100W) 220V E-27, COOL WHITE',
   '790268', 'B', 'PCE', 50, 48000,
   2280000, 2090000, 12.00, 250800, 3, 3),
  (1, 12, 'product', 'LAMP LED 8W (60W) 220V E-27, COOL WHITE',
   '790265', 'B', 'PCE', 50, 50000,
   2375000, 2177083, 12.00, 261250, 3, 3),
  (1, 13, 'product', 'FLOODLIGHT FIXTURE LED SLD-150',
   '791836', 'B', 'SET', 10, 450000,
   4275000, 3918750, 12.00, 470250, 3, 3),
  (1, 1,  'product', 'PUNCHING TOOL SET DIES & TABLE, 6-38MM 16S',
   NULL,   'B', 'SET', 1,  2000000,
   1900000, 1741667, 12.00, 209000, 3, 3);

-- ═══════════════════════════════════════════════════════════
-- ITEM REQUEST MATCHES (learning entries untuk auto-suggest)
-- ═══════════════════════════════════════════════════════════
INSERT INTO item_request_matches (request_text, matched_item_id, match_count) VALUES
  ('PUNCHING TOOL SET DIES & TABLE, 6-38MM 16S', 1, 3),
  ('LAMP LED 12W (100W) 220V E-27', 11, 5),
  ('LAMP LED 8W (60W) 220V E-27', 12, 5),
  ('CARBORUNDUM PASTE MICRO FINE 450GRM', 3, 2);

COMMIT;

-- ─── VERIFY RESULTS ───────────────────────────────────────
-- Test GENERATED columns:
-- SELECT quotation_no, total, total_discount, subtotal, dpp_nilai_lain, ppn_amount, grand_total
--   FROM quotations WHERE id = 1;
-- Expected:
--   total=8141000, discount=407050, subtotal=7733950,
--   dpp_nilai_lain=~7089037, ppn_amount=~850684, grand_total=~8583755

-- Test per-item GENERATED:
-- SELECT line_number, qty, selling_price, total_selling, discount_amount, subtotal, profit_amount, profit_pct
--   FROM quotation_items WHERE quotation_id = 1 ORDER BY line_number;

-- Test reconciliation view:
-- SELECT * FROM quotation_reconciliation;
-- diff harus = 0 (kecil toleransi rounding)
