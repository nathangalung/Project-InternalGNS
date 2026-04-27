-- DEV SAMPLES — sample users, catalog, transactional data
-- DEV ONLY. Run after 01_master.sql.
-- Idempotent: resets sample tables; preserves superadmin (users.id=1).
-- Source: real quotation Q-264128 + PO 8404/O-0079 + invoice 077/INV-GNS.

BEGIN;

-- RESET sample tables FIRST (releases user FK refs from quotations etc.)
TRUNCATE TABLE
  invoice_items,
  invoices,
  purchase_order_items,
  purchase_orders,
  quotation_status_history,
  quotation_items,
  quotations,
  item_request_matches,
  vendor_products,
  items,
  company_contacts,
  company_client,
  vendors
RESTART IDENTITY CASCADE;

-- SAMPLE USERS (preserve superadmin id=1)
DELETE FROM users WHERE id <> 1;

-- Operational user. Password = bcrypt("changeme").
INSERT INTO users (id, email, name, password_hash, role, is_active, created_by, updated_by)
VALUES (2, 'ops@globalsakti.com', 'Staff Operasional',
        '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
        'operational', TRUE, 1, 1)
ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email, name = EXCLUDED.name, role = EXCLUDED.role;

-- Finance user. Password = bcrypt("changeme").
INSERT INTO users (id, email, name, password_hash, role, is_active, created_by, updated_by)
VALUES (3, 'finance@globalsakti.com', 'Staff Finance',
        '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
        'finance', TRUE, 1, 1)
ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email, name = EXCLUDED.name, role = EXCLUDED.role;

SELECT setval('users_id_seq', GREATEST((SELECT MAX(id) FROM users), 1));

-- COMPANY CLIENTS
-- PT. IMC Ship Management (quotation recipient).
INSERT INTO company_client (number, name, npwp, address, email, country_code, tku_id, created_by, updated_by)
VALUES ('2641', 'PT. IMC Ship Management',
        '0612345678901000',
        'Graha Irama Lt. 8 unit ABC, Jl. HR Rasuna Said Blok X-1 No. 1-2 RT 006/RW 004, Kuningan Timur, Kec. Setiabudi, Jakarta Selatan',
        NULL, 'IDN', NULL, 1, 1);

-- PT. Yuxin Shipping Line (invoice recipient — different entity from IMC).
INSERT INTO company_client (number, name, npwp, address, email, country_code, tku_id, created_by, updated_by)
VALUES ('0779', 'PT. Yuxin Shipping Line',
        '0618956270022000',
        'Gedung TCC Batavia Tower One Lt. 11 Unit 03, Jl. KH Mas Mansyur Kav. 126 RT 009 RW 003, Karet Tengsin, Tanah Abang, Jakarta Pusat',
        'ptyuxinshippingline@gmail.com', 'IDN', '0618956270022000000000', 1, 1);

-- PT. Transcoal Pacific (placeholder client).
INSERT INTO company_client (number, name, npwp, address, country_code, created_by, updated_by)
VALUES ('1061', 'PT. Transcoal Pacific', NULL, 'Jakarta', 'IDN', 1, 1);

-- COMPANY CONTACTS
INSERT INTO company_contacts (company_id, name, email, phone, title, created_by, updated_by)
VALUES (1, 'Bp. Restu Umar Singgih',
        'restu.singgih@imc-shipmanagement.com',
        NULL, 'Procurement', 1, 1);

-- VENDORS
INSERT INTO vendors (name, location, contact_info, created_by, updated_by)
VALUES
  ('Toko ABC Jakarta', 'Jakarta Barat',
   '{"email": "abc@vendor.com", "phone": "+6281234567890", "pic": "Pak Budi"}', 1, 1),
  ('CV Marine Supply', 'Surabaya',
   '{"whatsapp": "+6287712345678", "pic": "Ibu Tini"}', 1, 1),
  ('PT Tekiro Indonesia', 'Jakarta Timur',
   '{"email": "sales@tekiro.co.id"}', 1, 1);

