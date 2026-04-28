-- DEV SAMPLES — rich, related dataset (>=20 rows per table)
-- DEV ONLY. Run after 01_master.sql.
-- Idempotent: TRUNCATE sample tables; preserves superadmin (users.id=1).
-- Source mix:
--   * REAL: Q-264128/GNS/IV/2026 (IMC), 077/INV-GNS-8/2025 (Yuxin),
--           PO 8404/O-0079/P025 (IMC), 10611/INV-GNS-1/2026 (Transcoal)
--   * FICTIONAL: dummy maritime clients/vendors with clearly-fictional names
--                so seed cannot be confused with real Indonesian entities.

BEGIN;

-- 0. RESET sample tables (preserve master data: units, countries, doc_sequences)
-- =============================================================================
TRUNCATE TABLE
  invoice_items, invoices,
  purchase_order_items, purchase_orders,
  quotation_status_history, quotation_items, quotations,
  item_request_matches,
  vendor_products, items,
  company_contacts, company_client,
  vendors,
  doc_sequences
RESTART IDENTITY CASCADE;

-- Preserve superadmin (id=1); replace 2..N with sample staff.
DELETE FROM users WHERE id <> 1;


-- 1. USERS — 7 staff + 1 superadmin (preserved) = 8
-- =============================================================================
-- Real GNS staff inferred from documents (Diah Arimurti = signed faktur,
-- Seno Dwi Sasongko = signed quotation). Others are fictional.
-- Password hash for all = bcrypt("changeme").
INSERT INTO users (id, email, name, password_hash, role, is_active, created_by, updated_by) VALUES
  (2, 'ops@globalsakti.com',          'Staff Operasional',
      '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', 'operational', TRUE, 1, 1),
  (3, 'finance@globalsakti.com',      'Staff Finance',
      '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', 'finance',     TRUE, 1, 1),
  (4, 'diah.arimurti@globalsakti.com','Diah Arimurti',
      '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', 'finance',     TRUE, 1, 1),
  (5, 'seno.sasongko@globalsakti.com','Seno Dwi Sasongko',
      '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', 'operational', TRUE, 1, 1),
  (6, 'andi.wijaya@globalsakti.com',  'Andi Wijaya',
      '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', 'operational', TRUE, 1, 1),
  (7, 'mira.lestari@globalsakti.com', 'Mira Lestari',
      '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', 'operational', TRUE, 1, 1),
  (8, 'hendra.kurnia@globalsakti.com','Hendra Kurnia',
      '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy', 'finance',     TRUE, 1, 1)
ON CONFLICT (id) DO UPDATE
  SET email = EXCLUDED.email, name = EXCLUDED.name, role = EXCLUDED.role;

SELECT setval('users_id_seq', GREATEST((SELECT MAX(id) FROM users), 1));


-- 2. COMPANY CLIENTS — 25 (3 real from PDFs + 22 fictional maritime)
-- =============================================================================
-- Number = 4-digit company code used by GNS internally (per fn_next_doc_no).
INSERT INTO company_client (id, number, name, npwp, address, email, country_code, tku_id, created_by, updated_by) VALUES
  (1,  '2641', 'PT. IMC Ship Management',
       '0612345678901000',
       'Graha Irama Lt. 8 unit ABC, Jl. HR Rasuna Said Blok X-1 No. 1-2 RT 006/RW 004, Kuningan Timur, Setiabudi, Jakarta Selatan',
       'restu.singgih@imc-shipmanagement.com', 'IDN', NULL, 1, 1),
  (2,  '0779', 'PT. Yuxin Shipping Line',
       '0618956270022000',
       'Gedung TCC Batavia Tower One Lt. 11 Unit 03, Jl. KH Mas Mansyur Kav. 126 RT 009/RW 003, Karet Tengsin, Tanah Abang, Jakarta Pusat',
       'ptyuxinshippingline@gmail.com', 'IDN', '0618956270022000000000', 1, 1),
  (3,  '1061', 'PT. Transcoal Pacific',
       '0123456789012000',
       'Bakrie Tower Lt. 9, Komp Rasuna Epicentrum, Jl. HR Rasuna Said, Karet Kuningan, Setiabudi, Jakarta 12940',
       'procurement@transcoal-pacific.example', 'IDN', NULL, 1, 1),
  (4,  '3301', 'PT. Bahari Sandi Pratama',
       '0234567890123000', 'Jl. Yos Sudarso Kav. 88, Tanjung Priok, Jakarta Utara 14310',
       'procurement@baharisandi.example', 'IDN', NULL, 1, 1),
  (5,  '3302', 'PT. Samudra Anugerah Sejati',
       '0345678901234000', 'Jl. Perak Barat 271, Surabaya 60177',
       'ops@samudra-anugerah.example', 'IDN', NULL, 1, 1),
  (6,  '3303', 'PT. Cipta Bahtera Pelayaran',
       '0456789012345000', 'Jl. Pelabuhan Tanjung Emas Blok F, Semarang 50174',
       'sales@cipta-bahtera.example', 'IDN', NULL, 1, 1),
  (7,  '3304', 'PT. Karya Laut Mandiri',
       '0567890123456000', 'Jl. Diponegoro 122, Balikpapan 76112',
       'logistik@karyalaut.example', 'IDN', NULL, 1, 1),
  (8,  '3305', 'PT. Surya Maritim Nusantara',
       '0678901234567000', 'Jl. Kalimas Baru 91, Surabaya 60165',
       'admin@surya-maritim.example', 'IDN', NULL, 1, 1),
  (9,  '3306', 'PT. Pelayaran Bintang Timur Sukses',
       '0789012345678000', 'Jl. Yos Sudarso Lr. 7, Makassar 90211',
       'pengadaan@bintangtimur.example', 'IDN', NULL, 1, 1),
  (10, '3307', 'PT. Niaga Bahari Lestari',
       '0890123456789000', 'Jl. Brigjen Katamso 14, Medan 20158',
       'kontak@niagabahari.example', 'IDN', NULL, 1, 1),
  (11, '3308', 'PT. Andalan Samudera Pratama',
       '0901234567890000', 'Jl. Perak Timur 562, Surabaya 60165',
       'ops@andalan-samudera.example', 'IDN', NULL, 1, 1),
  (12, '3309', 'PT. Mitra Pelayaran Khatulistiwa',
       '1012345678901000', 'Jl. Pelabuhan Pontianak 22, Pontianak 78112',
       'office@mitrakhatulistiwa.example', 'IDN', NULL, 1, 1),
  (13, '3310', 'PT. Pulau Seroja Marine',
       '1123456789012000', 'Jl. Yos Sudarso Kav. 22, Batam 29422',
       'pengadaan@pulauseroja.example', 'IDN', NULL, 1, 1),
  (14, '3311', 'PT. Bahari Megah Lautan',
       '1234567890123000', 'Jl. Pelabuhan Sunda Kelapa 4, Jakarta Utara 14430',
       'admin@baharimegah.example', 'IDN', NULL, 1, 1),
  (15, '3312', 'PT. Nusantara Lintas Bahari',
       '1345678901234000', 'Jl. Pelabuhan Lembar 17, Mataram 83361',
       'kontak@nusantaralb.example', 'IDN', NULL, 1, 1),
  (16, '3313', 'PT. Kapuas Marine Service',
       '1456789012345000', 'Jl. Tanjung Pura 88, Pontianak 78115',
       'ops@kapuas-marine.example', 'IDN', NULL, 1, 1),
  (17, '3314', 'PT. Cakrawala Bahari Jaya',
       '1567890123456000', 'Jl. Yos Sudarso 304, Cilacap 53212',
       'sales@cakrawala-bahari.example', 'IDN', NULL, 1, 1),
  (18, '3315', 'PT. Jaya Maritim Anugerah',
       '1678901234567000', 'Jl. Pelabuhan Bitung 75, Bitung 95541',
       'kontak@jayamaritim.example', 'IDN', NULL, 1, 1),
  (19, '3316', 'PT. Lintas Khatulistiwa Bahari',
       '1789012345678000', 'Jl. Yos Sudarso 9, Sorong 98412',
       'ops@lintaskhatulistiwa.example', 'IDN', NULL, 1, 1),
  (20, '3317', 'PT. Pelayaran Tirta Anugerah',
       '1890123456789000', 'Jl. Pelabuhan Kendari 12, Kendari 93114',
       'pengadaan@tirta-anugerah.example', 'IDN', NULL, 1, 1),
  (21, '3318', 'PT. Bahtera Anugerah Mandiri',
       '1901234567890000', 'Jl. Pelabuhan Tanjung Wangi 5, Banyuwangi 68422',
       'office@bahtera-anugerah.example', 'IDN', NULL, 1, 1),
  (22, '3319', 'PT. Anugerah Mitra Bahari',
       '2012345678901000', 'Jl. Pelabuhan Belawan 88, Medan 20411',
       'kontak@anugerah-mb.example', 'IDN', NULL, 1, 1),
  (23, '3320', 'PT. Karya Bahtera Sukses',
       '2123456789012000', 'Jl. Pelabuhan Probolinggo 3, Probolinggo 67213',
       'ops@karya-bahtera.example', 'IDN', NULL, 1, 1),
  (24, '3321', 'Sapphire Seas Maritime Pte Ltd',
       NULL, '20 Maritime Square, #06-12 Harbourfront Centre, Singapore 099253',
       'ops@sapphireseas.example.sg', 'SGP', NULL, 1, 1),
  (25, '3322', 'Pelita Trans Logistics Sdn Bhd',
       NULL, 'Block A, Lot 12 North Port, Westports Pulau Indah, 42920 Selangor',
       'admin@pelitatrans.example.my', 'MYS', NULL, 1, 1);

SELECT setval('company_client_id_seq', GREATEST((SELECT MAX(id) FROM company_client), 1));


-- 3. COMPANY CONTACTS — 30 distributed across active clients
-- =============================================================================
-- Phone is digit-only (CHECK 9..12 digits). Country dial code lives separately
-- in country_code (FK to countries.code). FE renders +{dial} {phone}.
INSERT INTO company_contacts (id, company_id, name, email, phone, title, country_code, created_by, updated_by) VALUES
  -- IMC (real client, real contact from PDFs)
  (1,  1, 'Bp. Restu Umar Singgih', 'restu.singgih@imc-shipmanagement.com', '081298765432', 'Procurement Manager', 'IDN', 1, 1),
  (2,  1, 'Bp. Hadi Santoso',        'hadi.santoso@imc-shipmanagement.com', '081234556677', 'Technical Superintendent', 'IDN', 1, 1),
  (3,  1, 'Ibu Lina Pertiwi',        'lina.pertiwi@imc-shipmanagement.com', '081345678910', 'Supply Coordinator', 'IDN', 1, 1),
  -- Yuxin (real client; finance entity for IMC vessel quotations)
  (4,  2, 'Ibu Wati Kurniawan',      'wati.kurniawan@yuxin-shipping.example', '081234567890', 'Finance Manager', 'IDN', 1, 1),
  (5,  2, 'Bp. Tono Setiawan',       'tono.setiawan@yuxin-shipping.example', '081876543210', 'Operations Director', 'IDN', 1, 1),
  -- Transcoal (real client; coal/bulk shipping)
  (6,  3, 'Bp. Andi Saputra',        'andi.saputra@transcoal-pacific.example', '081298761234', 'Logistics Lead', 'IDN', 1, 1),
  (7,  3, 'Ibu Sari Indah',          'sari.indah@transcoal-pacific.example', '081345671122', 'Procurement', 'IDN', 1, 1),
  -- Bahari Sandi
  (8,  4, 'Bp. Budi Hartono',        'budi.hartono@baharisandi.example', '081234887766', 'Procurement Manager', 'IDN', 1, 1),
  (9,  4, 'Ibu Maya Wijayanti',      'maya.wijayanti@baharisandi.example', '081298776655', 'Crewing Officer', 'IDN', 1, 1),
  -- Samudra Anugerah
  (10, 5, 'Bp. Rio Pratama',         'rio.pratama@samudra-anugerah.example', '081345566778', 'Technical Manager', 'IDN', 1, 1),
  (11, 5, 'Ibu Devi Lestari',        'devi.lestari@samudra-anugerah.example', '081234112233', 'Procurement', 'IDN', 1, 1),
  -- Cipta Bahtera
  (12, 6, 'Bp. Joko Susilo',         'joko.susilo@cipta-bahtera.example',  '081298334455', 'Operations', 'IDN', 1, 1),
  -- Karya Laut
  (13, 7, 'Ibu Nina Anggraini',      'nina.anggraini@karyalaut.example',   '081234998877', 'Logistik Manager', 'IDN', 1, 1),
  -- Surya Maritim
  (14, 8, 'Bp. Eko Prasetyo',        'eko.prasetyo@surya-maritim.example', '081345002211', 'Pengadaan', 'IDN', 1, 1),
  (15, 8, 'Ibu Ratna Dewi',          'ratna.dewi@surya-maritim.example',   '081298556677', 'Finance', 'IDN', 1, 1),
  -- Pelayaran Bintang Timur
  (16, 9, 'Bp. Reza Anugerah',       'reza.anugerah@bintangtimur.example', '081234887700', 'Procurement Lead', 'IDN', 1, 1),
  -- Niaga Bahari
  (17, 10,'Bp. Yudi Wibowo',         'yudi.wibowo@niagabahari.example',    '081345779988', 'Operations Manager', 'IDN', 1, 1),
  -- Andalan Samudera
  (18, 11,'Ibu Dewi Anggraini',      'dewi.anggraini@andalan-samudera.example', '081298440011', 'Procurement', 'IDN', 1, 1),
  -- Mitra Pelayaran Khatulistiwa
  (19, 12,'Bp. Andre Halim',         'andre.halim@mitrakhatulistiwa.example', '081234665544', 'Logistik', 'IDN', 1, 1),
  -- Pulau Seroja
  (20, 13,'Ibu Lia Permata',         'lia.permata@pulauseroja.example',    '081345112277', 'Crewing Manager', 'IDN', 1, 1),
  -- Bahari Megah
  (21, 14,'Bp. Surya Putra',         'surya.putra@baharimegah.example',    '081298003344', 'Operations', 'IDN', 1, 1),
  -- Nusantara Lintas Bahari
  (22, 15,'Bp. Faisal Akbar',        'faisal.akbar@nusantaralb.example',   '081234556677', 'Procurement', 'IDN', 1, 1),
  -- Kapuas Marine
  (23, 16,'Bp. Iwan Setyo',          'iwan.setyo@kapuas-marine.example',   '081345990011', 'Operations Manager', 'IDN', 1, 1),
  -- Cakrawala Bahari
  (24, 17,'Ibu Siti Rahmawati',      'siti.rahmawati@cakrawala-bahari.example', '081298778899', 'Pengadaan', 'IDN', 1, 1),
  -- Jaya Maritim
  (25, 18,'Bp. Bambang Wahyudi',     'bambang.wahyudi@jayamaritim.example', '081234119900', 'Logistik Manager', 'IDN', 1, 1),
  -- Lintas Khatulistiwa
  (26, 19,'Bp. Andi Hermawan',       'andi.hermawan@lintaskhatulistiwa.example', '081345224466', 'Operations', 'IDN', 1, 1),
  -- Tirta Anugerah
  (27, 20,'Ibu Vivi Anggreani',      'vivi.anggreani@tirta-anugerah.example', '081298335577', 'Crewing', 'IDN', 1, 1),
  -- Bahtera Anugerah
  (28, 21,'Bp. Krisna Putra',        'krisna.putra@bahtera-anugerah.example', '081234668899', 'Procurement', 'IDN', 1, 1),
  -- Sapphire Seas (Singapore)
  (29, 24,'Mr. Lim Wei Sheng',       'wei.lim@sapphireseas.example.sg',    '6591234567', 'Vessel Superintendent', 'SGP', 1, 1),
  -- Pelita Trans (Malaysia)
  (30, 25,'Mr. Ahmad Rizal',         'ahmad.rizal@pelitatrans.example.my', '60123456789', 'Procurement Officer', 'MYS', 1, 1);

