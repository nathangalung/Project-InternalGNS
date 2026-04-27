-- +goose Up
-- +goose StatementBegin

-- 00010 — DISCOUNT_PCT 0..1 → 0..100
-- Standardize discount representation for FE-BE consistency:
-- Before: NUMERIC(5,4), range 0..1   (e.g., 0.05 = 5%)
-- After:  NUMERIC(5,2), range 0..100 (e.g., 5    = 5%)
---- FE (QuotationDetail/Edit) already uses 0-100 → after this migration
-- no conversion needed in backend layer.
---- Affected:
-- * 4 columns (quotations, quotation_items, purchase_orders, po_items)
-- * 4 GENERATED columns (discount_amount, subtotal × 2 tables) — divide /100
-- * VIEW quotation_reconciliation (depends on discount_amount)
-- * 2 triggers (BEFORE/AFTER UPDATE OF discount_pct ON quotations)
-- * fn_create_quotation validation
---- ORDER NOTES:
-- 1. View → drop first (refs discount_amount)
-- 2. GENERATED columns → drop (refs discount_pct)
-- 3. Triggers OF discount_pct → drop (PG blocks ALTER TYPE if column
-- referenced in trigger definition spec)
-- 4. CHECK constraints → drop (will recreate with new range)
-- 5. ALTER TYPE 5,4 → 5,2 (MUST precede UPDATE × 100, because
-- result can overflow 5,4 for discount > 9%)
-- 6. UPDATE data × 100
-- 7. Recreate CHECK, GENERATED, triggers, view with new formula

-- 1. DROP VIEW (depends on quotation_items.discount_amount)
DROP VIEW IF EXISTS quotation_reconciliation;

-- 2. DROP GENERATED columns (depend on discount_pct)
ALTER TABLE quotation_items      DROP COLUMN discount_amount;
ALTER TABLE quotation_items      DROP COLUMN subtotal;
ALTER TABLE purchase_order_items DROP COLUMN discount_amount;
ALTER TABLE purchase_order_items DROP COLUMN subtotal;

-- 3. DROP triggers referencing discount_pct-- (BEFORE/AFTER UPDATE OF discount_pct in trigger definition blocks ALTER TYPE)
DROP TRIGGER trg_protect_quotation_discount ON quotations;
DROP TRIGGER trg_cascade_quotation_discount ON quotations;

-- 4. DROP existing CHECK constraints (auto-named: <table>_<col>_check)
ALTER TABLE quotations           DROP CONSTRAINT quotations_discount_pct_check;
ALTER TABLE quotation_items      DROP CONSTRAINT quotation_items_discount_pct_check;
ALTER TABLE purchase_orders      DROP CONSTRAINT purchase_orders_discount_pct_check;
ALTER TABLE purchase_order_items DROP CONSTRAINT purchase_order_items_discount_pct_check;

-- 5. ALTER TYPE NUMERIC(5,4) → NUMERIC(5,2)-- Before UPDATE × 100: 0.10 * 100 = 10 overflows NUMERIC(5,4) (max 9.9999).
ALTER TABLE quotations            ALTER COLUMN discount_pct TYPE NUMERIC(5,2);
ALTER TABLE quotation_items       ALTER COLUMN discount_pct TYPE NUMERIC(5,2);
ALTER TABLE purchase_orders       ALTER COLUMN discount_pct TYPE NUMERIC(5,2);
ALTER TABLE purchase_order_items  ALTER COLUMN discount_pct TYPE NUMERIC(5,2);

-- 6. UPDATE existing data: × 100 (0.05 → 5)
UPDATE quotations            SET discount_pct = discount_pct * 100;
UPDATE quotation_items       SET discount_pct = discount_pct * 100;
UPDATE purchase_orders       SET discount_pct = discount_pct * 100;
UPDATE purchase_order_items  SET discount_pct = discount_pct * 100;

-- 7. ADD new CHECK 0..100
ALTER TABLE quotations
  ADD CONSTRAINT quotations_discount_pct_check
  CHECK (discount_pct >= 0 AND discount_pct <= 100);
ALTER TABLE quotation_items
  ADD CONSTRAINT quotation_items_discount_pct_check
  CHECK (discount_pct >= 0 AND discount_pct <= 100);
