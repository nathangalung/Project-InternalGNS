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

-- ─── UNITS (dengan Coretax codes) ─────────────────────────
INSERT INTO units (code, name, coretax_code) VALUES
  ('PCS', 'Pieces/Piece', 'PCE'),
  ('KG',  'Kilogram', 'KGM'),
  ('TIN', 'Tin/Can', 'CAN'),
  ('TUB', 'Tube', 'TBE'),
  ('SET', 'Set', 'SET'),
  ('PKT', 'Pack/Packet', 'PK'),
  ('BTL', 'Botol/Bottle', 'BO'),
  ('LTR', 'Liter', 'LTR'),
  ('MTR', 'Meter', 'MTR'),
  ('DOZ', 'Dozen/Lusin', 'DZN'),
  ('KGS', 'Kilograms', 'KGM'),
  ('PRS', 'Pairs/Pasang', 'PR'),
  ('PAK', 'Pak/Pack', 'PK'),
  ('RLS', 'Roll/Gulung', 'RL'),
  ('SPL', 'Spool', 'SPL'),
  ('UNT', 'Unit', 'UNT');

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
INSERT INTO items (name, impa_code, default_unit_id, created_by, updated_by) VALUES
  ('PUNCHING TOOL SET DIES & TABLE, 6-38MM 16S',            '613802', 5, 1, 1),  -- SET
  ('PRUSIAN BLUE Permatex 22ml (Tube)',                     NULL,     4, 1, 1),  -- TUB
  ('CARBORUNDUM PASTE GRIT#2000, MICRO FINE 450GRM',        NULL,     3, 1, 1),  -- TIN
  ('CARBORUNDUM PASTE GRIT#1500, MICRO FINE 450GRM',        NULL,     3, 1, 1),
  ('CARBORUNDUM PASTE GRIT#800, MICRO FINE 450GRM',         NULL,     3, 1, 1),
  ('PULLER GEAR & WHEEL 3-ARM, 0-200MM, Brand TEKIRO 8"',   NULL,     5, 1, 1),
  ('PULLER GEAR & WHEEL 3-ARM, 0-150MM, Brand TEKIRO 6"',   NULL,     5, 1, 1),
  ('RIVET BLIND OPENTYPE ALUM-BODY, 3.2X8.0MM Per pack 1000pcs', NULL, 6, 1, 1),  -- PKT
  ('RIVET BLIND OPENTYPE ALUM-BODY, 3.2X6MM Per pack 1000pcs',   NULL, 6, 1, 1),
  ('WRENCH HOOK SPANNER 65-75MM, CARBON STEEL',             NULL,     1, 1, 1),  -- PCS
  ('LAMP LED 12W (100W) 220V E-27, COOL WHITE',             '790268', 1, 1, 1),
  ('LAMP LED 8W (60W) 220V E-27, COOL WHITE',               '790265', 1, 1, 1),
  ('FLOODLIGHT FIXTURE LED SLD-150',                        '791836', 5, 1, 1),
  ('FREIGHT/DELIVERY TO PORT',                              NULL,     5, 1, 1);

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
-- SELECT COUNT(*) FROM units;          -- expect 16
-- SELECT COUNT(*) FROM company_client; -- expect 3
-- SELECT COUNT(*) FROM items;          -- expect 14
-- SELECT COUNT(*) FROM vendor_products;-- expect 13