SELECT setval('company_contacts_id_seq', GREATEST((SELECT MAX(id) FROM company_contacts), 1));


-- 4. VENDORS — 25 (mix of fictional distributors + Indonesian ship-supply trade)
-- =============================================================================
-- Brand names (TEKIRO, Permatex, etc.) appear in items.name; vendors here
-- are clearly-fictional local distributors who carry those brands.
INSERT INTO vendors (id, name, location, contact_info, created_by, updated_by) VALUES
  (1,  'Toko ABC Jakarta',                 'Jakarta Barat',
       '{"email":"abc@vendor.example","phone":"+6281234567890","pic":"Pak Budi"}'::jsonb, 1, 1),
  (2,  'CV Marine Supply Surabaya',        'Surabaya',
       '{"whatsapp":"+6287712345678","pic":"Ibu Tini"}'::jsonb, 1, 1),
  (3,  'PT Sentral Tools Indonesia',       'Jakarta Timur',
       '{"email":"sales@sentraltools.example","phone":"+62215678901"}'::jsonb, 1, 1),
  (4,  'Toko Berkah Jaya Mandiri',         'Tanjung Priok, Jakarta Utara',
       '{"whatsapp":"+6281122334455","pic":"Pak Hasan"}'::jsonb, 1, 1),
  (5,  'CV Sumber Logam Tegalsari',        'Tegal',
       '{"email":"order@sumberlogam.example"}'::jsonb, 1, 1),
  (6,  'PT Anugerah Marine Equipment',     'Cilegon',
       '{"email":"sales@anugerah-me.example","phone":"+62254998877"}'::jsonb, 1, 1),
  (7,  'PT Pelangi Marine Sejahtera',      'Surabaya',
       '{"email":"info@pelangi-marine.example"}'::jsonb, 1, 1),
  (8,  'Toko Maritim Sejati',              'Jakarta Utara',
       '{"whatsapp":"+6287788991122","pic":"Pak Ali"}'::jsonb, 1, 1),
  (9,  'CV Niaga Bahari Sukses',           'Cilegon',
       '{"email":"order@niagabahari-vendor.example"}'::jsonb, 1, 1),
  (10, 'PT Mitra Industri Niaga',          'Bekasi',
       '{"email":"sales@mitra-industri.example"}'::jsonb, 1, 1),
  (11, 'CV Karya Logam Mandiri',           'Surabaya',
       '{"whatsapp":"+6285887766554"}'::jsonb, 1, 1),
  (12, 'PT Bintang Tools Indonesia',       'Jakarta Pusat',
       '{"email":"info@bintang-tools.example","pic":"Pak Eko"}'::jsonb, 1, 1),
  (13, 'PT Sumber Listrik Sentosa',        'Jakarta Pusat',
       '{"email":"sales@sumberlistrik.example"}'::jsonb, 1, 1),
  (14, 'CV Cahaya Elektrindo',             'Surabaya',
       '{"whatsapp":"+6285999887766","pic":"Bu Yanti"}'::jsonb, 1, 1),
  (15, 'PT Adhi Pratama Marine',           'Batam',
       '{"email":"sales@adhi-marine.example"}'::jsonb, 1, 1),
  (16, 'PT Sinar Las Mandiri',             'Jakarta Timur',
       '{"email":"order@sinarlas.example","phone":"+6221998877"}'::jsonb, 1, 1),
  (17, 'PT Citra Pelumas Niaga',           'Tangerang',
       '{"email":"sales@citrapelumas.example"}'::jsonb, 1, 1),
  (18, 'PT Lautan Kimia Indonesia',        'Bekasi',
       '{"email":"sales@lautan-kimia.example"}'::jsonb, 1, 1),
  (19, 'CV Sari Sentosa Abrasif',          'Cikarang',
       '{"email":"order@sarisentosa.example"}'::jsonb, 1, 1),
  (20, 'PT Indo Safety Pratama',           'Tangerang',
       '{"email":"info@indosafety.example"}'::jsonb, 1, 1),
  (21, 'PT Jaya Refrigerasi Sukses',       'Cikarang',
       '{"email":"sales@jaya-refrig.example"}'::jsonb, 1, 1),
  (22, 'CV Bahari Akustik',                'Tanjung Priok',
       '{"whatsapp":"+6281211223344"}'::jsonb, 1, 1),
  (23, 'PT Citra Multi Pengukur',          'Jakarta Pusat',
       '{"email":"sales@citra-pengukur.example"}'::jsonb, 1, 1),
  (24, 'Toko Sumber Niaga Plumbing',       'Bekasi',
       '{"whatsapp":"+6287722334455","pic":"Pak Tatang"}'::jsonb, 1, 1),
  (25, 'PT Globalsindo Marine Spare',      'Surabaya',
       '{"email":"sales@globalsindo-spare.example","phone":"+62318899221"}'::jsonb, 1, 1);

SELECT setval('vendors_id_seq', GREATEST((SELECT MAX(id) FROM vendors), 1));


-- 5. ITEMS — 60 distinct products (real marine ship-supply catalog)
-- =============================================================================
-- Source: Q-264128 quotation (117 lines), PO 8404/O-0079 (51 lines),
--         Invoice 077/INV-GNS (51 electrical lines). Mix of brands + generic.
-- default_unit_id refs units(id): 8=BBL, 13=MTR, 14=IN, 17=DOZ, 18=UNIT, 19=SET,
--   21=PCS, 22=BOX, 33=OTH, 34=TIN, 35=TUB, 36=PKT, 37=BTL, 38=PRS, 39=RLS, 40=SPL.
INSERT INTO items (id, name, impa_code, default_unit_id, description, created_by, updated_by) VALUES
  -- MECHANICAL TOOLS (1-15)
  (1,  'PUNCHING TOOL SET DIES & TABLE, 6-38MM 16''S',          '613802', 19,
       'Used for punching holes in soft brass, copper, and other materials. Includes 16 dies.', 1, 1),
  (2,  'PULLER GEAR & WHEEL 3-ARM, 0-200MM, BRAND TEKIRO 8"',   NULL, 19,
       'Drop forged from vanadium steel; rigid 3-arm puller for situations where 2-arm puller fails.', 1, 1),
  (3,  'PULLER GEAR & WHEEL 3-ARM, 0-150MM, BRAND TEKIRO 6"',   NULL, 19, NULL, 1, 1),
  (4,  'PULLER BEARING KIT SIZE 00-12, INNER & OUTER RING',     '615082', 19,
       'Kit removes inner & outer bearing rings from various fittings, shafts. Drop forged heat-treated vanadium alloy.', 1, 1),
  (5,  'WRENCH HOOK SPANNER 65-75MM, CARBON STEEL',             NULL, 21, NULL, 1, 1),
  (6,  'WRENCH ADJUSTABLE TEKIRO 250MM/10"',                    NULL, 21, NULL, 1, 1),
  (7,  'WRENCH ADJUSTABLE TEKIRO 150MM/6"',                     NULL, 21, NULL, 1, 1),
  (8,  'WRENCH CHAIN PIPE 24"',                                 NULL, 21,
       'Single jaw 25-170mm capacity. Drop forged from vanadium alloy steel.', 1, 1),
  (9,  'PLIER SIDE CUTTING STAINLESS 175MM, BRAND TEKIRO 7"',   '615870', 21, NULL, 1, 1),
  (10, 'PLIER LONG-NOSE SIDE CUTTING STAINLESS 200MM, BRAND TEKIRO 8"', '615876', 21, NULL, 1, 1),
  (11, 'PLIER DIAGONAL CUTTING 150MM',                          '615881', 21, NULL, 1, 1),
  (12, 'PLIER BENT-NOSE PLASTIC HANDLE 150MM (6")',             NULL, 38, NULL, 1, 1),
  (13, 'GUNTING HOLO LURUS 8"',                                 NULL, 38, 'Snip hand straight edge 210mm', 1, 1),
  (14, 'GUNTING HOLO LENGKUNG 8"',                              NULL, 38, 'Snip hand curved edge 210mm', 1, 1),
  (15, 'PACKING HOOK SET COMPLETE 6PCS',                        NULL, 19, NULL, 1, 1),

  -- SCREWDRIVERS (16-22)
  (16, 'SCREWDRIVER INSULATED HEAVY-DUTY SLOTTED 8X150MM, BRAND VESSEL', NULL, 21, NULL, 1, 1),
  (17, 'SCREWDRIVER INSULATED HEAVY-DUTY SLOTTED 9X200MM, BRAND VESSEL', NULL, 21, NULL, 1, 1),
  (18, 'SCREWDRIVER INSULATED HEAVY-DUTY SLOTTED 10X250MM, BRAND VESSEL', NULL, 21, NULL, 1, 1),
  (19, 'SCREWDRIVER INSULATED PHILLIPS NO.3 150MM, BRAND VESSEL',NULL, 21, NULL, 1, 1),
  (20, 'SCREWDRIVER ELECTRICIAN PHILLIPS NO.1 150MM, BRAND ACESA', NULL, 21, NULL, 1, 1),
  (21, 'NUT DRIVER SET 5-12MM 7''S',                            '612366', 19,
       'Deep socket nut drivers as set with steel holding rack. 7 nut drivers from 5mm to 12mm.', 1, 1),
  (22, 'SCREWDRIVER SET HAMMERING IMPACT-TYPE 6 BITS, BRAND ARCA', NULL, 19, NULL, 1, 1),

  -- LIGHTING (23-32)
  (23, 'LAMP LED 12W (100W) 220V E-27, COOL WHITE',             '790268', 21,
       'More cost effective lamp vs incandescent or fluorescent. LEDs last several times longer and use 90% less energy.', 1, 1),
  (24, 'LAMP LED 8W (60W) 220V E-27, COOL WHITE',               '790265', 21, NULL, 1, 1),
  (25, 'FLOODLIGHT FIXTURE LED SLD-150 100-220V',               '791836', 19,
       'Vibration-proof, shock-resistant, robust flood lighting with high-brightness LED. 1/6 power consumption vs incandescent.', 1, 1),
  (26, 'FLOODLIGHT FIXTURE COOL WHITE LED 200W 100-240V',       NULL, 19, NULL, 1, 1),
  (27, 'LAMP HALOGEN TUBULAR E-39 200-240V 500W',               '791272', 21, NULL, 1, 1),
  (28, 'LAMP ENERGY SAVING COMPACT FL E14 240VAC 11W',          '791517', 21,
       'Compact fluorescent 2700K, used without ballast.', 1, 1),
  (29, 'LAMP NAVIGATION TUBULAR E-27 220V 60W',                 NULL, 21, NULL, 1, 1),
  (30, 'LAMP FLUORESCENT FL-40S/38 38W 32.5X1198MM, COOL WHITE',NULL, 21, NULL, 1, 1),
  (31, 'FL CEILING LIGHT WATERTIGHT W/GLOBE AC220V KEW402 40WX2','791887', 21,
       'For machinery room, galleys, bathrooms, outdoor passageways at ambient up to 45C.', 1, 1),
  (32, 'HAND LAMP WATERTIGHT E-26 60W',                         '792151', 21,
       'Watertight portable lamp with S90A screw globe and cast iron body. Hard wood/rubber grip.', 1, 1),

  -- ELECTRICAL (33-43)
  (33, 'CABLE HALOGEN-FREE UNARMOURED HF-CXO 0.6/1KV 1.5MM²X3C','794283', 13,
       'Halogen-free fire-safe cable for ships. No toxic burning fumes. Frame-retardant per IEC 60332-3.', 1, 1),
  (34, 'PLUG & DOUBLE RECEPTACLE 2-ROUND PIN SIEMENS NWT',      '792925', 19,
       'Phenol resin round 2-pin with grounding. Pin diameter 4.8mm, distance 19.5mm. 250V 10A DC, 16A AC.', 1, 1),
  (35, 'PLUG CEE FEMALE AC380V RED 4P 32AMP 6H IP67',           NULL, 21, NULL, 1, 1),
  (36, 'PLUG CEE MALE AC380V RED 4P 32AMP 6H IP67',             NULL, 21, NULL, 1, 1),
  (37, 'TERMINAL STRIP SEPARATABLE MOLDED 12-POLE 380V 10A',    NULL, 21, NULL, 1, 1),
  (38, 'CABLE REEL EXTENSION AC220V 50MTR',                     NULL, 19, NULL, 1, 1),
  (39, 'TAPE PVC INSULATION 50MMX20MTR, BLACK',                 NULL, 33, NULL, 1, 1),
  (40, 'CABLE TIE SELF-LOCKING PLASTIC 200MM 100''S',           NULL, 36, NULL, 1, 1),
  (41, 'CABLE TIE SELF-LOCKING PLASTIC 350MM 100''S',           NULL, 36, NULL, 1, 1),
  (42, 'STARTER FOR FL LAMP FG-1P',                             '791504', 21, NULL, 1, 1),
  (43, 'STARTER FOR FL LAMP FG-4P',                             '791505', 21, NULL, 1, 1),

  -- LUBRICANTS / CHEMICALS / PASTE (44-50)
  (44, 'PRUSIAN BLUE Permatex 22ml (Tube)',                     NULL, 35,
       'Blue paste 120GRM for lapping bearings, high pressure valves. Improved type vs red lead.', 1, 1),
  (45, 'CARBORUNDUM PASTE GRIT#2000 MICRO FINE 450GRM',         NULL, 34, NULL, 1, 1),
  (46, 'CARBORUNDUM PASTE GRIT#1500 MICRO FINE 450GRM',         NULL, 34, NULL, 1, 1),
  (47, 'CARBORUNDUM PASTE GRIT#800 MICRO FINE 450GRM',          NULL, 34, NULL, 1, 1),
  (48, 'CARBORUNDUM PASTE GRIT#500 VERY FINE 450GRM',           NULL, 34, NULL, 1, 1),
  (49, 'LUBRICANT SPRAY WD-40 MULTIUSE 333ML',                  NULL, 34,
       'Protects metal from rust and corrosion, penetrates stuck parts.', 1, 1),
  (50, 'GLUE CYANOACRYLATE LOCTITE 401 INSTANT 20GRM',          NULL, 37, NULL, 1, 1),

  -- ABRASIVES / CONSUMABLES (51-57)
  (51, 'WHEEL CUTTING-OFF 305X3X25.4MM NIPPON RESIBON',         NULL, 21, NULL, 1, 1),
  (52, 'WHEEL GRINDING OFFSET 100X6X16MM NIPPON RESIBON',       NULL, 21, NULL, 1, 1),
  (53, 'AMPLAS ROLL 50MM X 45M GRID #120',                      NULL, 39, NULL, 1, 1),
  (54, 'BRUSH WIRE WHEEL STANDARD 75MMX3/8"',                   NULL, 21, NULL, 1, 1),
  (55, 'WIRE CUP BRUSH KNOT TYPE 75MMX5/8"',                    NULL, 21, NULL, 1, 1),
  (56, 'KAIN MAJUN PUTIH JAHIT TUMPUK',                         NULL, 33, 'Rag cotton 100% sterilized white.', 1, 1),
  (57, 'GLOVES WORKING COTTON ORDINARY (12 PAIRS)',             NULL, 17, NULL, 1, 1),

  -- INSTRUMENTS / SAFETY / SPECIALTY (58-60)
  (58, 'MULTI TESTER DIGITAL COMPACT FLUKE 27II',               NULL, 19,
       'Compact digital multi-tester covering DC voltage, AC voltage, DC current, AC current, resistance.', 1, 1),
  (59, 'RADIO HAND MARINE ENTEL DX544 INTRINSICALLY SAFE',      NULL, 19,
       'Intrinsically safe VHF (USTC) for hazardous areas.', 1, 1),
  (60, 'JASA PENGIRIMAN BARANG (FREIGHT/DELIVERY)',             NULL, 33,
       'Land/sea delivery service to designated port.', 1, 1);

