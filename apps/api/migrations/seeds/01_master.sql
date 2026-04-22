-- ============================================================
-- SEED MASTER DATA — minimum data untuk aplikasi berjalan
-- Run after 01_schema.sql
-- ============================================================

BEGIN;

-- ─── BOOTSTRAP FIRST USER (superadmin) ────────────────────
-- Password hash dummy: 'changeme' bcrypt — GANTI di production
INSERT INTO users (id, email, name, password_hash, role, is_active, created_by, updated_by)
VALUES (1, 'admin@globalsakti.com', 'Admin GNS',
        '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',  -- bcrypt("changeme")
        'superadmin', TRUE, NULL, NULL);
-- Self-reference audit (retrofit setelah insert pertama)
UPDATE users SET created_by = 1, updated_by = 1 WHERE id = 1;
-- Sync sequence supaya INSERT berikutnya tidak konflik dengan id=1
SELECT setval('users_id_seq', 1, true);

-- Operational user sample
INSERT INTO users (email, name, password_hash, role, is_active, created_by, updated_by)
VALUES ('ops@globalsakti.com', 'Staff Operasional',
        '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
        'operational', TRUE, 1, 1);

-- Finance user sample
INSERT INTO users (email, name, password_hash, role, is_active, created_by, updated_by)
VALUES ('finance@globalsakti.com', 'Staff Finance',
        '$2a$10$N9qo8uLOickgx2ZMRZoMyeIjZAgcfl7p92ldGxad68LJZdL17lhWy',
        'finance', TRUE, 1, 1);

-- ─── UNITS (Coretax DJP UM.XXXX + ship-supply extras) ─────
-- IDs 1-33 = Coretax official UM.0001-UM.0033 (urutan persis UM.XXXX)
-- IDs 34-40 = ship-supply extras (dipetakan ke UM.0033 Lainnya)
INSERT INTO units (code, name, coretax_code) VALUES
  ('MT',    'Metrik Ton',         'UM.0001'),  -- id 1
  ('WT',    'Wet Ton',            'UM.0002'),  -- id 2
  ('KG',    'Kilogram',           'UM.0003'),  -- id 3
  ('GR',    'Gram',               'UM.0004'),  -- id 4
  ('KRT',   'Karat',              'UM.0005'),  -- id 5
  ('KL',    'Kiloliter',          'UM.0006'),  -- id 6
  ('LTR',   'Liter',              'UM.0007'),  -- id 7
  ('BBL',   'Barrel',             'UM.0008'),  -- id 8
  ('MMBTU', 'MMBTU',              'UM.0009'),  -- id 9
  ('AMP',   'Ampere',             'UM.0010'),  -- id 10
  ('CM3',   'Sentimeter Kubik',   'UM.0011'),  -- id 11
  ('M2',    'Meter Persegi',      'UM.0012'),  -- id 12
  ('MTR',   'Meter',              'UM.0013'),  -- id 13
  ('IN',    'Inches',             'UM.0014'),  -- id 14
  ('CM',    'Sentimeter',         'UM.0015'),  -- id 15
  ('YD',    'Yard',               'UM.0016'),  -- id 16
  ('DOZ',   'Lusin',              'UM.0017'),  -- id 17
  ('UNIT',  'Unit',               'UM.0018'),  -- id 18
  ('SET',   'Set',                'UM.0019'),  -- id 19
  ('LBR',   'Lembar',             'UM.0020'),  -- id 20
  ('PCS',   'Piece',              'UM.0021'),  -- id 21
  ('BOX',   'Boks',               'UM.0022'),  -- id 22
  ('YR',    'Tahun',              'UM.0023'),  -- id 23
  ('MON',   'Bulan',              'UM.0024'),  -- id 24
  ('WK',    'Minggu',             'UM.0025'),  -- id 25
  ('DAY',   'Hari',               'UM.0026'),  -- id 26
  ('HR',    'Jam',                'UM.0027'),  -- id 27
  ('MIN',   'Menit',              'UM.0028'),  -- id 28
  ('PCT',   'Persen',             'UM.0029'),  -- id 29
  ('KEG',   'Kegiatan',           'UM.0030'),  -- id 30
  ('LAP',   'Laporan',            'UM.0031'),  -- id 31
  ('BHN',   'Bahan',              'UM.0032'),  -- id 32
  ('OTH',   'Lainnya',            'UM.0033'),  -- id 33
  -- Ship-supply specific (no direct Coretax match, mapped ke UM.0033)
  ('TIN',   'Tin/Can',            'UM.0033'),  -- id 34
  ('TUB',   'Tube',               'UM.0033'),  -- id 35
  ('PKT',   'Pack/Packet',        'UM.0033'),  -- id 36
  ('BTL',   'Botol/Bottle',       'UM.0033'),  -- id 37
  ('PRS',   'Pairs/Pasang',       'UM.0033'),  -- id 38
  ('RLS',   'Roll/Gulung',        'UM.0033'),  -- id 39
  ('SPL',   'Spool',              'UM.0033');  -- id 40