ALTER TABLE purchase_orders
  ADD CONSTRAINT purchase_orders_discount_pct_check
  CHECK (discount_pct >= 0 AND discount_pct <= 100);
ALTER TABLE purchase_order_items
  ADD CONSTRAINT purchase_order_items_discount_pct_check
  CHECK (discount_pct >= 0 AND discount_pct <= 100);

-- 8. Recreate GENERATED columns with /100 expression.
ALTER TABLE quotation_items ADD COLUMN discount_amount NUMERIC(15,2)
  GENERATED ALWAYS AS (
    CASE WHEN item_type = 'product'
         THEN qty * selling_price * (discount_pct / 100)
         ELSE 0 END
  ) STORED;

ALTER TABLE quotation_items ADD COLUMN subtotal NUMERIC(15,2)
  GENERATED ALWAYS AS (
    CASE WHEN item_type = 'product'
         THEN qty * selling_price * (1 - discount_pct / 100)
         ELSE qty * selling_price END
  ) STORED;

ALTER TABLE purchase_order_items ADD COLUMN discount_amount NUMERIC(15,2)
  GENERATED ALWAYS AS (
    CASE WHEN item_type = 'product'
         THEN qty * selling_price * (discount_pct / 100)
         ELSE 0 END
  ) STORED;

ALTER TABLE purchase_order_items ADD COLUMN subtotal NUMERIC(15,2)
  GENERATED ALWAYS AS (
    CASE WHEN item_type = 'product'
         THEN qty * selling_price * (1 - discount_pct / 100)
         ELSE qty * selling_price END
  ) STORED;

-- 9. RECREATE triggers (function body unchanged, only trigger spec)
CREATE TRIGGER trg_protect_quotation_discount
BEFORE UPDATE OF discount_pct ON quotations
FOR EACH ROW
EXECUTE FUNCTION trg_fn_protect_quotation_discount();

CREATE TRIGGER trg_cascade_quotation_discount
AFTER UPDATE OF discount_pct ON quotations
FOR EACH ROW
WHEN (OLD.discount_pct IS DISTINCT FROM NEW.discount_pct)
EXECUTE FUNCTION trg_fn_cascade_quotation_discount();

-- 10. Recreate VIEW quotation_reconciliation.
CREATE VIEW quotation_reconciliation AS
SELECT
  q.id, q.quotation_no,
  q.total AS header_total,
  COALESCE(SUM(qi.total_selling), 0) AS items_total,
  q.total - COALESCE(SUM(qi.total_selling), 0) AS diff,
  q.total_discount AS header_discount,
  COALESCE(SUM(qi.discount_amount), 0) AS items_discount
FROM quotations q
LEFT JOIN quotation_items qi ON qi.quotation_id = q.id
GROUP BY q.id, q.quotation_no, q.total, q.total_discount;

COMMENT ON VIEW quotation_reconciliation IS
  'Reconciliation check: header total vs SUM items. Non-zero diff = inconsistency.';

-- 11. Update comments.
COMMENT ON COLUMN quotations.discount_pct IS
  'Discount % applied to all items in this quotation (NUMERIC 0..100, e.g. 5 = 5%). No DB DEFAULT — app layer must set on INSERT. Once status != draft, UPDATE is blocked by trg_protect_quotation_discount.';

COMMENT ON COLUMN quotation_items.discount_pct IS
  'Snapshot of discount_pct from quotations header (0..100). Auto-inherited via trg_inherit_quotation_discount BEFORE INSERT. Header UPDATE cascades via trg_cascade_quotation_discount.';

COMMENT ON COLUMN purchase_orders.discount_pct IS
  'Discount % for this PO (0..100), snapshot from quotation at PO creation time. Auto-inherited via trg_po_inherit_quotation_discount.';

COMMENT ON COLUMN purchase_order_items.discount_pct IS
  'Snapshot of purchase_orders.discount_pct (0..100), auto-inherited via trg_inherit_po_discount.';

-- +goose StatementEnd


-- 12. RECREATE fn_create_quotation with 0..100 validation
-- +goose StatementBegin
DROP FUNCTION IF EXISTS fn_create_quotation(
  BIGINT, BIGINT, TEXT, TEXT, TEXT, INT, NUMERIC(5,4),
  TEXT, INT, NUMERIC(15,2), JSONB, BIGINT, TEXT, TEXT
);
-- +goose StatementEnd