SELECT setval('items_id_seq', GREATEST((SELECT MAX(id) FROM items), 1));


-- 6. VENDOR PRODUCTS — 82 pairs (60 primary + 22 secondary)
-- =============================================================================
-- CONVENTION: vp.id = item_id for the PRIMARY vendor of each item.
--   Lets quotation_items.vendor_product_id == offered_item_id always (primary).
--   Secondary/alt vendors live at id 101+ with no special semantic.
-- Cost prices reflect ~30-50% margin under selling prices in Q-264128 PDF.
INSERT INTO vendor_products (id, vendor_id, item_id, vendor_sku, cost_price, last_quoted_at, created_by, updated_by) VALUES
  -- PRIMARY vendor (id = item_id) ----------------------------------
  (1,  3,  1,  'STI-PT16',     1200000, '2026-03-15', 1, 1),
  (2,  3,  2,  'STI-PG200',    450000,  '2026-03-15', 1, 1),
  (3,  3,  3,  'STI-PG150',    270000,  '2026-03-15', 1, 1),
  (4,  3,  4,  'STI-PB12',     1100000, '2026-03-15', 1, 1),
  (5,  1,  5,  'ABC-WHS75',    330000,  '2026-02-12', 1, 1),
  (6,  3,  6,  'STI-WA250',    130000,  '2026-03-15', 1, 1),
  (7,  3,  7,  'STI-WA150',    65000,   '2026-03-15', 1, 1),
  (8,  1,  8,  'ABC-WCP24',    750000,  '2026-02-20', 1, 1),
  (9,  3,  9,  'STI-PSC175',   60000,   '2026-03-15', 1, 1),
  (10, 3,  10, 'STI-PLN200',   70000,   '2026-03-15', 1, 1),
  (11, 3,  11, 'STI-PDC150',   65000,   '2026-03-15', 1, 1),
  (12, 1,  12, 'ABC-PBN150',   75000,   '2026-02-22', 1, 1),
  (13, 1,  13, 'ABC-GHL8',     160000,  '2026-02-22', 1, 1),
  (14, 1,  14, 'ABC-GHB8',     160000,  '2026-02-22', 1, 1),
  (15, 3,  15, 'STI-PHK6',     280000,  '2026-03-15', 1, 1),
  (16, 12, 16, 'BTI-SDS8',     180000,  '2026-03-01', 1, 1),
  (17, 12, 17, 'BTI-SDS9',     200000,  '2026-03-01', 1, 1),
  (18, 12, 18, 'BTI-SDS10',    140000,  '2026-03-01', 1, 1),
  (19, 12, 19, 'BTI-SDP3',     180000,  '2026-03-01', 1, 1),
  (20, 12, 20, 'BTI-SDPe1',    120000,  '2026-03-01', 1, 1),
  (21, 3,  21, 'STI-NDS712',   180000,  '2026-03-15', 1, 1),
  (22, 3,  22, 'STI-SDH6',     350000,  '2026-03-15', 1, 1),
  (23, 13, 23, 'SLS-LED12',    28000,   '2026-03-20', 1, 1),
  (24, 13, 24, 'SLS-LED8',     30000,   '2026-03-20', 1, 1),
  (25, 13, 25, 'SLS-FL150',    270000,  '2026-03-20', 1, 1),
  (26, 13, 26, 'SLS-FL200',    460000,  '2026-03-20', 1, 1),
  (27, 13, 27, 'SLS-LH500',    160000,  '2026-03-20', 1, 1),
  (28, 13, 28, 'SLS-LE11',     38000,   '2026-03-20', 1, 1),
  (29, 13, 29, 'SLS-LN60',     32000,   '2026-03-20', 1, 1),
  (30, 13, 30, 'SLS-FL40',     25000,   '2026-03-20', 1, 1),
  (31, 13, 31, 'SLS-CL402',    1800000, '2026-03-20', 1, 1),
  (32, 13, 32, 'SLS-HL26',     200000,  '2026-03-20', 1, 1),
  (33, 13, 33, 'SLS-CHF15',    16000,   '2026-03-20', 1, 1),
  (34, 13, 34, 'SLS-PR2P',     38000,   '2026-03-20', 1, 1),
  (35, 13, 35, 'SLS-PCEF32',   115000,  '2026-03-20', 1, 1),
  (36, 13, 36, 'SLS-PCEM32',   115000,  '2026-03-20', 1, 1),
  (37, 13, 37, 'SLS-TS12-10A', 12000,   '2026-03-20', 1, 1),
  (38, 13, 38, 'SLS-CRE50',    1300000, '2026-03-20', 1, 1),
  (39, 13, 39, 'SLS-PVC50',    130000,  '2026-03-20', 1, 1),
  (40, 10, 40, 'MIN-CT200',    14000,   '2026-03-05', 1, 1),
  (41, 10, 41, 'MIN-CT350',    28000,   '2026-03-05', 1, 1),
  (42, 13, 42, 'SLS-FG1P',     12000,   '2026-03-20', 1, 1),
  (43, 13, 43, 'SLS-FG4P',     12000,   '2026-03-20', 1, 1),
  (44, 17, 44, 'CPN-PB22',     90000,   '2026-02-25', 1, 1),
  (45, 17, 45, 'CPN-CP2K',     40000,   '2026-02-25', 1, 1),
  (46, 17, 46, 'CPN-CP15',     40000,   '2026-02-25', 1, 1),
  (47, 17, 47, 'CPN-CP800',    40000,   '2026-02-25', 1, 1),
  (48, 17, 48, 'CPN-CP500',    40000,   '2026-02-25', 1, 1),
  (49, 17, 49, 'CPN-WD333',    72000,   '2026-02-25', 1, 1),
  (50, 18, 50, 'LKI-LT401',    36000,   '2026-03-08', 1, 1),
  (51, 19, 51, 'SSA-WC305',    50000,   '2026-03-12', 1, 1),
  (52, 19, 52, 'SSA-WG100',    20000,   '2026-03-12', 1, 1),
  (53, 19, 53, 'SSA-AR120',    140000,  '2026-03-12', 1, 1),
  (54, 19, 54, 'SSA-BWW75',    35000,   '2026-03-12', 1, 1),
  (55, 19, 55, 'SSA-WCK75',    18000,   '2026-03-12', 1, 1),
  (56, 4,  56, 'BJM-RAG',      18000,   '2026-03-18', 1, 1),
  (57, 20, 57, 'ISP-GLV',      28000,   '2026-03-22', 1, 1),
  (58, 23, 58, 'CMP-FL27II',   8000000, '2026-03-25', 1, 1),
  (59, 22, 59, 'BAK-DX544',    7500000, '2026-03-26', 1, 1),
  (60, 8,  60, 'TMS-FREIGHT',  0,       NULL,         1, 1),
  -- SECONDARY vendors (alt suppliers) -------------------------------
  (101, 1,  1,  'ABC-PT16',    1280000, '2026-02-10', 1, 1),
  (102, 12, 5,  'BTI-WHS75',   340000,  '2026-03-01', 1, 1),
  (103, 14, 23, 'CEL-LED12',   30000,   '2026-04-02', 1, 1),
  (104, 14, 33, 'CEL-CHF15',   17000,   '2026-04-02', 1, 1),
  (105, 4,  6,  'BJM-WA250',   135000,  '2026-03-18', 1, 1),
  (106, 4,  7,  'BJM-WA150',   68000,   '2026-03-18', 1, 1),
  (107, 4,  53, 'BJM-AR120',   145000,  '2026-03-18', 1, 1),
  (108, 1,  44, 'ABC-PB22',    92000,   '2026-02-12', 1, 1),
  (109, 2,  56, 'CMS-RAG',     19000,   '2026-03-02', 1, 1),
  (110, 11, 5,  'CKM-WHS75',   320000,  '2026-03-04', 1, 1),
  (111, 11, 8,  'CKM-WCP24',   760000,  '2026-03-04', 1, 1),
  (112, 16, 22, 'PSL-SDH6',    360000,  '2026-03-30', 1, 1),
  (113, 24, 39, 'TSN-PVC50',   132000,  '2026-04-05', 1, 1),
  (114, 21, 23, 'JRS-LED12',   29000,   '2026-04-08', 1, 1),
  (115, 21, 24, 'JRS-LED8',    31000,   '2026-04-08', 1, 1),
  (116, 15, 31, 'APM-CL402',   1850000, '2026-03-15', 1, 1),
  (117, 15, 32, 'APM-HL26',    205000,  '2026-03-15', 1, 1),
  (118, 25, 4,  'GMS-PB12',    1150000, '2026-03-29', 1, 1),
  (119, 25, 58, 'GMS-FL27II',  8200000, '2026-03-29', 1, 1),
  (120, 10, 34, 'MIN-PR2P',    40000,   '2026-03-05', 1, 1),
  (121, 10, 50, 'MIN-LT401',   38000,   '2026-03-05', 1, 1),
  (122, 6,  59, 'AME-DX544',   7600000, '2026-03-19', 1, 1);

SELECT setval('vendor_products_id_seq', GREATEST((SELECT MAX(id) FROM vendor_products), 1));