-- ITEMS (real quotation PDF)
-- default_unit_id: 19=SET, 21=PCS, 34=TIN, 35=TUB, 36=PKT
INSERT INTO items (name, impa_code, default_unit_id, created_by, updated_by) VALUES
  ('PUNCHING TOOL SET DIES & TABLE, 6-38MM 16S',                '613802', 19, 1, 1),
  ('PRUSIAN BLUE Permatex 22ml (Tube)',                         NULL,     35, 1, 1),
  ('CARBORUNDUM PASTE GRIT#2000, MICRO FINE 450GRM',            NULL,     34, 1, 1),
  ('CARBORUNDUM PASTE GRIT#1500, MICRO FINE 450GRM',            NULL,     34, 1, 1),
  ('CARBORUNDUM PASTE GRIT#800, MICRO FINE 450GRM',             NULL,     34, 1, 1),
  ('PULLER GEAR & WHEEL 3-ARM, 0-200MM, Brand TEKIRO 8"',       NULL,     19, 1, 1),
  ('PULLER GEAR & WHEEL 3-ARM, 0-150MM, Brand TEKIRO 6"',       NULL,     19, 1, 1),
  ('RIVET BLIND OPENTYPE ALUM-BODY, 3.2X8.0MM Per pack 1000pcs',NULL,     36, 1, 1),
  ('RIVET BLIND OPENTYPE ALUM-BODY, 3.2X6MM Per pack 1000pcs',  NULL,     36, 1, 1),
  ('WRENCH HOOK SPANNER 65-75MM, CARBON STEEL',                 NULL,     21, 1, 1),
  ('LAMP LED 12W (100W) 220V E-27, COOL WHITE',                 '790268', 21, 1, 1),
  ('LAMP LED 8W (60W) 220V E-27, COOL WHITE',                   '790265', 21, 1, 1),
  ('FLOODLIGHT FIXTURE LED SLD-150',                            '791836', 19, 1, 1),
  ('FREIGHT/DELIVERY TO PORT',                                  NULL,     19, 1, 1);

-- VENDOR PRODUCTS (cost price per vendor; ~40% margin)
INSERT INTO vendor_products (vendor_id, item_id, vendor_sku, cost_price, created_by, updated_by) VALUES
  (3, 1,  'TEK-PT16', 1200000, 1, 1),
  (1, 2,  'ABC-PB22', 90000,   1, 1),
  (1, 3,  'ABC-CP2K', 40000,   1, 1),
  (1, 4,  'ABC-CP15', 40000,   1, 1),
  (1, 5,  'ABC-CP08', 40000,   1, 1),
  (3, 6,  'TEK-PW8',  450000,  1, 1),
  (3, 7,  'TEK-PW6',  270000,  1, 1),
  (1, 8,  'ABC-RB32', 110000,  1, 1),
  (1, 9,  'ABC-RB63', 130000,  1, 1),
  (2, 10, 'MS-WH75',  320000,  1, 1),
  (2, 11, 'MS-LED12', 28000,   1, 1),
  (2, 12, 'MS-LED08', 30000,   1, 1),
  (2, 13, 'MS-FL150', 270000,  1, 1);

-- QUOTATION Q-264128/GNS/IV/2026
-- Client: PT. IMC Ship Management. Vessel: MV YUXIN SATU.
-- Ref client: 8404/V-0006/REQ26. date: 1 April 2026.
INSERT INTO quotations (
  id, quotation_no, version, company_client_id, company_client_name,
  contact_id, contact_name, client_ref_no, vessel_name, status,
  payment_terms, validity_days, discount_pct,
  total_produk, total, total_discount,
  notes, created_by, updated_by
) VALUES (
  1, 'Q-264128/GNS/IV/2026', 1, 1, 'PT. IMC Ship Management',
  1, 'Bp. Restu Umar Singgih', '8404/V-0006/REQ26', 'MV YUXIN SATU', 'sent',
  '30 days', 3, 5,
  -- Subset 13 items. total_produk = total (no shipping line).
  8141000, 8141000, 407050,
  'Subset 13 baris untuk demo. Original quotation punya 117 baris.',
  2, 2
);
SELECT setval('quotations_id_seq', 1, true);