-- +goose StatementBegin
CREATE FUNCTION fn_create_quotation(
  p_company_client_id  BIGINT,
  p_contact_id         BIGINT,
  p_client_ref_no      TEXT,
  p_vessel_name        TEXT,
  p_payment_terms      TEXT,
  p_validity_days      INT,
  p_discount_pct       NUMERIC(5,2),     -- changed: 0..100
  p_shipping_address   TEXT,
  p_shipping_days      INT,
  p_shipping_cost      NUMERIC(15,2),
  p_items              JSONB,
  p_created_by         BIGINT,
  p_notes              TEXT DEFAULT NULL,
  p_status             TEXT DEFAULT 'draft'
) RETURNS BIGINT AS $$
DECLARE
  v_quotation_id        BIGINT;
  v_quotation_no        TEXT;
  v_company_name        VARCHAR;
  v_contact_name        VARCHAR;
  v_item                JSONB;
  v_line_no             SMALLINT := 0;
  v_total_produk        NUMERIC(15,2) := 0;
  v_total               NUMERIC(15,2) := 0;
  v_total_discount      NUMERIC(15,2) := 0;
  v_qty                 NUMERIC(12,2);
  v_selling_price       NUMERIC(15,2);
BEGIN
  -- 1. Validation
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Quotation must have at least 1 item';
  END IF;

  IF p_discount_pct < 0 OR p_discount_pct > 100 THEN
    RAISE EXCEPTION 'discount_pct must be 0..100, got %', p_discount_pct;
  END IF;

  -- 2. Snapshot company_client_name + contact_name
  SELECT name INTO v_company_name
  FROM company_client WHERE id = p_company_client_id AND is_active = TRUE;

  IF v_company_name IS NULL THEN
    RAISE EXCEPTION 'company_client_id % not found or inactive', p_company_client_id;
  END IF;

  IF p_contact_id IS NOT NULL THEN
    SELECT name INTO v_contact_name
    FROM company_contacts
    WHERE id = p_contact_id AND company_id = p_company_client_id AND is_active = TRUE;

    IF v_contact_name IS NULL THEN
      RAISE EXCEPTION 'contact_id % not found or not belong to company %', p_contact_id, p_company_client_id;
    END IF;
  END IF;

  -- 3. Pre-calculate totals (discount divided by 100 — match new scale)
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_item->>'qty')::NUMERIC(12,2);
    v_selling_price := (v_item->>'selling_price')::NUMERIC(15,2);

    v_total          := v_total + (v_qty * v_selling_price);
    v_total_produk   := v_total_produk + (v_qty * v_selling_price);
    v_total_discount := v_total_discount + (v_qty * v_selling_price * (p_discount_pct / 100));
  END LOOP;

  IF p_shipping_cost IS NOT NULL AND p_shipping_cost > 0 THEN
    v_total := v_total + p_shipping_cost;
  END IF;

  -- 4. Generate quotation_no
  v_quotation_no := fn_next_doc_no('Q', p_company_client_id);

  -- 5. INSERT header
  INSERT INTO quotations (
    quotation_no, version, company_client_id, company_client_name,
    contact_id, contact_name,
    client_ref_no, vessel_name, status,
    payment_terms, validity_days, discount_pct,
    total_produk, total, total_discount,
    notes, created_by, updated_by
  ) VALUES (
    v_quotation_no, 1, p_company_client_id, v_company_name,
    p_contact_id, v_contact_name,
    p_client_ref_no, p_vessel_name, p_status,
    p_payment_terms, p_validity_days, p_discount_pct,
    v_total_produk, v_total, v_total_discount,
    p_notes, p_created_by, p_created_by
  ) RETURNING id INTO v_quotation_id;

  -- 6. INSERT product items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_line_no := v_line_no + 1;
    INSERT INTO quotation_items (
      quotation_id, line_number, item_type,
      requested_item_id, requested_impa, requested_name,
      offered_item_id, vendor_product_id,
      qty, unit_id, selling_price, cost_price,
      is_available, ship_destination, due_date,
      update_vendor_price, created_by, updated_by
    ) VALUES (
      v_quotation_id,
      v_line_no,
      'product',
      NULLIF((v_item->>'requested_item_id'),'')::BIGINT,
      v_item->>'requested_impa',
      v_item->>'requested_name',
      NULLIF((v_item->>'offered_item_id'),'')::BIGINT,
      NULLIF((v_item->>'vendor_product_id'),'')::BIGINT,
      (v_item->>'qty')::NUMERIC(12,2),
      (v_item->>'unit_id')::SMALLINT,
      (v_item->>'selling_price')::NUMERIC(15,2),
      NULLIF((v_item->>'cost_price'),'')::NUMERIC(15,2),
      COALESCE((v_item->>'is_available')::BOOLEAN, TRUE),
      v_item->>'ship_destination',
      NULLIF((v_item->>'due_date'),'')::DATE,
      COALESCE((v_item->>'update_vendor_price')::BOOLEAN, FALSE),
      p_created_by, p_created_by
    );
  END LOOP;

  -- 7. INSERT shipping line
  IF p_shipping_cost IS NOT NULL AND p_shipping_cost > 0 THEN
    v_line_no := v_line_no + 1;
    INSERT INTO quotation_items (
      quotation_id, line_number, item_type,
      requested_name,
      qty, unit_id, selling_price,
      ship_destination,
      created_by, updated_by
    ) VALUES (
      v_quotation_id,
      v_line_no,
      'shipping',
      'SHIPPING' || COALESCE(' — ' || p_shipping_address, ''),
      1,
      (SELECT id FROM units WHERE code = 'UNIT' LIMIT 1),
      p_shipping_cost,
      p_shipping_address,
      p_created_by, p_created_by
    );
  END IF;

  RETURN v_quotation_id;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd


-- +goose StatementBegin
COMMENT ON FUNCTION fn_create_quotation(
  BIGINT, BIGINT, TEXT, TEXT, TEXT, INT, NUMERIC(5,2),
  TEXT, INT, NUMERIC(15,2), JSONB, BIGINT, TEXT, TEXT
) IS
  'Atomic create quotation: generate doc_no, snapshot client/contact name, INSERT header + items + optional shipping line. discount_pct is now 0..100. Returns new quotation_id.';
-- +goose StatementEnd


-- +goose Down
-- +goose StatementBegin

-- Revert fn_create_quotation to stub (old signature requires re-apply 00009)
DROP FUNCTION IF EXISTS fn_create_quotation(
  BIGINT, BIGINT, TEXT, TEXT, TEXT, INT, NUMERIC(5,2),
  TEXT, INT, NUMERIC(15,2), JSONB, BIGINT, TEXT, TEXT
);

-- Drop view + GENERATED + triggers (reverse order of Up)
DROP VIEW IF EXISTS quotation_reconciliation;
ALTER TABLE quotation_items      DROP COLUMN discount_amount;
ALTER TABLE quotation_items      DROP COLUMN subtotal;
ALTER TABLE purchase_order_items DROP COLUMN discount_amount;
ALTER TABLE purchase_order_items DROP COLUMN subtotal;

DROP TRIGGER IF EXISTS trg_protect_quotation_discount ON quotations;
DROP TRIGGER IF EXISTS trg_cascade_quotation_discount ON quotations;

ALTER TABLE quotations           DROP CONSTRAINT quotations_discount_pct_check;
ALTER TABLE quotation_items      DROP CONSTRAINT quotation_items_discount_pct_check;
ALTER TABLE purchase_orders      DROP CONSTRAINT purchase_orders_discount_pct_check;
ALTER TABLE purchase_order_items DROP CONSTRAINT purchase_order_items_discount_pct_check;

-- Revert data ÷ 100 (5 → 0.05) BEFORE ALTER TYPE down
-- (NUMERIC(5,2) holds 0.05 fine; fits 5,4 after revert)
UPDATE quotations            SET discount_pct = discount_pct / 100;
UPDATE quotation_items       SET discount_pct = discount_pct / 100;
UPDATE purchase_orders       SET discount_pct = discount_pct / 100;
UPDATE purchase_order_items  SET discount_pct = discount_pct / 100;