-- 7. QUOTATIONS — 25 (mix of statuses, multiple per top clients)
-- =============================================================================
-- ID 1 = real Q-264128 (anchor of demo dataset).
-- discount_pct uses 0..100 scale (5 = 5%).
-- total_produk + total_discount drive the GENERATED columns subtotal/dpp/ppn/grand_total.
INSERT INTO quotations (
  id, quotation_no, version, parent_id, company_client_id, company_client_name,
  contact_id, contact_name, client_ref_no, vessel_name, status,
  payment_terms, validity_days, discount_pct,
  total_produk, total, total_discount,
  notes, created_by, updated_by, created_at, updated_at
) VALUES
  -- 1. REAL Q-264128 (subset 13 lines, IMC)
  (1,  'Q-264128/GNS/IV/2026',    1, NULL, 1, 'PT. IMC Ship Management',
       1, 'Bp. Restu Umar Singgih', '8404/V-0006/REQ26', 'MV YUXIN SATU', 'accepted',
       '30 days', 3, 5,
       8141000, 8141000, 407050,
       'Subset 13 baris dari 117 baris original PDF. Untuk demo full lifecycle.',
       5, 5, '2026-04-01 09:00:00+07', '2026-04-08 14:30:00+07'),

  -- 2-5. IMC additional quotations
  (2,  'Q-264201/GNS/IV/2026',    1, NULL, 1, 'PT. IMC Ship Management',
       1, 'Bp. Restu Umar Singgih', '8404/V-0010/REQ26', 'MV YUXIN DUA', 'sent',
       '30 days', 5, 5, 12500000, 12500000, 625000,
       'Penawaran electrical store batch ke-2.', 5, 5,
       '2026-04-15 10:00:00+07', '2026-04-18 11:00:00+07'),
  (3,  'Q-264202/GNS/IV/2026',    1, NULL, 1, 'PT. IMC Ship Management',
       2, 'Bp. Hadi Santoso',      '8404/V-0011/REQ26', 'MV YUXIN TIGA', 'draft',
       '30 days', 7, 0, 4350000, 4350000, 0,
       'Quick deck supplies request.', 5, 5,
       '2026-04-22 14:00:00+07', '2026-04-22 14:00:00+07'),
  (4,  'Q-264015/GNS/III/2026',   1, NULL, 1, 'PT. IMC Ship Management',
       3, 'Ibu Lina Pertiwi',      '8404/V-0002/REQ26', 'MV YUXIN SATU', 'rejected',
       '30 days', 3, 5, 5800000, 5800000, 290000,
       'Ditolak karena harga tidak match dengan vendor sebelah.', 5, 5,
       '2026-03-08 09:00:00+07', '2026-03-15 16:00:00+07'),
  (5,  'Q-264025/GNS/III/2026',   2, NULL, 1, 'PT. IMC Ship Management',
       1, 'Bp. Restu Umar Singgih', '8404/V-0004/REQ26', 'MV YUXIN SATU', 'accepted',
       '30 days', 3, 5, 9275000, 9275000, 463750,
       'Versi revisi dari Q-264020 (revisi diskon 3%->5%).', 5, 5,
       '2026-03-18 10:30:00+07', '2026-03-25 09:15:00+07'),

  -- 6-7. Yuxin direct quotations (rare; usually IMC bills via Yuxin)
  (6,  'Q-077901/GNS/VII/2025',   1, NULL, 2, 'PT. Yuxin Shipping Line',
       4, 'Ibu Wati Kurniawan',    'YX-2025-EQ-118', 'MV YUXIN SATU', 'accepted',
       '30 days', 3, 5, 162010000, 162010000, 8100500,
       'REAL: source for invoice 077/INV-GNS-8/2025 (electrical store, 51 lines).',
       5, 5, '2025-07-25 09:00:00+07', '2025-08-01 10:00:00+07'),
  (7,  'Q-078101/GNS/IX/2025',    1, NULL, 2, 'PT. Yuxin Shipping Line',
       5, 'Bp. Tono Setiawan',     'YX-2025-CONS-09', 'MV YUXIN DUA', 'accepted',
       '30 days', 3, 5, 7800000, 7800000, 390000,
       'Consumables refill triwulan 3.', 5, 5,
       '2025-09-12 11:00:00+07', '2025-09-20 14:00:00+07'),

  -- 8-9. Transcoal Pacific (shipping service)
  (8,  'Q-106101/GNS/I/2026',     1, NULL, 3, 'PT. Transcoal Pacific',
       6, 'Bp. Andi Saputra',      'TCP/XII/2025-00358', NULL, 'accepted',
       '30 days', 7, 0, 1450000, 1450000, 0,
       'Pengiriman item ke Sangatta. REAL invoice 10611/INV-GNS-1/2026.',
       5, 5, '2026-01-05 14:00:00+07', '2026-01-08 09:30:00+07'),
  (9,  'Q-106201/GNS/II/2026',    1, NULL, 3, 'PT. Transcoal Pacific',
       7, 'Ibu Sari Indah',        'TCP/I/2026-00422', NULL, 'sent',
       '30 days', 14, 0, 2100000, 2100000, 0,
       'Pengiriman engine spare ke Balikpapan.', 5, 5,
       '2026-02-10 13:00:00+07', '2026-02-12 11:00:00+07'),

  -- 10-25. Other clients spread across statuses
  (10, 'Q-330101/GNS/III/2026',   1, NULL, 4, 'PT. Bahari Sandi Pratama',
       8, 'Bp. Budi Hartono',      'BSP-VR-25', 'KM BAHARI 12', 'accepted',
       '30 days', 5, 5, 18250000, 18250000, 912500,
       'Tools & lighting MV Bahari 12.', 5, 5,
       '2026-03-02 09:00:00+07', '2026-03-12 15:00:00+07'),
  (11, 'Q-330201/GNS/IV/2026',    1, NULL, 5, 'PT. Samudra Anugerah Sejati',
       10, 'Bp. Rio Pratama',      'SAS-VR-08', 'TB Samudra 5', 'sent',
       '30 days', 7, 5, 9750000, 9750000, 487500,
       'Engine room consumables.', 6, 6,
       '2026-04-05 11:00:00+07', '2026-04-10 16:00:00+07'),
  (12, 'Q-330301/GNS/IV/2026',    1, NULL, 6, 'PT. Cipta Bahtera Pelayaran',
       12, 'Bp. Joko Susilo',      'CBP-2026-031', 'KM Cipta Jaya', 'draft',
       '30 days', 3, 0, 3550000, 3550000, 0,
       'Quick paint & cleaning supplies.', 6, 6,
       '2026-04-18 09:30:00+07', '2026-04-18 09:30:00+07'),
  (13, 'Q-330401/GNS/III/2026',   1, NULL, 7, 'PT. Karya Laut Mandiri',
       13, 'Ibu Nina Anggraini',   'KLM-V-2026-04', 'TB Karya 8', 'accepted',
       '30 days', 5, 5, 22500000, 22500000, 1125000,
       'Electrical store + lighting upgrade.', 6, 6,
       '2026-03-10 10:00:00+07', '2026-03-22 13:00:00+07'),
  (14, 'Q-330501/GNS/II/2026',    1, NULL, 8, 'PT. Surya Maritim Nusantara',
       14, 'Bp. Eko Prasetyo',     'SMN-OPS-218', 'MV Surya 3', 'rejected',
       '30 days', 3, 0, 7800000, 7800000, 0,
       'Client memilih vendor lain (kalah harga).', 6, 6,
       '2026-02-04 14:00:00+07', '2026-02-10 09:00:00+07'),
  (15, 'Q-330601/GNS/IV/2026',    1, NULL, 9, 'PT. Pelayaran Bintang Timur Sukses',
       16, 'Bp. Reza Anugerah',    'PBT-VR-2026-09', 'KM Bintang 21', 'sent',
       '30 days', 7, 5, 14200000, 14200000, 710000,
       'Bridge & deck tools.', 6, 6,
       '2026-04-12 09:00:00+07', '2026-04-16 11:30:00+07'),
  (16, 'Q-330701/GNS/III/2026',   1, NULL, 10, 'PT. Niaga Bahari Lestari',
       17, 'Bp. Yudi Wibowo',      'NBL-2026-017', 'MV Niaga 7', 'accepted',
       '30 days', 5, 5, 11800000, 11800000, 590000,
       'Workshop tools refresh.', 7, 7,
       '2026-03-14 10:00:00+07', '2026-03-25 14:00:00+07'),
  (17, 'Q-330801/GNS/IV/2026',    1, NULL, 11, 'PT. Andalan Samudera Pratama',
       18, 'Ibu Dewi Anggraini',   'ASP-VR-2026-011', 'MV Andalan 4', 'draft',
       '30 days', 7, 0, 5250000, 5250000, 0,
       'Cleaning supplies + small tools.', 7, 7,
       '2026-04-23 14:00:00+07', '2026-04-23 14:00:00+07'),
  (18, 'Q-330901/GNS/II/2026',    1, NULL, 12, 'PT. Mitra Pelayaran Khatulistiwa',
       19, 'Bp. Andre Halim',      'MPK-2026-005', 'KM Mitra 11', 'expired',
       '30 days', 3, 0, 6500000, 6500000, 0,
       'Penawaran kadaluarsa, tidak ada follow-up.', 7, 7,
       '2026-02-08 09:00:00+07', '2026-02-12 12:00:00+07'),
  (19, 'Q-331001/GNS/III/2026',   1, NULL, 13, 'PT. Pulau Seroja Marine',
       20, 'Ibu Lia Permata',      'PSM-VR-2026-022', 'TB Seroja 3', 'revision',
       '30 days', 5, 0, 8400000, 8400000, 0,
       'Pending revision: client minta penambahan 5 line item.', 7, 7,
       '2026-03-20 11:00:00+07', '2026-03-28 16:00:00+07'),
  (20, 'Q-331101/GNS/IV/2026',    1, NULL, 14, 'PT. Bahari Megah Lautan',
       21, 'Bp. Surya Putra',      'BML-2026-VR-013', 'MV Bahari Megah 1', 'accepted',
       '30 days', 7, 5, 16850000, 16850000, 842500,
       'Electrical + lighting full set.', 7, 7,
       '2026-04-08 09:30:00+07', '2026-04-19 10:00:00+07'),
  (21, 'Q-331201/GNS/IV/2026',    1, NULL, 15, 'PT. Nusantara Lintas Bahari',
       22, 'Bp. Faisal Akbar',     'NLB-VR-2026-018', 'KM Nusantara 9', 'draft',
       '30 days', 5, 0, 4750000, 4750000, 0,
       'Quick request: cable & terminal strip.', 7, 7,
       '2026-04-21 13:00:00+07', '2026-04-21 13:00:00+07'),
  (22, 'Q-331301/GNS/III/2026',   1, NULL, 16, 'PT. Kapuas Marine Service',
       23, 'Bp. Iwan Setyo',       'KMS-VR-2026-007', 'TB Kapuas 5', 'rejected',
       '30 days', 3, 0, 3250000, 3250000, 0,
       'Client cancel project.', 7, 7,
       '2026-03-08 10:00:00+07', '2026-03-15 14:00:00+07'),
  (23, 'Q-331401/GNS/IV/2026',    2, 19,   13, 'PT. Pulau Seroja Marine',
       20, 'Ibu Lia Permata',      'PSM-VR-2026-022-R1', 'TB Seroja 3', 'sent',
       '30 days', 5, 0, 12200000, 12200000, 0,
       'Revisi Q-331001 (5 line item tambahan).', 7, 7,
       '2026-04-02 09:30:00+07', '2026-04-05 11:00:00+07'),
  (24, 'Q-332101/GNS/IV/2026',    1, NULL, 24, 'Sapphire Seas Maritime Pte Ltd',
       29, 'Mr. Lim Wei Sheng',    'SSM-PR-2026-088', 'MV Sapphire 2', 'sent',
       '45 days', 7, 5, 32500000, 32500000, 1625000,
       'Singapore client, FOB Tanjung Priok.', 5, 5,
       '2026-04-10 09:00:00+07', '2026-04-14 10:00:00+07'),
  (25, 'Q-332201/GNS/IV/2026',    1, NULL, 25, 'Pelita Trans Logistics Sdn Bhd',
       30, 'Mr. Ahmad Rizal',      'PTL-PR-2026-032', NULL, 'draft',
       '45 days', 14, 0, 7800000, 7800000, 0,
       'Malaysian inquiry, awaiting confirmation.', 5, 5,
       '2026-04-24 10:00:00+07', '2026-04-24 10:00:00+07');

SELECT setval('quotations_id_seq', GREATEST((SELECT MAX(id) FROM quotations), 1));