-- Quotation line items (subset of 117 from original PDF)
INSERT INTO quotation_items (
  quotation_id, line_number, item_type,
  requested_item_id, requested_impa, requested_name,
  offered_item_id, vendor_product_id,
  qty, unit_id, selling_price, cost_price,
  created_by, updated_by
) VALUES
  (1, 1, 'product', 1, NULL,
   'PUNCHING TOOL SET DIES & TABLE, 6-38MM 16S',
   1, 1, 1, 19, 2000000, 1200000, 2, 2),
  (1, 2, 'product', 2, NULL,
   'BLUE PASTE 120GRM For lapping of bearings, high',
   2, 2, 10, 35, 145000, 90000, 2, 2),
  (1, 3, 'product', 3, NULL,
   'CARBORUNDUM PASTE GRIT#2000, MICRO FINE 450GRM',
   3, 3, 1, 34, 68000, 40000, 2, 2),
  (1, 4, 'product', 4, NULL,
   'CARBORUNDUM PASTE GRIT#1500, MICRO FINE 450GRM',
   4, 4, 1, 34, 68000, 40000, 2, 2),
  (1, 5, 'product', 5, NULL,
   'CARBORUNDUM PASTE GRIT#800, MICRO FINE 450GRM',
   5, 5, 1, 34, 68000, 40000, 2, 2),
  (1, 6, 'product', 6, NULL,
   'PULLER GEAR & WHEEL 3-ARM, 0-200MM Drop forged',
   6, 6, 1, 19, 750000, 450000, 2, 2),
  (1, 7, 'product', 7, NULL,
   'PULLER GEAR & WHEEL 3-ARM, 0-125MM Drop forged',
   7, 7, 1, 19, 445000, 270000, 2, 2),
  (1, 8, 'product', 8, NULL,
   'RIVET BLIND OPENTYPE ALUM-BODY, STEEL-MANDREL 3.2X8.0MM',
   8, 8, 1, 36, 185000, 110000, 2, 2),
  (1, 9, 'product', 9, NULL,
   'RIVET BLIND OPENTYPE ALUM-BODY, STEEL-MANDREL 3.2X6.3MM',
   9, 9, 1, 36, 215000, 130000, 2, 2),
  (1, 10, 'product', 10, NULL,
   'WRENCH HOOK SPANNER 68-75MM, STAINLESS STEEL',
   10, 10, 3, 21, 535000, 320000, 2, 2),
  (1, 11, 'product', 11, '790268',
   'LAMP LED 12W (100W) 220V E-27, COOL WHITE',
   11, 11, 50, 21, 48000, 28000, 2, 2),
  (1, 12, 'product', 12, '790265',
   'LAMP LED 8W (60W) 220V E-27, COOL WHITE',
   12, 12, 50, 21, 50000, 30000, 2, 2),
  (1, 13, 'product', 13, '791836',
   'FLOODLIGHT FIXTURE LED SLD-150',
   13, 13, 10, 19, 450000, 270000, 2, 2);

-- PURCHASE ORDER PO-264129/GNS/IV/2026
-- Issued by: PT. IMC Ship Management (via Pak Restu).
-- Source quotation: Q-264128. Original PO ref: 8404/O-0079/P025.
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

-- PO items (top 4 highest-value lines from quotation)
INSERT INTO purchase_order_items (
  po_id, quotation_item_id, line_number, item_type, offered_item_id,
  qty, unit_id, selling_price, cost_price, created_by, updated_by
) VALUES
  (1, 11, 1, 'product', 11, 50, 21, 48000, 28000, 2, 2),
  (1, 12, 2, 'product', 12, 50, 21, 50000, 30000, 2, 2),
  (1, 13, 3, 'product', 13, 10, 19, 450000, 270000, 2, 2),
  (1, 1,  4, 'product', 1,  1,  19, 2000000, 1200000, 2, 2);

-- INVOICE 077/INV-GNS-8/2025
-- Billed to: PT. Yuxin Shipping Line (NPWP 0618956270022000).
-- NOTE: Invoice billed to DIFFERENT entity (Yuxin), PO issued by IMC.
-- Faktur Pajak Coretax: 04002500242787250. Tax code 04 = DPP Nilai Lain.
INSERT INTO invoices (
  id, invoice_no, quotation_id, po_id, company_client_id,
  invoice_date, due_date, subtotal, dpp,
  ppn_rate, tax_transaction_code, faktur_type, status,
  created_by, updated_by
) VALUES (
  1, '077/INV-GNS-8/2025', 1, 1, 2,
  '2025-08-07', '2025-09-06',
  7744000,
  7744000,
  12.00, '04', 'Normal', 'paid',
  3, 3
);
SELECT setval('invoices_id_seq', 1, true);

-- Invoice items (snapshot of PO items, 4 lines)
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

-- ITEM REQUEST MATCHES (auto-suggest learning entries)
-- Trigger trg_learn_match (00003) auto-populates via INSERT quotation_items.
-- Override match_count to simulate richer history.
INSERT INTO item_request_matches (request_text, matched_item_id, match_count) VALUES
  ('PUNCHING TOOL SET DIES & TABLE, 6-38MM 16S', 1, 3),
  ('LAMP LED 12W (100W) 220V E-27', 11, 5),
  ('LAMP LED 8W (60W) 220V E-27', 12, 5),
  ('CARBORUNDUM PASTE MICRO FINE 450GRM', 3, 2)
ON CONFLICT (LOWER(TRIM(request_text))) DO UPDATE
  SET match_count = EXCLUDED.match_count;

COMMIT;

-- VERIFY (optional)
-- SELECT COUNT(*) FROM users;             -- expect 3 (1 superadmin + 2 sample)
-- SELECT COUNT(*) FROM company_client;    -- expect 3
-- SELECT COUNT(*) FROM items;             -- expect 14
-- SELECT COUNT(*) FROM vendor_products;   -- expect 13
-- SELECT COUNT(*) FROM quotations;        -- expect 1
-- SELECT COUNT(*) FROM quotation_items;   -- expect 13
