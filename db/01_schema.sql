-- ============================================================
-- QUOTATION SYSTEM — PRODUCTION SCHEMA (PostgreSQL 14+)
-- Target DB: gns_quotation
-- Version: v4.2 (2026-04-20)
-- ============================================================

-- ─── EXTENSIONS ───────────────────────────────────────────
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ─── HELPER FUNCTION: Auto-update `updated_at` on UPDATE ──
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  NEW.row_version = COALESCE(OLD.row_version, 0) + 1;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Variant untuk tabel tanpa row_version (master data)
CREATE OR REPLACE FUNCTION set_updated_at_no_version() RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- ═══════════════════════════════════════════════════════════
-- SYSTEM
-- ═══════════════════════════════════════════════════════════
CREATE TABLE users (
  id BIGSERIAL PRIMARY KEY,
  email VARCHAR(255) NOT NULL UNIQUE,
  name VARCHAR(255) NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  role VARCHAR(20) NOT NULL CHECK (role IN ('operational','finance','superadmin')),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by BIGINT,
  updated_by BIGINT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- Self-FK added after first user inserted (circular chicken-egg)
ALTER TABLE users
  ADD CONSTRAINT fk_users_created_by FOREIGN KEY (created_by) REFERENCES users(id) ON DELETE RESTRICT,
  ADD CONSTRAINT fk_users_updated_by FOREIGN KEY (updated_by) REFERENCES users(id) ON DELETE RESTRICT;
CREATE TRIGGER trg_users_updated_at BEFORE UPDATE ON users FOR EACH ROW EXECUTE FUNCTION set_updated_at_no_version();

-- ═══════════════════════════════════════════════════════════
-- MASTER DATA
-- ═══════════════════════════════════════════════════════════
CREATE TABLE units (
  id SMALLSERIAL PRIMARY KEY,
  code VARCHAR(20) NOT NULL UNIQUE,
  name VARCHAR(50),
  coretax_code VARCHAR(10)
);

CREATE TABLE company_client (
  id BIGSERIAL PRIMARY KEY,
  number VARCHAR(10),
  name VARCHAR(255) NOT NULL,
  npwp VARCHAR(20),
  address TEXT,
  email VARCHAR(255),
  country_code CHAR(3) DEFAULT 'IDN',
  tku_id VARCHAR(30),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by BIGINT REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER trg_company_client_updated_at BEFORE UPDATE ON company_client FOR EACH ROW EXECUTE FUNCTION set_updated_at_no_version();

CREATE TABLE company_contacts (
  id BIGSERIAL PRIMARY KEY,
  company_id BIGINT NOT NULL REFERENCES company_client(id) ON DELETE RESTRICT,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255),
  phone VARCHAR(50),
  title VARCHAR(100),
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by BIGINT REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER trg_company_contacts_updated_at BEFORE UPDATE ON company_contacts FOR EACH ROW EXECUTE FUNCTION set_updated_at_no_version();

CREATE TABLE vendors (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(255) NOT NULL,
  location VARCHAR(255),
  contact_info JSONB,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by BIGINT REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER trg_vendors_updated_at BEFORE UPDATE ON vendors FOR EACH ROW EXECUTE FUNCTION set_updated_at_no_version();

CREATE TABLE items (
  id BIGSERIAL PRIMARY KEY,
  name VARCHAR(500) NOT NULL,
  impa_code VARCHAR(20),
  default_unit_id SMALLINT REFERENCES units(id) ON DELETE RESTRICT,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by BIGINT REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER trg_items_updated_at BEFORE UPDATE ON items FOR EACH ROW EXECUTE FUNCTION set_updated_at_no_version();

CREATE TABLE vendor_products (
  id BIGSERIAL PRIMARY KEY,
  vendor_id BIGINT NOT NULL REFERENCES vendors(id) ON DELETE RESTRICT,
  item_id BIGINT NOT NULL REFERENCES items(id) ON DELETE RESTRICT,
  vendor_sku VARCHAR(100),
  cost_price NUMERIC(15,2) NOT NULL CHECK (cost_price >= 0),
  last_quoted_at TIMESTAMPTZ,
  is_active BOOLEAN NOT NULL DEFAULT TRUE,
  created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by BIGINT REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (vendor_id, item_id)
);
CREATE TRIGGER trg_vendor_products_updated_at BEFORE UPDATE ON vendor_products FOR EACH ROW EXECUTE FUNCTION set_updated_at_no_version();

CREATE TABLE item_request_matches (
  id BIGSERIAL PRIMARY KEY,
  request_text TEXT NOT NULL,
  matched_item_id BIGINT REFERENCES items(id) ON DELETE RESTRICT,
  match_count INT NOT NULL DEFAULT 1,
  last_used_at TIMESTAMPTZ DEFAULT NOW()
);

-- ═══════════════════════════════════════════════════════════
-- TRANSACTION
-- ═══════════════════════════════════════════════════════════
CREATE TABLE quotations (
  id BIGSERIAL PRIMARY KEY,
  quotation_no VARCHAR(50) NOT NULL UNIQUE,
  version INT NOT NULL DEFAULT 1,
  parent_id BIGINT REFERENCES quotations(id) ON DELETE RESTRICT,
  company_client_id BIGINT NOT NULL REFERENCES company_client(id) ON DELETE RESTRICT,
  company_client_name VARCHAR(255) NOT NULL,        -- SNAPSHOT, intentionally not FK
  contact_id BIGINT REFERENCES company_contacts(id) ON DELETE SET NULL,
  contact_name VARCHAR(255),                         -- SNAPSHOT, intentionally not FK
  client_ref_no VARCHAR(100),
  vessel_name VARCHAR(255),
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','sent','accepted','rejected','revised')),
  notes TEXT,
  payment_terms VARCHAR(100),
  validity_days SMALLINT,
  -- Financial summary (diisi app layer dari SUM quotation_items)
  total_produk NUMERIC(15,2),
  total NUMERIC(15,2),
  total_discount NUMERIC(15,2),
  -- Generated columns (level-1 only)
  subtotal NUMERIC(15,2) GENERATED ALWAYS AS (total - total_discount) STORED,
  dpp_nilai_lain NUMERIC(15,2) GENERATED ALWAYS AS ((total - total_discount) * 11.0 / 12.0) STORED,
  ppn_amount NUMERIC(15,2) GENERATED ALWAYS AS ((total - total_discount) * 11.0 / 12.0 * 0.12) STORED,
  grand_total NUMERIC(15,2) GENERATED ALWAYS AS ((total - total_discount) * 11.0 / 12.0 * 1.12) STORED,
  row_version INT NOT NULL DEFAULT 0,
  created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by BIGINT REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER trg_quotations_updated_at BEFORE UPDATE ON quotations FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON COLUMN quotations.company_client_name IS 'SNAPSHOT nama company saat quotation dibuat — intentionally NOT FK (master data boleh berubah, dokumen legal harus frozen)';
COMMENT ON COLUMN quotations.contact_name IS 'SNAPSHOT nama contact — intentionally NOT FK';

CREATE TABLE quotation_items (
  id BIGSERIAL PRIMARY KEY,
  quotation_id BIGINT NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  line_number SMALLINT NOT NULL,
  item_type VARCHAR(20) NOT NULL CHECK (item_type IN ('product','shipping')),
  -- REQUEST side (dari dokumen client)
  requested_item_id BIGINT REFERENCES items(id) ON DELETE RESTRICT,
  requested_impa VARCHAR(20),
  requested_name TEXT NOT NULL,
  -- OFFER side (yang kita tawarkan)
  offered_item_id BIGINT REFERENCES items(id) ON DELETE RESTRICT,
  vendor_product_id BIGINT REFERENCES vendor_products(id) ON DELETE RESTRICT,
  qty NUMERIC(12,2) NOT NULL CHECK (qty >= 0),
  unit_id SMALLINT REFERENCES units(id) ON DELETE RESTRICT,
  selling_price NUMERIC(15,2) NOT NULL CHECK (selling_price >= 0),
  cost_price NUMERIC(15,2),
  -- Generated (level-1, referensi ke base stored columns only)
  total_selling NUMERIC(15,2) GENERATED ALWAYS AS (qty * selling_price) STORED,
  discount_amount NUMERIC(15,2) GENERATED ALWAYS AS (
    CASE WHEN item_type = 'product' THEN qty * selling_price * 0.05 ELSE 0 END
  ) STORED,
  subtotal NUMERIC(15,2) GENERATED ALWAYS AS (
    qty * selling_price * CASE WHEN item_type = 'product' THEN 0.95 ELSE 1 END
  ) STORED,
  total_cost NUMERIC(15,2) GENERATED ALWAYS AS (qty * cost_price) STORED,
  profit_amount NUMERIC(15,2) GENERATED ALWAYS AS (qty * (selling_price - cost_price)) STORED,
  profit_pct NUMERIC(7,4) GENERATED ALWAYS AS (
    (selling_price - cost_price) / NULLIF(cost_price, 0)
  ) STORED,
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  ship_destination VARCHAR(255),
  due_date DATE,
  row_version INT NOT NULL DEFAULT 0,
  created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by BIGINT REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (quotation_id, line_number)
);
CREATE TRIGGER trg_quotation_items_updated_at BEFORE UPDATE ON quotation_items FOR EACH ROW EXECUTE FUNCTION set_updated_at();

COMMENT ON COLUMN quotation_items.requested_name IS 'SNAPSHOT text request dari client — intentionally NOT FK. requested_item_id NULL jika item baru/tidak dikenal di master.';

CREATE TABLE purchase_orders (
  id BIGSERIAL PRIMARY KEY,
  po_number VARCHAR(50) NOT NULL UNIQUE,
  quotation_id BIGINT NOT NULL REFERENCES quotations(id) ON DELETE RESTRICT,
  company_client_id BIGINT NOT NULL REFERENCES company_client(id) ON DELETE RESTRICT,
  contact_id BIGINT REFERENCES company_contacts(id) ON DELETE SET NULL,
  po_date DATE NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'PENDING'
    CHECK (status IN ('PENDING','UPLOADED','DELIVERED')),
  delivery_note_number VARCHAR(50),
  notes TEXT,
  file_url VARCHAR(500),
  row_version INT NOT NULL DEFAULT 0,
  created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by BIGINT REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER trg_purchase_orders_updated_at BEFORE UPDATE ON purchase_orders FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE purchase_order_items (
  id BIGSERIAL PRIMARY KEY,
  po_id BIGINT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  quotation_item_id BIGINT REFERENCES quotation_items(id) ON DELETE SET NULL,
  line_number SMALLINT NOT NULL,
  item_type VARCHAR(20) NOT NULL CHECK (item_type IN ('product','shipping')),
  offered_item_id BIGINT REFERENCES items(id) ON DELETE RESTRICT,
  qty NUMERIC(12,2) NOT NULL CHECK (qty >= 0),
  unit_id SMALLINT REFERENCES units(id) ON DELETE RESTRICT,
  selling_price NUMERIC(15,2) NOT NULL CHECK (selling_price >= 0),
  cost_price NUMERIC(15,2),
  total_selling NUMERIC(15,2) GENERATED ALWAYS AS (qty * selling_price) STORED,
  discount_amount NUMERIC(15,2) GENERATED ALWAYS AS (
    CASE WHEN item_type = 'product' THEN qty * selling_price * 0.05 ELSE 0 END
  ) STORED,
  subtotal NUMERIC(15,2) GENERATED ALWAYS AS (
    qty * selling_price * CASE WHEN item_type = 'product' THEN 0.95 ELSE 1 END
  ) STORED,
  total_cost NUMERIC(15,2) GENERATED ALWAYS AS (qty * cost_price) STORED,
  profit_amount NUMERIC(15,2) GENERATED ALWAYS AS (qty * (selling_price - cost_price)) STORED,
  profit_pct NUMERIC(7,4) GENERATED ALWAYS AS (
    (selling_price - cost_price) / NULLIF(cost_price, 0)
  ) STORED,
  is_available BOOLEAN NOT NULL DEFAULT TRUE,
  created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by BIGINT REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE (po_id, line_number)
);
CREATE TRIGGER trg_purchase_order_items_updated_at BEFORE UPDATE ON purchase_order_items FOR EACH ROW EXECUTE FUNCTION set_updated_at_no_version();

-- ═══════════════════════════════════════════════════════════
-- FINANCE
-- ═══════════════════════════════════════════════════════════
CREATE TABLE invoices (
  id BIGSERIAL PRIMARY KEY,
  invoice_no VARCHAR(50) NOT NULL UNIQUE,
  quotation_id BIGINT NOT NULL REFERENCES quotations(id) ON DELETE RESTRICT,
  po_id BIGINT REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  company_client_id BIGINT NOT NULL REFERENCES company_client(id) ON DELETE RESTRICT,
  invoice_date DATE NOT NULL,
  due_date DATE,
  subtotal NUMERIC(15,2),
  dpp NUMERIC(15,2),
  dpp_nilai_lain NUMERIC(15,2) GENERATED ALWAYS AS (dpp * 11.0 / 12.0) STORED,
  ppn_rate NUMERIC(4,2) NOT NULL DEFAULT 12.00 CHECK (ppn_rate = 12.00),
  ppn_amount NUMERIC(15,2) GENERATED ALWAYS AS (dpp * 11.0 / 12.0 * 0.12) STORED,
  total NUMERIC(15,2) GENERATED ALWAYS AS (dpp * 11.0 / 12.0 * 1.12) STORED,
  tax_transaction_code VARCHAR(2) DEFAULT '04'
    CHECK (tax_transaction_code IN ('01','04','07','08','09')),
  faktur_type VARCHAR(10) DEFAULT 'Normal'
    CHECK (faktur_type IN ('Normal','Pengganti','Pembatalan')),
  status VARCHAR(20) NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft','sent','paid','overdue','cancelled')),
  row_version INT NOT NULL DEFAULT 0,
  created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by BIGINT REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE TRIGGER trg_invoices_updated_at BEFORE UPDATE ON invoices FOR EACH ROW EXECUTE FUNCTION set_updated_at();

CREATE TABLE invoice_items (
  id BIGSERIAL PRIMARY KEY,
  invoice_id BIGINT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  quotation_item_id BIGINT REFERENCES quotation_items(id) ON DELETE SET NULL,
  line_type VARCHAR(20) NOT NULL CHECK (line_type IN ('product','shipping')),
  -- Snapshot fields (intentionally not FK)
  item_name VARCHAR(500) NOT NULL,
  item_code VARCHAR(20),
  goods_or_service CHAR(1),
  unit_code VARCHAR(10),
  qty NUMERIC(12,2) NOT NULL CHECK (qty >= 0),
  unit_price NUMERIC(15,2) NOT NULL CHECK (unit_price >= 0),
  dpp NUMERIC(15,2),
  dpp_nilai_lain NUMERIC(15,2),
  ppn_rate NUMERIC(4,2),
  ppn_amount NUMERIC(15,2),
  created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by BIGINT REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON COLUMN invoice_items.item_name IS 'SNAPSHOT nama barang dari items.name saat invoice dibuat — intentionally NOT FK (legal compliance)';

-- ═══════════════════════════════════════════════════════════
-- INDEXES
-- ═══════════════════════════════════════════════════════════
-- FK indexes (PostgreSQL tidak auto-index FK)
CREATE INDEX idx_company_contacts_company ON company_contacts(company_id);
CREATE INDEX idx_vendor_products_vendor ON vendor_products(vendor_id);
CREATE INDEX idx_vendor_products_item ON vendor_products(item_id);
CREATE INDEX idx_quotations_company ON quotations(company_client_id);
CREATE INDEX idx_quotations_contact ON quotations(contact_id);
CREATE INDEX idx_quotations_parent ON quotations(parent_id);
CREATE INDEX idx_quotation_items_quotation ON quotation_items(quotation_id);
CREATE INDEX idx_quotation_items_offered_item ON quotation_items(offered_item_id);
CREATE INDEX idx_quotation_items_requested_item ON quotation_items(requested_item_id);
CREATE INDEX idx_quotation_items_vendor_product ON quotation_items(vendor_product_id);
CREATE INDEX idx_po_quotation ON purchase_orders(quotation_id);
CREATE INDEX idx_po_company ON purchase_orders(company_client_id);
CREATE INDEX idx_po_items_po ON purchase_order_items(po_id);
CREATE INDEX idx_po_items_quotation_item ON purchase_order_items(quotation_item_id);
CREATE INDEX idx_invoices_quotation ON invoices(quotation_id);
CREATE INDEX idx_invoices_po ON invoices(po_id);
CREATE INDEX idx_invoices_company ON invoices(company_client_id);
CREATE INDEX idx_invoice_items_invoice ON invoice_items(invoice_id);
CREATE INDEX idx_invoice_items_quotation_item ON invoice_items(quotation_item_id);

-- List/filter indexes untuk dashboard
CREATE INDEX idx_quotations_status_created ON quotations(status, created_at DESC);
CREATE INDEX idx_po_status_date ON purchase_orders(status, po_date DESC);
CREATE INDEX idx_invoices_status_date ON invoices(status, invoice_date DESC);

-- Fuzzy search indexes (untuk auto-match IMPA/nama)
CREATE INDEX idx_items_name_trgm ON items USING GIN (name gin_trgm_ops);
CREATE INDEX idx_items_impa ON items(impa_code) WHERE impa_code IS NOT NULL;
CREATE INDEX idx_item_request_matches_trgm ON item_request_matches USING GIN (request_text gin_trgm_ops);

-- Partial unique: mencegah duplicate learning entries
CREATE UNIQUE INDEX idx_item_request_matches_unique ON item_request_matches (LOWER(TRIM(request_text)));

-- Uniqueness for company contacts' email (opsional, ringan)
CREATE UNIQUE INDEX idx_company_contacts_email ON company_contacts (LOWER(email)) WHERE email IS NOT NULL;

-- ═══════════════════════════════════════════════════════════
-- RECONCILIATION VIEW (header total vs SUM items)
-- ═══════════════════════════════════════════════════════════
CREATE VIEW quotation_reconciliation AS
SELECT
  q.id,
  q.quotation_no,
  q.total AS header_total,
  COALESCE(SUM(qi.total_selling), 0) AS items_total,
  q.total - COALESCE(SUM(qi.total_selling), 0) AS diff,
  q.total_discount AS header_discount,
  COALESCE(SUM(qi.discount_amount), 0) AS items_discount
FROM quotations q
LEFT JOIN quotation_items qi ON qi.quotation_id = q.id
GROUP BY q.id, q.quotation_no, q.total, q.total_discount;

COMMENT ON VIEW quotation_reconciliation IS 'Reconciliation check: header total vs SUM items. Non-zero diff = inconsistency.';