-- 8. QUOTATION ITEMS — 122 lines distributed across 25 quotations
-- =============================================================================
-- CONVENTION: vendor_product_id == offered_item_id (always primary vendor).
-- Explicit qi.id assigned 1..122 so PO_items / invoice_items can reference safely.
-- discount_pct on items is auto-inherited from header via trigger (00010).
-- Generated columns (total_selling, discount_amount, subtotal, profit_*) are computed by DB.
INSERT INTO quotation_items (
  id, quotation_id, line_number, item_type,
  requested_item_id, requested_impa, requested_name,
  offered_item_id, vendor_product_id,
  qty, unit_id, selling_price, cost_price,
  created_by, updated_by
) VALUES
  -- Q1: Q-264128 (qi 1..13) — REAL Q-264128
  (1,  1, 1,  'product', 1,  '613802', 'PUNCHING TOOL SET DIES & TABLE, 6-38MM 16S',         1,  1,  1,  19, 2000000, 1200000, 5, 5),
  (2,  1, 2,  'product', 44, NULL,     'PRUSIAN BLUE Permatex 22ml (Tube)',                  44, 44, 10, 35, 145000,  90000,   5, 5),
  (3,  1, 3,  'product', 45, NULL,     'CARBORUNDUM PASTE GRIT#2000, MICRO FINE 450GRM',     45, 45, 1,  34, 68000,   40000,   5, 5),
  (4,  1, 4,  'product', 46, NULL,     'CARBORUNDUM PASTE GRIT#1500, MICRO FINE 450GRM',     46, 46, 1,  34, 68000,   40000,   5, 5),
  (5,  1, 5,  'product', 47, NULL,     'CARBORUNDUM PASTE GRIT#800, MICRO FINE 450GRM',      47, 47, 1,  34, 68000,   40000,   5, 5),
  (6,  1, 6,  'product', 2,  NULL,     'PULLER GEAR & WHEEL 3-ARM, 0-200MM TEKIRO 8"',       2,  2,  1,  19, 750000,  450000,  5, 5),
  (7,  1, 7,  'product', 3,  NULL,     'PULLER GEAR & WHEEL 3-ARM, 0-150MM TEKIRO 6"',       3,  3,  1,  19, 445000,  270000,  5, 5),
  (8,  1, 8,  'product', 5,  NULL,     'WRENCH HOOK SPANNER 65-75MM, CARBON STEEL',          5,  5,  3,  21, 535000,  330000,  5, 5),
  (9,  1, 9,  'product', 9,  NULL,     'PLIER SIDE CUTTING 175MM TEKIRO',                    9,  9,  3,  21, 100000,  60000,   5, 5),
  (10, 1, 10, 'product', 10, NULL,     'PLIER LONG-NOSE 200MM TEKIRO',                       10, 10, 2,  21, 115000,  70000,   5, 5),
  (11, 1, 11, 'product', 23, '790268', 'LAMP LED 12W (100W) 220V E-27, COOL WHITE',          23, 23, 50, 21, 48000,   28000,   5, 5),
  (12, 1, 12, 'product', 24, '790265', 'LAMP LED 8W (60W) 220V E-27, COOL WHITE',            24, 24, 50, 21, 50000,   30000,   5, 5),
  (13, 1, 13, 'product', 25, '791836', 'FLOODLIGHT FIXTURE LED SLD-150',                     25, 25, 10, 19, 450000,  270000,  5, 5),

  -- Q2: IMC electrical batch 2 (qi 14..19)
  (14, 2, 1, 'product', 23, '790268', 'LAMP LED 12W 220V E-27 COOL WHITE',     23, 23, 100, 21, 50000,   28000,   5, 5),
  (15, 2, 2, 'product', 24, '790265', 'LAMP LED 8W 220V E-27 COOL WHITE',      24, 24, 100, 21, 52000,   30000,   5, 5),
  (16, 2, 3, 'product', 31, '791887', 'FL CEILING LIGHT KEW402 40WX2',         31, 31, 5,   21, 2950000, 1800000, 5, 5),
  (17, 2, 4, 'product', 33, '794283', 'CABLE HF-CXO 0.6/1KV 1.5MM2X3C',        33, 33, 100, 13, 25000,   16000,   5, 5),
  (18, 2, 5, 'product', 39, NULL,     'TAPE PVC INSULATION 50MMX20MTR BLACK',  39, 39, 60,  33, 210000,  130000,  5, 5),
  (19, 2, 6, 'shipping', NULL, NULL,  'JASA PENGIRIMAN KE PORT',               60, 60, 1,   33, 350000,  0,       5, 5),

  -- Q3: IMC deck supplies (qi 20..23) DRAFT
  (20, 3, 1, 'product', 49, NULL,     'LUBRICANT SPRAY WD-40 333ML',           49, 49, 24, 34, 120000, 72000,   5, 5),
  (21, 3, 2, 'product', 56, NULL,     'KAIN MAJUN PUTIH JAHIT TUMPUK',         56, 56, 50, 33, 25000,  18000,   5, 5),
  (22, 3, 3, 'product', 57, NULL,     'GLOVES WORKING COTTON 12 PAIRS',        57, 57, 12, 17, 42000,  28000,   5, 5),
  (23, 3, 4, 'product', 39, NULL,     'TAPE PVC INSULATION 50MMX20M',          39, 39, 6,  33, 210000, 130000,  5, 5),

  -- Q4: IMC rejected (qi 24..26)
  (24, 4, 1, 'product', 21, '612366', 'NUT DRIVER SET 5-12MM 7''S',            21, 21, 4, 19, 300000,  180000,  5, 5),
  (25, 4, 2, 'product', 4,  '615082', 'PULLER BEARING KIT 00-12',              4,  4,  2, 19, 1750000, 1100000, 5, 5),
  (26, 4, 3, 'product', 8,  NULL,     'WRENCH CHAIN PIPE 24"',                 8,  8,  1, 21, 1200000, 750000,  5, 5),

  -- Q5: IMC accepted revision (qi 27..32)
  (27, 5, 1, 'product', 23, '790268', 'LAMP LED 12W 220V E-27',                23, 23, 50, 21, 48000,   28000,   5, 5),
  (28, 5, 2, 'product', 24, '790265', 'LAMP LED 8W 220V E-27',                 24, 24, 50, 21, 50000,   30000,   5, 5),
  (29, 5, 3, 'product', 25, '791836', 'FLOODLIGHT FIXTURE LED SLD-150',        25, 25, 5,  19, 450000,  270000,  5, 5),
  (30, 5, 4, 'product', 32, '792151', 'HAND LAMP WATERTIGHT E-26 60W',         32, 32, 4,  21, 320000,  200000,  5, 5),
  (31, 5, 5, 'product', 34, '792925', 'PLUG & DOUBLE RECEPTACLE 2-ROUND PIN',  34, 34, 10, 19, 60000,   38000,   5, 5),
  (32, 5, 6, 'product', 11, '615881', 'PLIER DIAGONAL CUTTING 150MM',          11, 11, 3,  21, 100000,  65000,   5, 5),

  -- Q6: REAL Yuxin invoice 077 source — 15 highlight lines (qi 33..47)
  (33, 6, 1,  'product', 9,  '615870', 'PLIER SIDE CUTTING 175MM',             9,  9,  1,   21, 350000,  60000,   5, 5),
  (34, 6, 2,  'product', 10, '615876', 'PLIER LONG-NOSE 200MM',                10, 10, 1,   21, 375000,  70000,   5, 5),
  (35, 6, 3,  'product', 11, '615881', 'PLIER DIAGONAL CUTTING 150MM',         11, 11, 1,   21, 340000,  65000,   5, 5),
  (36, 6, 4,  'product', 23, '790268', 'LAMP LED 12W 220V E-27',               23, 23, 50,  21, 48000,   28000,   5, 5),
  (37, 6, 5,  'product', 25, '791836', 'FLOODLIGHT FIXTURE LED SLD-150',       25, 25, 10,  19, 450000,  270000,  5, 5),
  (38, 6, 6,  'product', 24, '790265', 'LAMP LED 8W 220V E-27',                24, 24, 50,  21, 50000,   30000,   5, 5),
  (39, 6, 7,  'product', 32, '792151', 'HAND LAMP WATERTIGHT E-26 60W',        32, 32, 2,   21, 320000,  200000,  5, 5),
  (40, 6, 8,  'product', 34, '792925', 'PLUG & DOUBLE RECEPTACLE 2-ROUND PIN', 34, 34, 10,  19, 60000,   38000,   5, 5),
  (41, 6, 9,  'product', 33, '794283', 'CABLE HF-CXO 0.6/1KV 1.5MM2X3C',       33, 33, 100, 13, 25000,   16000,   5, 5),
  (42, 6, 10, 'product', 21, '612366', 'NUT DRIVER SET 5-12MM 7S',             21, 21, 2,   19, 300000,  180000,  5, 5),
  (43, 6, 11, 'product', 4,  '615082', 'PULLER BEARING KIT 00-12',             4,  4,  1,   19, 1750000, 1100000, 5, 5),
  (44, 6, 12, 'product', 27, '791272', 'LAMP HALOGEN E-39 200-240V 500W',      27, 27, 30,  21, 250000,  160000,  5, 5),
  (45, 6, 13, 'product', 31, '791887', 'FL CEILING LIGHT KEW402 40WX2',        31, 31, 5,   21, 2950000, 1800000, 5, 5),
  (46, 6, 14, 'product', 26, NULL,     'FLOODLIGHT LED 200W 100-240V',         26, 26, 10,  19, 760000,  460000,  5, 5),
  (47, 6, 15, 'product', 38, NULL,     'CABLE REEL EXTENSION AC220V 50MTR',    38, 38, 2,   19, 2000000, 1300000, 5, 5),

  -- Q7: Yuxin consumables (qi 48..51)
  (48, 7, 1, 'product', 49, NULL,     'LUBRICANT SPRAY WD-40 333ML',           49, 49, 24, 34, 120000, 72000,  5, 5),
  (49, 7, 2, 'product', 39, NULL,     'TAPE PVC INSULATION 50MMX20M',          39, 39, 20, 33, 210000, 130000, 5, 5),
  (50, 7, 3, 'product', 50, NULL,     'GLUE LOCTITE 401 INSTANT 20GRM',        50, 50, 10, 37, 60000,  36000,  5, 5),
  (51, 7, 4, 'product', 56, NULL,     'KAIN MAJUN PUTIH',                      56, 56, 30, 33, 25000,  18000,  5, 5),

  -- Q8: Transcoal Pacific shipping (qi 52)
  (52, 8, 1, 'shipping', NULL, NULL,  'Pengiriman item PO-TCP/XII/2025-00358 ke Sangatta', 60, 60, 1, 33, 1450000, 0, 5, 5),

  -- Q9: Transcoal Pacific shipping (qi 53)
  (53, 9, 1, 'shipping', NULL, NULL,  'Pengiriman engine spare ke Balikpapan', 60, 60, 1, 33, 2100000, 0, 5, 5),

  -- Q10: Bahari Sandi accepted (qi 54..60)
  (54, 10, 1, 'product', 1, '613802', 'PUNCHING TOOL SET 6-38MM 16S',          1,  1,  1,  19, 2200000, 1280000, 6, 6),
  (55, 10, 2, 'product', 6, NULL,     'WRENCH ADJUSTABLE 250MM',               6,  6,  4,  21, 220000,  130000,  6, 6),
  (56, 10, 3, 'product', 7, NULL,     'WRENCH ADJUSTABLE 150MM',               7,  7,  4,  21, 110000,  65000,   6, 6),
  (57, 10, 4, 'product', 16, NULL,    'SCREWDRIVER INSULATED 8X150MM VESSEL',  16, 16, 6,  21, 300000,  180000,  6, 6),
  (58, 10, 5, 'product', 17, NULL,    'SCREWDRIVER INSULATED 9X200MM VESSEL',  17, 17, 6,  21, 325000,  200000,  6, 6),
  (59, 10, 6, 'product', 23, '790268','LAMP LED 12W',                          23, 23, 30, 21, 50000,   28000,   6, 6),
  (60, 10, 7, 'product', 25, '791836','FLOODLIGHT LED SLD-150',                25, 25, 4,  19, 460000,  270000,  6, 6),

  -- Q11: Samudra engine room (qi 61..65)
  (61, 11, 1, 'product', 49, NULL,    'LUBRICANT WD-40',                       49, 49, 36,  34, 125000, 72000,  6, 6),
  (62, 11, 2, 'product', 44, NULL,    'PRUSIAN BLUE Permatex 22ml',            44, 44, 24,  35, 150000, 92000,  6, 6),
  (63, 11, 3, 'product', 56, NULL,    'KAIN MAJUN',                            56, 56, 100, 33, 26000,  18000,  6, 6),
  (64, 11, 4, 'product', 50, NULL,    'GLUE LOCTITE 401',                      50, 50, 12,  37, 62000,  36000,  6, 6),
  (65, 11, 5, 'product', 39, NULL,    'TAPE PVC INSULATION',                   39, 39, 12,  33, 215000, 130000, 6, 6),

  -- Q12: Cipta Bahtera (qi 66..68) DRAFT
  (66, 12, 1, 'product', 53, NULL,    'AMPLAS ROLL 50MMX45M #120',             53, 53, 3,  39, 240000, 140000, 6, 6),
  (67, 12, 2, 'product', 54, NULL,    'BRUSH WIRE WHEEL 75MMX3/8"',            54, 54, 10, 21, 60000,  35000,  6, 6),
  (68, 12, 3, 'product', 57, NULL,    'GLOVES COTTON 12 PAIRS',                57, 57, 24, 17, 45000,  28000,  6, 6),

  -- Q13: Karya Laut electrical (qi 69..74)
  (69, 13, 1, 'product', 23, '790268','LAMP LED 12W',                          23, 23, 50,  21, 48000,   28000,   6, 6),
  (70, 13, 2, 'product', 31, '791887','FL CEILING LIGHT KEW402',               31, 31, 8,   21, 3000000, 1800000, 6, 6),
  (71, 13, 3, 'product', 33, '794283','CABLE HF-CXO 1.5MM2X3C',                33, 33, 200, 13, 25000,   16000,   6, 6),
  (72, 13, 4, 'product', 35, NULL,    'PLUG CEE FEMALE 380V 32A',              35, 35, 10,  21, 185000,  115000,  6, 6),
  (73, 13, 5, 'product', 36, NULL,    'PLUG CEE MALE 380V 32A',                36, 36, 10,  21, 185000,  115000,  6, 6),
  (74, 13, 6, 'product', 28, '791517','LAMP COMPACT FL 11W',                   28, 28, 100, 21, 60000,   38000,   6, 6),

  -- Q14: Surya rejected (qi 75..78)
  (75, 14, 1, 'product', 22, NULL,    'SCREWDRIVER HAMMERING 6 BITS ARCA',     22, 22, 4, 19, 575000,  350000,  6, 6),
  (76, 14, 2, 'product', 4, '615082', 'PULLER BEARING KIT 00-12',              4,  4,  2, 19, 1800000, 1100000, 6, 6),
  (77, 14, 3, 'product', 21, '612366','NUT DRIVER SET 5-12MM',                 21, 21, 4, 19, 290000,  180000,  6, 6),
  (78, 14, 4, 'product', 8, NULL,     'WRENCH CHAIN PIPE 24"',                 8,  8,  1, 21, 1250000, 750000,  6, 6),

  -- Q15: Bintang Timur tools (qi 79..85)
  (79, 15, 1, 'product', 16, NULL,    'SCREWDRIVER INSULATED 8X150MM',         16, 16, 6,  21, 320000, 180000, 6, 6),
  (80, 15, 2, 'product', 17, NULL,    'SCREWDRIVER INSULATED 9X200MM',         17, 17, 6,  21, 350000, 200000, 6, 6),
  (81, 15, 3, 'product', 18, NULL,    'SCREWDRIVER INSULATED 10X250MM',        18, 18, 6,  21, 240000, 140000, 6, 6),
  (82, 15, 4, 'product', 19, NULL,    'SCREWDRIVER PHILLIPS NO.3 150MM',       19, 19, 6,  21, 320000, 180000, 6, 6),
  (83, 15, 5, 'product', 21, '612366','NUT DRIVER SET 5-12MM',                 21, 21, 2,  19, 305000, 180000, 6, 6),
  (84, 15, 6, 'product', 9, '615870', 'PLIER SIDE CUTTING 175MM',              9,  9,  6,  21, 105000, 60000,  6, 6),
  (85, 15, 7, 'product', 49, NULL,    'WD-40 SPRAY 333ML',                     49, 49, 24, 34, 125000, 72000,  6, 6),

  -- Q16: Niaga Bahari accepted (qi 86..91)
  (86, 16, 1, 'product', 1, '613802', 'PUNCHING TOOL SET 6-38MM 16S',          1,  1,  1,  19, 2100000, 1200000, 7, 7),
  (87, 16, 2, 'product', 2, NULL,     'PULLER GEAR 3-ARM 0-200MM',             2,  2,  2,  19, 760000,  450000,  7, 7),
  (88, 16, 3, 'product', 3, NULL,     'PULLER GEAR 3-ARM 0-150MM',             3,  3,  2,  19, 450000,  270000,  7, 7),
  (89, 16, 4, 'product', 22, NULL,    'SCREWDRIVER HAMMERING 6 BITS',          22, 22, 2,  19, 580000,  350000,  7, 7),
  (90, 16, 5, 'product', 21, '612366','NUT DRIVER SET 5-12MM',                 21, 21, 4,  19, 300000,  180000,  7, 7),
  (91, 16, 6, 'product', 16, NULL,    'SCREWDRIVER INSULATED 8X150',           16, 16, 12, 21, 305000,  180000,  7, 7),

  -- Q17: Andalan DRAFT (qi 92..95)
  (92, 17, 1, 'product', 56, NULL,    'KAIN MAJUN',                            56, 56, 60, 33, 27000,  18000,  7, 7),
  (93, 17, 2, 'product', 57, NULL,    'GLOVES COTTON',                         57, 57, 24, 17, 45000,  28000,  7, 7),
  (94, 17, 3, 'product', 49, NULL,    'WD-40 333ML',                           49, 49, 12, 34, 130000, 72000,  7, 7),
  (95, 17, 4, 'product', 39, NULL,    'TAPE PVC INSULATION',                   39, 39, 8,  33, 215000, 130000, 7, 7),

  -- Q18: Mitra expired (qi 96..98)
  (96, 18, 1, 'product', 23, '790268','LAMP LED 12W',                          23, 23, 30, 21, 50000,  28000,  7, 7),
  (97, 18, 2, 'product', 24, '790265','LAMP LED 8W',                           24, 24, 30, 21, 52000,  30000,  7, 7),
  (98, 18, 3, 'product', 25, '791836','FLOODLIGHT LED SLD-150',                25, 25, 4,  19, 460000, 270000, 7, 7),

  -- Q19: Pulau Seroja revision (qi 99..101)
  (99, 19, 1, 'product', 23, '790268','LAMP LED 12W',                          23, 23, 30, 21, 48000,   28000,   7, 7),
  (100,19, 2, 'product', 33, '794283','CABLE HF-CXO 1.5MM2X3C',                33, 33, 80, 13, 26000,   16000,   7, 7),
  (101,19, 3, 'product', 31, '791887','FL CEILING LIGHT KEW402',               31, 31, 2,  21, 2950000, 1800000, 7, 7),

  -- Q20: Bahari Megah accepted (qi 102..106)
  (102,20, 1, 'product', 23, '790268','LAMP LED 12W',                          23, 23, 100, 21, 49000,   28000,   7, 7),
  (103,20, 2, 'product', 24, '790265','LAMP LED 8W',                           24, 24, 100, 21, 51000,   30000,   7, 7),
  (104,20, 3, 'product', 31, '791887','FL CEILING LIGHT KEW402',               31, 31, 4,   21, 2950000, 1800000, 7, 7),
  (105,20, 4, 'product', 35, NULL,    'PLUG CEE FEMALE 380V 32A',              35, 35, 10,  21, 190000,  115000,  7, 7),
  (106,20, 5, 'product', 36, NULL,    'PLUG CEE MALE 380V 32A',                36, 36, 10,  21, 190000,  115000,  7, 7),

  -- Q21: Nusantara DRAFT (qi 107..108)
  (107,21, 1, 'product', 33, '794283','CABLE HF-CXO 1.5MM2X3C',                33, 33, 100, 13, 25000, 16000, 7, 7),
  (108,21, 2, 'product', 37, NULL,    'TERMINAL STRIP 12-POLE 380V 10A',       37, 37, 50,  21, 20000, 12000, 7, 7),

  -- Q22: Kapuas rejected (qi 109..111)
  (109,22, 1, 'product', 39, NULL,    'TAPE PVC INSULATION',                   39, 39, 10, 33, 215000, 130000, 7, 7),
  (110,22, 2, 'product', 40, NULL,    'CABLE TIE 200MM 100S',                  40, 40, 6,  36, 22000,  14000,  7, 7),
  (111,22, 3, 'product', 41, NULL,    'CABLE TIE 350MM 100S',                  41, 41, 6,  36, 43000,  28000,  7, 7),

  -- Q23: Pulau Seroja R1 sent (qi 112..116)
  (112,23, 1, 'product', 23, '790268','LAMP LED 12W',                          23, 23, 30, 21, 48000,   28000,   7, 7),
  (113,23, 2, 'product', 33, '794283','CABLE HF-CXO 1.5MM2X3C',                33, 33, 80, 13, 26000,   16000,   7, 7),
  (114,23, 3, 'product', 31, '791887','FL CEILING LIGHT KEW402',               31, 31, 2,  21, 2950000, 1800000, 7, 7),
  (115,23, 4, 'product', 25, '791836','FLOODLIGHT LED SLD-150',                25, 25, 4,  19, 460000,  270000,  7, 7),
  (116,23, 5, 'product', 32, '792151','HAND LAMP WATERTIGHT',                  32, 32, 2,  21, 320000,  200000,  7, 7),

  -- Q24: Sapphire Seas SG (qi 117..119)
  (117,24, 1, 'product', 58, NULL,    'MULTI TESTER FLUKE 27II',               58, 58, 2, 19, 12500000, 8000000, 5, 5),
  (118,24, 2, 'product', 59, NULL,    'RADIO HAND MARINE ENTEL DX544 IS',      59, 59, 1, 19, 11000000, 7500000, 5, 5),
  (119,24, 3, 'product', 4,  '615082','PULLER BEARING KIT 00-12',              4,  4,  1, 19, 1800000,  1100000, 5, 5),

  -- Q25: Pelita Trans Malaysia DRAFT (qi 120..122)
  (120,25, 1, 'product', 23, '790268','LAMP LED 12W',                          23, 23, 50,  21, 50000,  28000,  5, 5),
  (121,25, 2, 'product', 25, '791836','FLOODLIGHT LED SLD-150',                25, 25, 4,   19, 460000, 270000, 5, 5),
  (122,25, 3, 'product', 33, '794283','CABLE HF-CXO 1.5MM2X3C',                33, 33, 100, 13, 25000,  16000,  5, 5);