-- ─── COMPANY CLIENTS (dari data existing) ─────────────────
-- PT. IMC Ship Management (quotation recipient)
INSERT INTO company_client (number, name, npwp, address, email, country_code, tku_id, created_by, updated_by)
VALUES ('2641', 'PT. IMC Ship Management',
        '0612345678901000',
        'Graha Irama Lt. 8 unit ABC, Jl. HR Rasuna Said Blok X-1 No. 1-2 RT 006/RW 004, Kuningan Timur, Kec. Setiabudi, Jakarta Selatan',
        NULL, 'IDN', NULL, 1, 1);

-- PT. Yuxin Shipping Line (invoice recipient — beda entity dari IMC)
INSERT INTO company_client (number, name, npwp, address, email, country_code, tku_id, created_by, updated_by)
VALUES ('0779', 'PT. Yuxin Shipping Line',
        '0618956270022000',
        'Gedung TCC Batavia Tower One Lt. 11 Unit 03, Jl. KH Mas Mansyur Kav. 126 RT 009 RW 003, Karet Tengsin, Tanah Abang, Jakarta Pusat',
        'ptyuxinshippingline@gmail.com', 'IDN', '0618956270022000000000', 1, 1);

-- PT. Transcoal Pacific (contoh client lain)
INSERT INTO company_client (number, name, npwp, address, country_code, created_by, updated_by)
VALUES ('1061', 'PT. Transcoal Pacific', NULL, 'Jakarta', 'IDN', 1, 1);

-- ─── COMPANY CONTACTS ─────────────────────────────────────
-- Contact di IMC
INSERT INTO company_contacts (company_id, name, email, phone, title, created_by, updated_by)
VALUES (1, 'Bp. Restu Umar Singgih',
        'restu.singgih@imc-shipmanagement.com',
        NULL, 'Procurement', 1, 1);

-- ─── VENDORS (contoh) ─────────────────────────────────────
INSERT INTO vendors (name, location, contact_info, created_by, updated_by)
VALUES
  ('Toko ABC Jakarta', 'Jakarta Barat',
   '{"email": "abc@vendor.com", "phone": "+6281234567890", "pic": "Pak Budi"}', 1, 1),
  ('CV Marine Supply', 'Surabaya',
   '{"whatsapp": "+6287712345678", "pic": "Ibu Tini"}', 1, 1),
  ('PT Tekiro Indonesia', 'Jakarta Timur',
   '{"email": "sales@tekiro.co.id"}', 1, 1);

-- ─── ITEMS (sample dari quotation PDF real) ────────────────
-- default_unit_id: 19=SET, 21=PCS, 34=TIN, 35=TUB, 36=PKT
INSERT INTO items (name, impa_code, default_unit_id, created_by, updated_by) VALUES
  ('PUNCHING TOOL SET DIES & TABLE, 6-38MM 16S',            '613802', 19, 1, 1),  -- SET
  ('PRUSIAN BLUE Permatex 22ml (Tube)',                     NULL,     35, 1, 1),  -- TUB
  ('CARBORUNDUM PASTE GRIT#2000, MICRO FINE 450GRM',        NULL,     34, 1, 1),  -- TIN
  ('CARBORUNDUM PASTE GRIT#1500, MICRO FINE 450GRM',        NULL,     34, 1, 1),
  ('CARBORUNDUM PASTE GRIT#800, MICRO FINE 450GRM',         NULL,     34, 1, 1),
  ('PULLER GEAR & WHEEL 3-ARM, 0-200MM, Brand TEKIRO 8"',   NULL,     19, 1, 1),
  ('PULLER GEAR & WHEEL 3-ARM, 0-150MM, Brand TEKIRO 6"',   NULL,     19, 1, 1),
  ('RIVET BLIND OPENTYPE ALUM-BODY, 3.2X8.0MM Per pack 1000pcs', NULL, 36, 1, 1),  -- PKT
  ('RIVET BLIND OPENTYPE ALUM-BODY, 3.2X6MM Per pack 1000pcs',   NULL, 36, 1, 1),
  ('WRENCH HOOK SPANNER 65-75MM, CARBON STEEL',             NULL,     21, 1, 1),  -- PCS
  ('LAMP LED 12W (100W) 220V E-27, COOL WHITE',             '790268', 21, 1, 1),
  ('LAMP LED 8W (60W) 220V E-27, COOL WHITE',               '790265', 21, 1, 1),
  ('FLOODLIGHT FIXTURE LED SLD-150',                        '791836', 19, 1, 1),
  ('FREIGHT/DELIVERY TO PORT',                              NULL,     19, 1, 1);

-- ─── VENDOR PRODUCTS (harga beli per vendor) ──────────────
-- Asumsi margin ~40% dari harga jual
INSERT INTO vendor_products (vendor_id, item_id, vendor_sku, cost_price, created_by, updated_by) VALUES
  (3, 1,  'TEK-PT16', 1200000, 1, 1),  -- Tekiro: Punching tool set
  (1, 2,  'ABC-PB22', 90000,   1, 1),  -- ABC: Prusian Blue
  (1, 3,  'ABC-CP2K', 40000,   1, 1),  -- ABC: Carborundum #2000
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

COMMIT;

-- ─── VERIFY ───────────────────────────────────────────────
-- SELECT COUNT(*) FROM users;          -- expect 3
-- SELECT COUNT(*) FROM units;          -- expect 40
-- SELECT COUNT(*) FROM company_client; -- expect 3
-- SELECT COUNT(*) FROM items;          -- expect 14
-- SELECT COUNT(*) FROM vendor_products;-- expect 13