-- Revert TYPE to NUMERIC(5,4)
ALTER TABLE quotations            ALTER COLUMN discount_pct TYPE NUMERIC(5,4);
ALTER TABLE quotation_items       ALTER COLUMN discount_pct TYPE NUMERIC(5,4);
ALTER TABLE purchase_orders       ALTER COLUMN discount_pct TYPE NUMERIC(5,4);
ALTER TABLE purchase_order_items  ALTER COLUMN discount_pct TYPE NUMERIC(5,4);

-- Restore old CHECK 0..1
ALTER TABLE quotations
  ADD CONSTRAINT quotations_discount_pct_check
  CHECK (discount_pct >= 0 AND discount_pct <= 1);
ALTER TABLE quotation_items
  ADD CONSTRAINT quotation_items_discount_pct_check
  CHECK (discount_pct >= 0 AND discount_pct <= 1);
ALTER TABLE purchase_orders
  ADD CONSTRAINT purchase_orders_discount_pct_check
  CHECK (discount_pct >= 0 AND discount_pct <= 1);
ALTER TABLE purchase_order_items
  ADD CONSTRAINT purchase_order_items_discount_pct_check
  CHECK (discount_pct >= 0 AND discount_pct <= 1);

-- Restore old GENERATED (no division)
ALTER TABLE quotation_items ADD COLUMN discount_amount NUMERIC(15,2)
  GENERATED ALWAYS AS (
    CASE WHEN item_type = 'product'
         THEN qty * selling_price * discount_pct
         ELSE 0 END
  ) STORED;

ALTER TABLE quotation_items ADD COLUMN subtotal NUMERIC(15,2)
  GENERATED ALWAYS AS (
    CASE WHEN item_type = 'product'
         THEN qty * selling_price * (1 - discount_pct)
         ELSE qty * selling_price END
  ) STORED;

ALTER TABLE purchase_order_items ADD COLUMN discount_amount NUMERIC(15,2)
  GENERATED ALWAYS AS (
    CASE WHEN item_type = 'product'
         THEN qty * selling_price * discount_pct
         ELSE 0 END
  ) STORED;

ALTER TABLE purchase_order_items ADD COLUMN subtotal NUMERIC(15,2)
  GENERATED ALWAYS AS (
    CASE WHEN item_type = 'product'
         THEN qty * selling_price * (1 - discount_pct)
         ELSE qty * selling_price END
  ) STORED;

-- Restore old triggers.
CREATE TRIGGER trg_protect_quotation_discount
BEFORE UPDATE OF discount_pct ON quotations
FOR EACH ROW
EXECUTE FUNCTION trg_fn_protect_quotation_discount();

CREATE TRIGGER trg_cascade_quotation_discount
AFTER UPDATE OF discount_pct ON quotations
FOR EACH ROW
WHEN (OLD.discount_pct IS DISTINCT FROM NEW.discount_pct)
EXECUTE FUNCTION trg_fn_cascade_quotation_discount();

-- Restore view.
CREATE VIEW quotation_reconciliation AS
SELECT
  q.id, q.quotation_no,
  q.total AS header_total,
  COALESCE(SUM(qi.total_selling), 0) AS items_total,
  q.total - COALESCE(SUM(qi.total_selling), 0) AS diff,
  q.total_discount AS header_discount,
  COALESCE(SUM(qi.discount_amount), 0) AS items_discount
FROM quotations q
LEFT JOIN quotation_items qi ON qi.quotation_id = q.id
GROUP BY q.id, q.quotation_no, q.total, q.total_discount;

-- Restore fn_create_quotation stub (raises exception — re-apply 00009 for full restore)
CREATE FUNCTION fn_create_quotation(
  p_company_client_id  BIGINT,
  p_contact_id         BIGINT,
  p_client_ref_no      TEXT,
  p_vessel_name        TEXT,
  p_payment_terms      TEXT,
  p_validity_days      INT,
  p_discount_pct       NUMERIC(5,4),
  p_shipping_address   TEXT,
  p_shipping_days      INT,
  p_shipping_cost      NUMERIC(15,2),
  p_items              JSONB,
  p_created_by         BIGINT,
  p_notes              TEXT DEFAULT NULL,
  p_status             TEXT DEFAULT 'draft'
) RETURNS BIGINT AS $$
BEGIN
  RAISE EXCEPTION 'fn_create_quotation rolled back to 0..1 signature stub — reapply 00009 to use full body';
END;
$$ LANGUAGE plpgsql;

-- +goose StatementEnd