SELECT setval('quotation_items_id_seq', GREATEST((SELECT MAX(id) FROM quotation_items), 1));


-- 9. STATUS HISTORY — extra rows for the real Q-264128 to show full lifecycle.
-- =============================================================================
-- Other quotations get only the trigger's auto-row (single entry timeline).
-- For Q-264128, replace auto-row + insert proper transitions.
DELETE FROM quotation_status_history WHERE quotation_id = 1;
INSERT INTO quotation_status_history (quotation_id, from_status, to_status, note, changed_by, changed_at) VALUES
  (1, NULL,     'draft',    'Quotation dibuat',                  5, '2026-04-01 09:00:00+07'),
  (1, 'draft',  'sent',     'Dikirim ke client (email)',         5, '2026-04-02 14:30:00+07'),
  (1, 'sent',   'accepted', 'Disetujui via PO 8404/O-0079/P025', 5, '2026-04-08 14:30:00+07');

-- For 5 other story quotations: add transition rows after trigger's auto-row.
INSERT INTO quotation_status_history (quotation_id, from_status, to_status, note, changed_by, changed_at) VALUES
  (5,  'draft', 'sent',     'Sent to IMC',                  5, '2026-03-19 10:00:00+07'),
  (5,  'sent',  'accepted', 'Accepted',                     5, '2026-03-25 09:15:00+07'),
  (6,  'draft', 'sent',     'Sent ke Yuxin',                5, '2025-07-26 09:00:00+07'),
  (6,  'sent',  'accepted', 'Accepted by Yuxin',            5, '2025-08-01 10:00:00+07'),
  (10, 'draft', 'sent',     'Sent',                         6, '2026-03-04 10:00:00+07'),
  (10, 'sent',  'accepted', 'PO diterima',                  6, '2026-03-12 15:00:00+07'),
  (13, 'draft', 'sent',     'Dikirim',                      6, '2026-03-12 11:00:00+07'),
  (13, 'sent',  'accepted', 'Accepted',                     6, '2026-03-22 13:00:00+07'),
  (19, 'draft', 'sent',     'Dikirim ke Pulau Seroja',      7, '2026-03-22 11:00:00+07'),
  (19, 'sent',  'revision', 'Client minta tambah 5 line',   7, '2026-03-28 16:00:00+07');


-- 10. PURCHASE ORDERS — 18 from accepted/sent quotations
-- =============================================================================
INSERT INTO purchase_orders (
  id, po_number, quotation_id, company_client_id, contact_id,
  po_date, status, delivery_note_number, notes,
  created_by, updated_by
) VALUES
  -- PO from real Q-264128 (Q-264128 → PO 8404/O-0079/P025 from IMC)
  (1, 'PO-26264101/GNS/IV/2026', 1, 1, 1,
   '2026-04-05', 'DELIVERED', 'DN-26264101/GNS/IV/2026',
   'Original Client PO Ref: 8404/O-0079/P025. Delivery ke MV YUXIN SATU.', 5, 5),
  -- Q5 revision accepted
  (2, 'PO-26264102/GNS/III/2026', 5, 1, 1,
   '2026-03-26', 'DELIVERED', 'DN-26264102/GNS/III/2026',
   'Original Client PO Ref: 8404/O-0072/P025.', 5, 5),
  -- Yuxin Q6 → PO that backs invoice 077
  (3, 'PO-25077901/GNS/VIII/2025', 6, 2, 4,
   '2025-08-02', 'DELIVERED', 'DN-25077901/GNS/VIII/2025',
   'Electrical store full PO. Ship to MV YUXIN SATU via Yuxin.', 5, 5),
  -- Yuxin Q7 → PO
  (4, 'PO-25078101/GNS/IX/2025', 7, 2, 4,
   '2025-09-22', 'DELIVERED', 'DN-25078101/GNS/IX/2025',
   'Consumables refill triwulan 3.', 5, 5),
  -- Transcoal Q8 → PO (shipping)
  (5, 'PO-26106101/GNS/I/2026', 8, 3, 6,
   '2026-01-08', 'DELIVERED', 'DN-26106101/GNS/I/2026',
   'Pengiriman ke Sangatta TCP/XII/2025-00358.', 5, 5),
  -- Bahari Sandi Q10
  (6, 'PO-26330101/GNS/III/2026', 10, 4, 8,
   '2026-03-15', 'DELIVERED', 'DN-26330101/GNS/III/2026',
   'PO ref: BSP-VR-25/PO. Delivery ke KM BAHARI 12.', 6, 6),
  -- Karya Laut Q13
  (7, 'PO-26330401/GNS/III/2026', 13, 7, 13,
   '2026-03-25', 'UPLOADED', NULL,
   'PO ref: KLM-V-2026-04/PO. Awaiting delivery.', 6, 6),
  -- Niaga Bahari Q16
  (8, 'PO-26330701/GNS/III/2026', 16, 10, 17,
   '2026-03-27', 'DELIVERED', 'DN-26330701/GNS/III/2026',
   'PO ref: NBL-2026-017/PO.', 7, 7),
  -- Bahari Megah Q20
  (9, 'PO-26331101/GNS/IV/2026', 20, 14, 21,
   '2026-04-21', 'UPLOADED', NULL,
   'PO ref: BML-2026-VR-013/PO. In delivery.', 7, 7),
  -- Q2 IMC sent → preliminary PO
  (10,'PO-26264201/GNS/IV/2026', 2, 1, 1,
   '2026-04-19', 'PENDING', NULL,
   'PO awaiting upload from IMC procurement.', 5, 5),
  -- Bintang Timur Q15 → PO
  (11,'PO-26330601/GNS/IV/2026', 15, 9, 16,
   '2026-04-17', 'PENDING', NULL,
   'PO ref pending: PBT-VR-2026-09/PO.', 6, 6),
  -- Sapphire Seas SG Q24 → PO (sent stage)
  (12,'PO-26332101/GNS/IV/2026', 24, 24, 29,
   '2026-04-15', 'PENDING', NULL,
   'PO awaiting from Singapore. International shipment.', 5, 5),
  -- Samudra Q11 → PO
  (13,'PO-26330201/GNS/IV/2026', 11, 5, 10,
   '2026-04-12', 'PENDING', NULL,
   'PO ref: SAS-VR-08/PO awaiting.', 6, 6),
  -- IMC Q5 (additional PO; multiple POs per quotation possible)
  (14,'PO-26264103/GNS/III/2026', 5, 1, 1,
   '2026-03-30', 'DELIVERED', 'DN-26264103/GNS/III/2026',
   'Partial top-up.', 5, 5),
  -- Niaga Bahari second PO
  (15,'PO-26330702/GNS/IV/2026', 16, 10, 17,
   '2026-04-08', 'DELIVERED', 'DN-26330702/GNS/IV/2026',
   'Second batch from same Q-330701.', 7, 7),
  -- Pulau Seroja Q23 (R1) → PO
  (16,'PO-26331401/GNS/IV/2026', 23, 13, 20,
   '2026-04-08', 'PENDING', NULL,
   'PO awaiting from Pulau Seroja.', 7, 7),
  -- Yuxin Q6 partial second PO
  (17,'PO-25077902/GNS/IX/2025', 6, 2, 4,
   '2025-09-05', 'DELIVERED', 'DN-25077902/GNS/IX/2025',
   'Top-up sebagian dari Q-077901 yang belum tertagih.', 5, 5),
  -- Transcoal Q9 (sent) → PO pending
  (18,'PO-26106201/GNS/II/2026', 9, 3, 7,
   '2026-02-15', 'UPLOADED', NULL,
   'Pengiriman engine spare ke Balikpapan.', 5, 5);

SELECT setval('purchase_orders_id_seq', GREATEST((SELECT MAX(id) FROM purchase_orders), 1));


-- 11. PURCHASE ORDER ITEMS — ~70 lines distributed across 18 POs
-- =============================================================================
INSERT INTO purchase_order_items (
  po_id, quotation_item_id, line_number, item_type, offered_item_id,
  qty, unit_id, selling_price, cost_price, created_by, updated_by
) VALUES
  -- PO 1 (Q1 real, top 4 highest value: lines 11, 12, 13, 1)
  (1, 11, 1, 'product', 23, 50, 21, 48000,  28000,   5, 5),
  (1, 12, 2, 'product', 24, 50, 21, 50000,  30000,   5, 5),
  (1, 13, 3, 'product', 25, 10, 19, 450000, 270000,  5, 5),
  (1, 1,  4, 'product', 1,  1,  19, 2000000,1200000, 5, 5),
  -- PO 2 (Q5 IMC; lines 1, 2, 3, 5)
  (2, 27, 1, 'product', 23, 50, 21, 48000,  28000,   5, 5),
  (2, 28, 2, 'product', 24, 50, 21, 50000,  30000,   5, 5),
  (2, 29, 3, 'product', 25, 5,  19, 450000, 270000,  5, 5),
  (2, 31, 4, 'product', 34, 10, 19, 60000,  38000,   5, 5),
  -- PO 3 (Q6 Yuxin mirror of invoice 077; lines 1..6, 9, 12, 13)
  (3, 33, 1, 'product', 9,  1,  21, 350000, 60000,   5, 5),
  (3, 34, 2, 'product', 10, 1,  21, 375000, 70000,   5, 5),
  (3, 35, 3, 'product', 11, 1,  21, 340000, 65000,   5, 5),
  (3, 36, 4, 'product', 23, 50, 21, 48000,  28000,   5, 5),
  (3, 37, 5, 'product', 25, 10, 19, 450000, 270000,  5, 5),
  (3, 38, 6, 'product', 24, 50, 21, 50000,  30000,   5, 5),
  (3, 41, 7, 'product', 33, 100,13, 25000,  16000,   5, 5),
  (3, 44, 8, 'product', 27, 30, 21, 250000, 160000,  5, 5),
  (3, 45, 9, 'product', 31, 5,  21, 2950000,1800000, 5, 5),
  -- PO 4 (Q7 Yuxin consumables; all 4 lines)
  (4, 48, 1, 'product', 49, 24, 34, 120000, 72000,   5, 5),
  (4, 49, 2, 'product', 39, 20, 33, 210000, 130000,  5, 5),
  (4, 50, 3, 'product', 50, 10, 37, 60000,  36000,   5, 5),
  (4, 51, 4, 'product', 56, 30, 33, 25000,  18000,   5, 5),
  -- PO 5 (Q8 Transcoal shipping)
  (5, 52, 1, 'shipping', 60, 1, 33, 1450000, 0,       5, 5),
  -- PO 6 (Q10 Bahari Sandi; lines 1..3, 6, 7)
  (6, 54, 1, 'product', 1,  1, 19, 2200000, 1280000, 6, 6),
  (6, 55, 2, 'product', 6,  4, 21, 220000, 130000, 6, 6),
  (6, 56, 3, 'product', 7,  4, 21, 110000, 65000,  6, 6),
  (6, 59, 4, 'product', 23, 30, 21, 50000, 28000,  6, 6),
  (6, 60, 5, 'product', 25, 4, 19, 460000, 270000, 6, 6),
  -- PO 7 (Q13 Karya Laut; lines 1..3)
  (7, 69, 1, 'product', 23, 50, 21, 48000, 28000,    6, 6),
  (7, 70, 2, 'product', 31, 8,  21, 3000000, 1800000, 6, 6),
  (7, 71, 3, 'product', 33, 200, 13, 25000, 16000,    6, 6),
  -- PO 8 (Q16 Niaga Bahari; lines 1..5)
  (8, 86, 1, 'product', 1,  1,  19, 2100000, 1200000, 7, 7),
  (8, 87, 2, 'product', 2,  2,  19, 760000,  450000,  7, 7),
  (8, 88, 3, 'product', 3,  2,  19, 450000,  270000,  7, 7),
  (8, 89, 4, 'product', 22, 2,  19, 580000,  350000,  7, 7),
  (8, 90, 5, 'product', 21, 4,  19, 300000,  180000,  7, 7),
  -- PO 9 (Q20 Bahari Megah; lines 1..4)
  (9, 102,1, 'product', 23, 100, 21, 49000,   28000,   7, 7),
  (9, 103,2, 'product', 24, 100, 21, 51000,   30000,   7, 7),
  (9, 104,3, 'product', 31, 4,   21, 2950000, 1800000, 7, 7),
  (9, 105,4, 'product', 35, 10,  21, 190000,  115000,  7, 7),
  -- PO 10 (Q2 IMC pending; lines 1..3)
  (10,14, 1, 'product', 23, 100, 21, 50000,   28000,   5, 5),
  (10,15, 2, 'product', 24, 100, 21, 52000,   30000,   5, 5),
  (10,16, 3, 'product', 31, 5,   21, 2950000, 1800000, 5, 5),
  -- PO 11 (Q15 Bintang Timur; lines 1..3)
  (11,79, 1, 'product', 16, 6, 21, 320000, 180000, 6, 6),
  (11,80, 2, 'product', 17, 6, 21, 350000, 200000, 6, 6),
  (11,81, 3, 'product', 18, 6, 21, 240000, 140000, 6, 6),
  -- PO 12 (Q24 Sapphire SG; lines 1..2)
  (12,117,1, 'product', 58, 2, 19, 12500000, 8000000, 5, 5),
  (12,118,2, 'product', 59, 1, 19, 11000000, 7500000, 5, 5),
  -- PO 13 (Q11 Samudra; lines 1..3)
  (13,61, 1, 'product', 49, 36, 34, 125000, 72000, 6, 6),
  (13,62, 2, 'product', 44, 24, 35, 150000, 92000, 6, 6),
  (13,63, 3, 'product', 56, 100,33, 26000,  18000, 6, 6),
  -- PO 14 (Q5 IMC additional; HAND LAMP qi 30, PLIER DIAGONAL qi 32)
  (14,30, 1, 'product', 32, 4, 21, 320000, 200000, 5, 5),
  (14,32, 2, 'product', 11, 3, 21, 100000, 65000, 5, 5),
  -- PO 15 (Q16 second batch; SCREWDRIVER 8X150 qi 91)
  (15,91, 1, 'product', 16, 12, 21, 305000, 180000, 7, 7),
  -- PO 16 (Q23 Pulau Seroja R1; lines 1..2)
  (16,112,1, 'product', 23, 30, 21, 48000,  28000, 7, 7),
  (16,113,2, 'product', 33, 80, 13, 26000,  16000, 7, 7),
  -- PO 17 (Q6 Yuxin second partial; lines 7, 10, 11, 14)
  (17,39, 1, 'product', 32, 2, 21, 320000,  200000, 5, 5),
  (17,42, 2, 'product', 21, 2, 19, 300000,  180000, 5, 5),
  (17,43, 3, 'product', 4, 1, 19, 1750000, 1100000, 5, 5),
  (17,46, 4, 'product', 26, 10, 19, 760000, 460000, 5, 5),
  -- PO 18 (Q9 Transcoal shipping)
  (18,53, 1, 'shipping', 60, 1, 33, 2100000, 0, 5, 5);


-- 12. INVOICES — 18
-- =============================================================================
-- Status mix: 8 paid, 4 sent, 3 overdue, 2 draft, 1 cancelled.
-- ppn_amount/total/dpp_nilai_lain are GENERATED; do not insert.
INSERT INTO invoices (
  id, invoice_no, quotation_id, po_id, company_client_id,
  invoice_date, due_date, subtotal, dpp,
  ppn_rate, tax_transaction_code, faktur_type, status,
  created_by, updated_by, created_at, updated_at
) VALUES
  -- 1. Yuxin invoice 077 (REAL)
  (1, '077/INV-GNS/VIII/2025', 6, 3, 2,
   '2025-08-04', '2025-09-03', 153909500, 153909500,
   12.00, '04', 'Normal', 'paid', 4, 4,
   '2025-08-04 14:00:00+07', '2025-08-20 09:00:00+07'),
  -- 2. Transcoal invoice 10611 (REAL, shipping service, no PPN-DPP normal)
  (2, '10611/INV-GNS/I/2026', 8, 5, 3,
   '2026-01-08', '2026-02-08', 1450000, 1450000,
   12.00, '04', 'Normal', 'paid', 4, 4,
   '2026-01-08 13:00:00+07', '2026-01-25 11:00:00+07'),
  -- 3. IMC partial invoice from Q-264128 (PO 1)
  (3, '11402/INV-GNS/IV/2026', 1, 1, 2,
   '2026-04-09', '2026-05-09', 7733950, 7733950,
   12.00, '04', 'Normal', 'paid', 4, 4,
   '2026-04-09 09:00:00+07', '2026-04-22 14:00:00+07'),
  -- 4. IMC Q5 (revision, paid via Yuxin)
  (4, '11403/INV-GNS/III/2026', 5, 2, 2,
   '2026-03-27', '2026-04-26', 8811250, 8811250,
   12.00, '04', 'Normal', 'paid', 4, 4,
   '2026-03-27 10:00:00+07', '2026-04-15 16:00:00+07'),
  -- 5. Yuxin Q7 consumables
  (5, '11201/INV-GNS/IX/2025', 7, 4, 2,
   '2025-09-23', '2025-10-23', 7410000, 7410000,
   12.00, '04', 'Normal', 'paid', 4, 4,
   '2025-09-23 09:00:00+07', '2025-10-15 11:00:00+07'),
  -- 6. Bahari Sandi Q10 invoice
  (6, '12001/INV-GNS/III/2026', 10, 6, 4,
   '2026-03-16', '2026-04-15', 17337500, 17337500,
   12.00, '04', 'Normal', 'paid', 4, 4,
   '2026-03-16 13:00:00+07', '2026-04-10 09:00:00+07'),
  -- 7. Karya Laut Q13 invoice
  (7, '12101/INV-GNS/III/2026', 13, 7, 7,
   '2026-03-26', '2026-04-25', 21375000, 21375000,
   12.00, '04', 'Normal', 'sent', 4, 4,
   '2026-03-26 14:00:00+07', '2026-03-26 14:00:00+07'),
  -- 8. Niaga Bahari Q16 invoice
  (8, '12201/INV-GNS/III/2026', 16, 8, 10,
   '2026-03-28', '2026-04-27', 11210000, 11210000,
   12.00, '04', 'Normal', 'paid', 4, 4,
   '2026-03-28 09:00:00+07', '2026-04-20 15:00:00+07'),
  -- 9. Bahari Megah Q20 invoice (sent, awaiting payment)
  (9, '12301/INV-GNS/IV/2026', 20, 9, 14,
   '2026-04-22', '2026-05-22', 16007500, 16007500,
   12.00, '04', 'Normal', 'sent', 4, 4,
   '2026-04-22 10:00:00+07', '2026-04-22 10:00:00+07'),
  -- 10. IMC Q2 (sent — pending PO upload)
  (10,'12401/INV-GNS/IV/2026', 2, 10, 1,
   '2026-04-20', '2026-05-20', 11875000, 11875000,
   12.00, '04', 'Normal', 'sent', 4, 4,
   '2026-04-20 11:00:00+07', '2026-04-20 11:00:00+07'),
  -- 11. Bintang Timur Q15 (sent)
  (11,'12501/INV-GNS/IV/2026', 15, 11, 9,
   '2026-04-18', '2026-05-18', 13490000, 13490000,
   12.00, '04', 'Normal', 'sent', 4, 4,
   '2026-04-18 09:00:00+07', '2026-04-18 09:00:00+07'),
  -- 12. Old IMC overdue (from prior month)
  (12,'11801/INV-GNS/II/2026', 5, 14, 1,
   '2026-02-25', '2026-03-27', 8811250, 8811250,
   12.00, '04', 'Normal', 'overdue', 4, 4,
   '2026-02-25 14:00:00+07', '2026-04-01 09:00:00+07'),
  -- 13. Old Yuxin overdue tail-end Q6
  (13,'11901/INV-GNS/IX/2025', 6, 17, 2,
   '2025-09-08', '2025-10-08', 4275000, 4275000,
   12.00, '04', 'Normal', 'overdue', 4, 4,
   '2025-09-08 13:00:00+07', '2025-10-15 16:00:00+07'),
  -- 14. Niaga Bahari second batch (Q16 PO 15)
  (14,'12601/INV-GNS/IV/2026', 16, 15, 10,
   '2026-04-09', '2026-05-09', 3477000, 3477000,
   12.00, '04', 'Normal', 'paid', 4, 4,
   '2026-04-09 11:00:00+07', '2026-04-25 16:00:00+07'),
  -- 15. Samudra Q11 (draft — not yet sent)
  (15,'12701/INV-GNS/IV/2026', 11, 13, 5,
   '2026-04-26', '2026-05-26', 9262500, 9262500,
   12.00, '04', 'Normal', 'draft', 4, 4,
   '2026-04-26 10:00:00+07', '2026-04-26 10:00:00+07'),
  -- 16. IMC Q5 partial PO 14 invoice
  (16,'12801/INV-GNS/IV/2026', 5, 14, 1,
   '2026-04-02', '2026-05-02', 1880000, 1880000,
   12.00, '04', 'Normal', 'paid', 4, 4,
   '2026-04-02 13:00:00+07', '2026-04-25 11:00:00+07'),
  -- 17. Cancelled invoice (mistake)
  (17,'12901/INV-GNS/III/2026', 14, NULL, 8,
   '2026-02-12', '2026-03-14', 7800000, 7800000,
   12.00, '04', 'Pembatalan', 'cancelled', 4, 4,
   '2026-02-12 09:00:00+07', '2026-02-15 14:00:00+07'),
  -- 18. Transcoal Q9 (sent)
  (18,'13001/INV-GNS/II/2026', 9, 18, 3,
   '2026-02-16', '2026-03-18', 2100000, 2100000,
   12.00, '04', 'Normal', 'sent', 4, 4,
   '2026-02-16 14:00:00+07', '2026-02-16 14:00:00+07');

SELECT setval('invoices_id_seq', GREATEST((SELECT MAX(id) FROM invoices), 1));


-- 13. INVOICE ITEMS — ~60 lines across 18 invoices
-- =============================================================================
-- Snapshot pattern: item_name + item_code + unit_code copied from quotation_items
-- at invoice creation. dpp_nilai_lain & ppn_amount calculated against the dpp.
-- For DPP Nilai Lain (kode 04): dpp_nilai_lain = unit_price * qty * 11/12; ppn = 12% of that.
INSERT INTO invoice_items (
  invoice_id, quotation_item_id, line_type,
  item_name, item_code, goods_or_service, unit_code,
  qty, unit_price, dpp, dpp_nilai_lain, ppn_rate, ppn_amount,
  created_by, updated_by
) VALUES
  -- Inv 1 (Yuxin 077 — abridged 5 lines from Q6: lines 1, 4, 5, 6, 9)
  (1, 33, 'product', 'PLIER SIDE CUTTING 175MM',          '615870', 'B', 'PCE', 1,  350000,  332500,    304792, 12.00, 36575, 4, 4),
  (1, 36, 'product', 'LAMP LED 12W 220V E-27',            '790268', 'B', 'PCE', 50, 48000,   2280000,   2090000, 12.00, 250800, 4, 4),
  (1, 37, 'product', 'FLOODLIGHT FIXTURE LED SLD-150',    '791836', 'B', 'SET', 10, 450000,  4275000,   3918750, 12.00, 470250, 4, 4),
  (1, 38, 'product', 'LAMP LED 8W 220V E-27',             '790265', 'B', 'PCE', 50, 50000,   2375000,   2177083, 12.00, 261250, 4, 4),
  (1, 41, 'product', 'CABLE HF-CXO 0.6/1KV 1.5MM2X3C',    '794283', 'B', 'MTR', 100, 25000,  2375000,   2177083, 12.00, 261250, 4, 4),
  -- Inv 2 (Transcoal Q8 shipping)
  (2, 52, 'shipping','Pengiriman item PO-TCP/XII/2025-00358 ke Sangatta', NULL, 'J', 'PCE', 1, 1450000, 1450000, 1329167, 12.00, 159500, 4, 4),
  -- Inv 3 (IMC Q1 → real PO 1, top 4 lines: 11, 12, 13, 1)
  (3, 11, 'product', 'LAMP LED 12W 220V E-27',            '790268', 'B', 'PCE', 50, 48000, 2280000, 2090000, 12.00, 250800, 4, 4),
  (3, 12, 'product', 'LAMP LED 8W 220V E-27',             '790265', 'B', 'PCE', 50, 50000, 2375000, 2177083, 12.00, 261250, 4, 4),
  (3, 13, 'product', 'FLOODLIGHT FIXTURE LED SLD-150',    '791836', 'B', 'SET', 10, 450000, 4275000, 3918750, 12.00, 470250, 4, 4),
  (3, 1,  'product', 'PUNCHING TOOL SET 6-38MM 16S',      '613802', 'B', 'SET', 1,  2000000, 1900000, 1741667, 12.00, 209000, 4, 4),
  -- Inv 4 (Q5 IMC revision; lines 1, 2, 3, 5)
  (4, 27, 'product', 'LAMP LED 12W',                      '790268', 'B', 'PCE', 50, 48000, 2280000, 2090000, 12.00, 250800, 4, 4),
  (4, 28, 'product', 'LAMP LED 8W',                       '790265', 'B', 'PCE', 50, 50000, 2375000, 2177083, 12.00, 261250, 4, 4),
  (4, 29, 'product', 'FLOODLIGHT LED SLD-150',            '791836', 'B', 'SET', 5,  450000, 2137500, 1959375, 12.00, 235125, 4, 4),
  (4, 31, 'product', 'PLUG & DOUBLE RECEPTACLE',          '792925', 'B', 'SET', 10, 60000,  570000, 522500, 12.00, 62700, 4, 4),
  -- Inv 5 (Yuxin consumables Q7; all 4 lines)
  (5, 48, 'product', 'WD-40 SPRAY 333ML',                 NULL, 'B', 'TIN', 24, 120000, 2736000, 2508000, 12.00, 300960, 4, 4),
  (5, 49, 'product', 'TAPE PVC INSULATION',               NULL, 'B', 'OTH', 20, 210000, 3990000, 3657500, 12.00, 438900, 4, 4),
  (5, 50, 'product', 'GLUE LOCTITE 401',                  NULL, 'B', 'BTL', 10, 60000,  570000, 522500, 12.00, 62700, 4, 4),
  (5, 51, 'product', 'KAIN MAJUN',                        NULL, 'B', 'OTH', 30, 25000,  712500, 653125, 12.00, 78375, 4, 4),
  -- Inv 6 (Bahari Sandi Q10; lines 1, 2, 6, 7)
  (6, 54, 'product', 'PUNCHING TOOL SET 6-38MM',          '613802', 'B', 'SET', 1,  2200000, 2090000, 1915833, 12.00, 229900, 6, 6),
  (6, 55, 'product', 'WRENCH ADJUSTABLE 250MM',           NULL, 'B', 'PCE', 4, 220000, 836000, 766333, 12.00, 91960, 6, 6),
  (6, 59, 'product', 'LAMP LED 12W',                      '790268', 'B', 'PCE', 30, 50000, 1425000, 1306250, 12.00, 156750, 6, 6),
  (6, 60, 'product', 'FLOODLIGHT LED SLD-150',            '791836', 'B', 'SET', 4,  460000, 1748000, 1602333, 12.00, 192280, 6, 6),
  -- Inv 7 (Karya Laut Q13 SENT; lines 1..3)
  (7, 69, 'product', 'LAMP LED 12W',                      '790268', 'B', 'PCE', 50, 48000, 2280000, 2090000, 12.00, 250800, 4, 4),
  (7, 70, 'product', 'FL CEILING LIGHT KEW402',           '791887', 'B', 'PCE', 8,  3000000, 22800000, 20900000, 12.00, 2508000, 4, 4),
  (7, 71, 'product', 'CABLE HF-CXO 1.5MM2X3C',            '794283', 'B', 'MTR', 200, 25000, 4750000, 4354167, 12.00, 522500, 4, 4),
  -- Inv 8 (Niaga Bahari Q16; lines 1, 2, 4)
  (8, 86, 'product', 'PUNCHING TOOL SET',                 '613802', 'B', 'SET', 1, 2100000, 1995000, 1828750, 12.00, 219450, 4, 4),
  (8, 87, 'product', 'PULLER GEAR 3-ARM 0-200MM',         NULL, 'B', 'SET', 2, 760000, 1444000, 1323667, 12.00, 158840, 4, 4),
  (8, 89, 'product', 'SCREWDRIVER HAMMERING 6 BITS',      NULL, 'B', 'SET', 2, 580000, 1102000, 1010167, 12.00, 121220, 4, 4),
  -- Inv 9 (Bahari Megah Q20 SENT; lines 1..3)
  (9, 102, 'product', 'LAMP LED 12W',                     '790268', 'B', 'PCE', 100, 49000, 4655000, 4267083, 12.00, 512050, 4, 4),
  (9, 103, 'product', 'LAMP LED 8W',                      '790265', 'B', 'PCE', 100, 51000, 4845000, 4441250, 12.00, 532950, 4, 4),
  (9, 104, 'product', 'FL CEILING LIGHT KEW402',          '791887', 'B', 'PCE', 4,   2950000, 11210000, 10275833, 12.00, 1233100, 4, 4),
  -- Inv 10 (IMC Q2 SENT; lines 1..3)
  (10,14, 'product', 'LAMP LED 12W',                      '790268', 'B', 'PCE', 100, 50000, 4750000, 4354167, 12.00, 522500, 4, 4),
  (10,15, 'product', 'LAMP LED 8W',                       '790265', 'B', 'PCE', 100, 52000, 4940000, 4528333, 12.00, 543400, 4, 4),
  (10,16, 'product', 'FL CEILING LIGHT KEW402',           '791887', 'B', 'PCE', 5,   2950000, 14012500, 12844792, 12.00, 1541375, 4, 4),
  -- Inv 11 (Bintang Timur Q15 SENT; lines 1..3)
  (11,79, 'product', 'SCREWDRIVER INSULATED 8X150MM',     NULL, 'B', 'PCE', 6, 320000, 1824000, 1672000, 12.00, 200640, 4, 4),
  (11,80, 'product', 'SCREWDRIVER INSULATED 9X200MM',     NULL, 'B', 'PCE', 6, 350000, 1995000, 1828750, 12.00, 219450, 4, 4),
  (11,81, 'product', 'SCREWDRIVER INSULATED 10X250MM',    NULL, 'B', 'PCE', 6, 240000, 1368000, 1254000, 12.00, 150480, 4, 4),
  -- Inv 12 (IMC overdue Q5; HAND LAMP qi 30, PLIER qi 32)
  (12,30, 'product', 'HAND LAMP WATERTIGHT E-26 60W',     '792151', 'B', 'PCE', 4, 320000, 1216000, 1114667, 12.00, 133760, 4, 4),
  (12,32, 'product', 'PLIER DIAGONAL CUTTING',            '615881', 'B', 'PCE', 3, 100000, 285000, 261250, 12.00, 31350, 4, 4),
  -- Inv 13 (Yuxin overdue partial Q6; HAND LAMP qi 39, NUT DRIVER qi 42)
  (13,39, 'product', 'HAND LAMP WATERTIGHT E-26 60W',     '792151', 'B', 'PCE', 2, 320000, 608000, 557333, 12.00, 66880, 4, 4),
  (13,42, 'product', 'NUT DRIVER SET 5-12MM',             '612366', 'B', 'SET', 2, 300000, 570000, 522500, 12.00, 62700, 4, 4),
  -- Inv 14 (Niaga Bahari second batch Q16; SCREWDRIVER 8X150 qi 91)
  (14,91, 'product', 'SCREWDRIVER INSULATED 8X150',       NULL, 'B', 'PCE', 12, 305000, 3477000, 3186750, 12.00, 382410, 4, 4),
  -- Inv 15 (Samudra Q11 DRAFT; lines 1..3 = WD-40, PRUSIAN BLUE, KAIN MAJUN)
  (15,61, 'product', 'WD-40 SPRAY 333ML',                 NULL, 'B', 'TIN', 36, 125000, 4275000, 3918750, 12.00, 470250, 4, 4),
  (15,62, 'product', 'PRUSIAN BLUE Permatex 22ml',        NULL, 'B', 'TUB', 24, 150000, 3420000, 3135000, 12.00, 376200, 4, 4),
  (15,63, 'product', 'KAIN MAJUN',                        NULL, 'B', 'OTH', 100, 26000, 2470000, 2264167, 12.00, 271700, 4, 4),
  -- Inv 16 (IMC Q5 partial; HAND LAMP qi 30, PLIER qi 32)
  (16,30, 'product', 'HAND LAMP WATERTIGHT E-26 60W',     '792151', 'B', 'PCE', 4, 320000, 1216000, 1114667, 12.00, 133760, 4, 4),
  (16,32, 'product', 'PLIER DIAGONAL CUTTING',            '615881', 'B', 'PCE', 3, 100000, 285000, 261250, 12.00, 31350, 4, 4),
  -- Inv 17 (cancelled — Surya Q14 line 1 = qi 75)
  (17,75, 'product', 'SCREWDRIVER HAMMERING 6 BITS ARCA', NULL, 'B', 'SET', 4, 575000, 2300000, 2108333, 12.00, 253000, 4, 4),
  -- Inv 18 (Transcoal Q9 shipping = qi 53)
  (18,53, 'shipping','Pengiriman engine spare ke Balikpapan', NULL, 'J', 'OTH', 1, 2100000, 2100000, 1925000, 12.00, 231000, 4, 4);


-- 14. ITEM REQUEST MATCHES — augment trigger-populated entries
-- =============================================================================
-- trg_learn_match auto-populates from quotation_items.requested_name. Override
-- match_count for top patterns (simulate richer history).
INSERT INTO item_request_matches (request_text, matched_item_id, match_count) VALUES
  ('PUNCHING TOOL SET DIES & TABLE, 6-38MM 16S',          1,  6),
  ('PRUSIAN BLUE Permatex 22ml (Tube)',                   44, 4),
  ('CARBORUNDUM PASTE GRIT#2000, MICRO FINE 450GRM',      45, 3),
  ('CARBORUNDUM PASTE GRIT#1500, MICRO FINE 450GRM',      46, 3),
  ('CARBORUNDUM PASTE GRIT#800, MICRO FINE 450GRM',       47, 3),
  ('PULLER GEAR & WHEEL 3-ARM, 0-200MM TEKIRO 8"',        2,  4),
  ('PULLER GEAR & WHEEL 3-ARM, 0-150MM TEKIRO 6"',        3,  4),
  ('LAMP LED 12W (100W) 220V E-27, COOL WHITE',           23, 12),
  ('LAMP LED 8W (60W) 220V E-27, COOL WHITE',             24, 10),
  ('FLOODLIGHT FIXTURE LED SLD-150',                      25, 8),
  ('FL CEILING LIGHT KEW402 40WX2',                       31, 6),
  ('CABLE HF-CXO 0.6/1KV 1.5MM2X3C',                      33, 7),
  ('TAPE PVC INSULATION 50MMX20MTR BLACK',                39, 5),
  ('LUBRICANT SPRAY WD-40 333ML',                         49, 6),
  ('GLUE LOCTITE 401 INSTANT 20GRM',                      50, 4),
  ('NUT DRIVER SET 5-12MM 7''S',                          21, 5),
  ('PULLER BEARING KIT 00-12',                            4,  3),
  ('WRENCH ADJUSTABLE 250MM',                             6,  4),
  ('SCREWDRIVER INSULATED 8X150MM',                       16, 5),
  ('PLUG CEE FEMALE 380V 32A',                            35, 3),
  ('PLUG CEE MALE 380V 32A',                              36, 3),
  ('KAIN MAJUN',                                          56, 7),
  ('GLOVES COTTON 12 PAIRS',                              57, 4),
  ('HAND LAMP WATERTIGHT E-26 60W',                       32, 4),
  ('MULTI TESTER FLUKE 27II',                             58, 2),
  ('RADIO HAND MARINE ENTEL DX544',                       59, 2)
ON CONFLICT (LOWER(TRIM(request_text))) DO UPDATE
  SET match_count = EXCLUDED.match_count,
      matched_item_id = EXCLUDED.matched_item_id;


-- 15. DOC SEQUENCES — set last_seq so fn_next_doc_no continues from current
-- =============================================================================
-- After seed: next Q for IMC (id=1, year 2026) will be Q-26264104 onwards, etc.
INSERT INTO doc_sequences (doc_type, company_id, year, last_seq) VALUES
  -- Q (quotation)
  ('Q',  1,  2026, 3), ('Q',  1,  2025, 0), ('Q',  2,  2025, 1), ('Q',  3,  2026, 2),
  ('Q',  4,  2026, 1), ('Q',  5,  2026, 1), ('Q',  6,  2026, 1), ('Q',  7,  2026, 1),
  ('Q',  8,  2026, 1), ('Q',  9,  2026, 1), ('Q', 10, 2026, 1), ('Q', 11, 2026, 1),
  ('Q', 12, 2026, 1), ('Q', 13, 2026, 2), ('Q', 14, 2026, 1), ('Q', 15, 2026, 1),
  ('Q', 16, 2026, 1), ('Q', 24, 2026, 1), ('Q', 25, 2026, 1),
  -- PO
  ('PO', 1,  2026, 3), ('PO', 2,  2025, 2), ('PO', 3,  2026, 1), ('PO', 4,  2026, 1),
  ('PO', 7,  2026, 1), ('PO', 9,  2026, 1), ('PO',10, 2026, 1), ('PO',13, 2026, 1),
  ('PO',14, 2026, 1), ('PO',24, 2026, 1),
  -- INV
  ('INV',2,  2025, 1), ('INV',2,  2026, 0), ('INV',3,  2026, 1), ('INV',1,  2026, 3),
  ('INV',1,  2025, 1), ('INV',4,  2026, 1), ('INV',7,  2026, 1), ('INV',10, 2026, 1),
  ('INV',14, 2026, 1), ('INV',9,  2026, 1), ('INV',5,  2026, 1)
ON CONFLICT (doc_type, company_id, year) DO UPDATE
  SET last_seq = EXCLUDED.last_seq, updated_at = NOW();


COMMIT;


-- VERIFY (optional)
-- SELECT 'users'              AS tbl, COUNT(*) FROM users           UNION ALL
-- SELECT 'company_client',    COUNT(*) FROM company_client          UNION ALL
-- SELECT 'company_contacts',  COUNT(*) FROM company_contacts        UNION ALL
-- SELECT 'vendors',           COUNT(*) FROM vendors                 UNION ALL
-- SELECT 'items',             COUNT(*) FROM items                   UNION ALL
-- SELECT 'vendor_products',   COUNT(*) FROM vendor_products         UNION ALL
-- SELECT 'quotations',        COUNT(*) FROM quotations              UNION ALL
-- SELECT 'quotation_items',   COUNT(*) FROM quotation_items         UNION ALL
-- SELECT 'quotation_status_history', COUNT(*) FROM quotation_status_history UNION ALL
-- SELECT 'purchase_orders',   COUNT(*) FROM purchase_orders         UNION ALL
-- SELECT 'purchase_order_items', COUNT(*) FROM purchase_order_items UNION ALL
-- SELECT 'invoices',          COUNT(*) FROM invoices                UNION ALL
-- SELECT 'invoice_items',     COUNT(*) FROM invoice_items           UNION ALL
-- SELECT 'item_request_matches', COUNT(*) FROM item_request_matches UNION ALL
-- SELECT 'doc_sequences',     COUNT(*) FROM doc_sequences;
-- Expected: 8, 25, 30, 25, 60, 80+, 25, 130+, ~14, 18, 60+, 18, 50+, 26+, 40+
