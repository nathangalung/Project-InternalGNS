-- +goose Up
-- +goose StatementBegin

-- 00004 — VARIABLE DISCOUNT PCT
-- Replace hardcoded 5% (0.05) in quotation_items + po_items
-- GENERATED columns with variable discount_pct.
---- Rules:
-- * Header (quotations / purchase_orders) holds discount_pct (source of truth)
-- * Items inherit via BEFORE INSERT trigger (denorm snapshot for GENERATED)
-- * PO header inherits from related quotation on INSERT
-- * Header.discount_pct UPDATE blocked if status != 'draft'
-- → to change, create a new quotation version (revision system)
-- * Cascade to items only fires on draft (blocked in BEFORE trigger)
-- * Range: NUMERIC(5,4) CHECK 0..1 (0% – 100%)


-- 1. Add discount_pct columns (nullable initially)
ALTER TABLE quotations
  ADD COLUMN discount_pct NUMERIC(5,4)
  CHECK (discount_pct >= 0 AND discount_pct <= 1);

ALTER TABLE purchase_orders
  ADD COLUMN discount_pct NUMERIC(5,4)
  CHECK (discount_pct >= 0 AND discount_pct <= 1);

ALTER TABLE quotation_items
  ADD COLUMN discount_pct NUMERIC(5,4)
  CHECK (discount_pct >= 0 AND discount_pct <= 1);

ALTER TABLE purchase_order_items
  ADD COLUMN discount_pct NUMERIC(5,4)
  CHECK (discount_pct >= 0 AND discount_pct <= 1);


-- 2. Backfill existing rows with 0.05 (preserve existing values)
UPDATE quotations            SET discount_pct = 0.05 WHERE discount_pct IS NULL;
UPDATE purchase_orders       SET discount_pct = 0.05 WHERE discount_pct IS NULL;
UPDATE quotation_items       SET discount_pct = 0.05 WHERE discount_pct IS NULL;
UPDATE purchase_order_items  SET discount_pct = 0.05 WHERE discount_pct IS NULL;


-- 3. Now NOT NULL (no DB-level DEFAULT — app must provide)
ALTER TABLE quotations            ALTER COLUMN discount_pct SET NOT NULL;
ALTER TABLE purchase_orders       ALTER COLUMN discount_pct SET NOT NULL;
ALTER TABLE quotation_items       ALTER COLUMN discount_pct SET NOT NULL;
ALTER TABLE purchase_order_items  ALTER COLUMN discount_pct SET NOT NULL;


-- 4. Drop & recreate GENERATED columns (use new discount_pct)-- NOTE: quotation_reconciliation view depends on quotation_items.discount_amount,
-- so drop view first, recreate after column is rebuilt.
DROP VIEW IF EXISTS quotation_reconciliation;

-- quotation_items.discount_amount
ALTER TABLE quotation_items DROP COLUMN discount_amount;
ALTER TABLE quotation_items ADD COLUMN discount_amount NUMERIC(15,2)
  GENERATED ALWAYS AS (
    CASE WHEN item_type = 'product'
         THEN qty * selling_price * discount_pct
         ELSE 0 END
  ) STORED;

-- quotation_items.subtotal
ALTER TABLE quotation_items DROP COLUMN subtotal;
ALTER TABLE quotation_items ADD COLUMN subtotal NUMERIC(15,2)
  GENERATED ALWAYS AS (
    CASE WHEN item_type = 'product'
         THEN qty * selling_price * (1 - discount_pct)
         ELSE qty * selling_price END
  ) STORED;

-- purchase_order_items.discount_amount
ALTER TABLE purchase_order_items DROP COLUMN discount_amount;
ALTER TABLE purchase_order_items ADD COLUMN discount_amount NUMERIC(15,2)
  GENERATED ALWAYS AS (
    CASE WHEN item_type = 'product'
         THEN qty * selling_price * discount_pct
         ELSE 0 END
  ) STORED;

-- purchase_order_items.subtotal
ALTER TABLE purchase_order_items DROP COLUMN subtotal;
ALTER TABLE purchase_order_items ADD COLUMN subtotal NUMERIC(15,2)
  GENERATED ALWAYS AS (
    CASE WHEN item_type = 'product'
         THEN qty * selling_price * (1 - discount_pct)
         ELSE qty * selling_price END
  ) STORED;

-- Recreate view dropped in step 4
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

-- +goose StatementEnd


-- 5. BEFORE INSERT trigger: quotation_items inherit from header
-- +goose StatementBegin
CREATE FUNCTION trg_fn_inherit_quotation_discount() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.discount_pct IS NULL THEN
    SELECT discount_pct INTO NEW.discount_pct
    FROM quotations WHERE id = NEW.quotation_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd


-- +goose StatementBegin
CREATE TRIGGER trg_inherit_quotation_discount
BEFORE INSERT ON quotation_items
FOR EACH ROW
EXECUTE FUNCTION trg_fn_inherit_quotation_discount();
-- +goose StatementEnd


-- 6. BEFORE INSERT trigger: po_items inherit from PO header
-- +goose StatementBegin
CREATE FUNCTION trg_fn_inherit_po_discount() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.discount_pct IS NULL THEN
    SELECT discount_pct INTO NEW.discount_pct
    FROM purchase_orders WHERE id = NEW.po_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd


-- +goose StatementBegin
CREATE TRIGGER trg_inherit_po_discount
BEFORE INSERT ON purchase_order_items
FOR EACH ROW
EXECUTE FUNCTION trg_fn_inherit_po_discount();
-- +goose StatementEnd


-- 7. BEFORE INSERT trigger: PO inherits from quotation
-- +goose StatementBegin
CREATE FUNCTION trg_fn_po_inherit_quotation_discount() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.discount_pct IS NULL THEN
    SELECT discount_pct INTO NEW.discount_pct
    FROM quotations WHERE id = NEW.quotation_id;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd


-- +goose StatementBegin
CREATE TRIGGER trg_po_inherit_quotation_discount
BEFORE INSERT ON purchase_orders
FOR EACH ROW
EXECUTE FUNCTION trg_fn_po_inherit_quotation_discount();
-- +goose StatementEnd


-- 8. PROTECT: block discount_pct UPDATE if status != 'draft'
-- +goose StatementBegin
CREATE FUNCTION trg_fn_protect_quotation_discount() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.discount_pct IS DISTINCT FROM OLD.discount_pct
     AND OLD.status != 'draft' THEN
    RAISE EXCEPTION
      'Cannot modify discount_pct on quotation % (status %). Create new version (revision) instead.',
      OLD.quotation_no, OLD.status;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd


-- +goose StatementBegin
CREATE TRIGGER trg_protect_quotation_discount
BEFORE UPDATE OF discount_pct ON quotations
FOR EACH ROW
EXECUTE FUNCTION trg_fn_protect_quotation_discount();
-- +goose StatementEnd


-- 9. CASCADE: quotation_pct change → propagate to items
-- +goose StatementBegin
CREATE FUNCTION trg_fn_cascade_quotation_discount() RETURNS TRIGGER AS $$
BEGIN
  UPDATE quotation_items
  SET discount_pct = NEW.discount_pct
  WHERE quotation_id = NEW.id;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd


-- +goose StatementBegin
CREATE TRIGGER trg_cascade_quotation_discount
AFTER UPDATE OF discount_pct ON quotations
FOR EACH ROW
WHEN (OLD.discount_pct IS DISTINCT FROM NEW.discount_pct)
EXECUTE FUNCTION trg_fn_cascade_quotation_discount();
-- +goose StatementEnd


-- 10. Column documentation
-- +goose StatementBegin
COMMENT ON COLUMN quotations.discount_pct IS
  'Discount rate for all items in this quotation (NUMERIC 0..1, e.g. 0.05 = 5%). No DB default; app must set on INSERT. UPDATE blocked by trg_protect_quotation_discount once status != draft.';

COMMENT ON COLUMN quotation_items.discount_pct IS
  'Snapshot of discount_pct from quotations header. Auto-inherited via trg_inherit_quotation_discount BEFORE INSERT; header UPDATE cascades via trg_cascade_quotation_discount.';

COMMENT ON COLUMN purchase_orders.discount_pct IS
  'Discount rate for this PO, snapshot from quotation at PO creation. Auto-inherited via trg_po_inherit_quotation_discount.';

COMMENT ON COLUMN purchase_order_items.discount_pct IS
  'Snapshot of purchase_orders.discount_pct, auto-inherited via trg_inherit_po_discount.';
-- +goose StatementEnd


-- +goose Down
-- +goose StatementBegin

-- Drop triggers
DROP TRIGGER  IF EXISTS trg_cascade_quotation_discount ON quotations;
DROP FUNCTION IF EXISTS trg_fn_cascade_quotation_discount();
DROP TRIGGER  IF EXISTS trg_protect_quotation_discount ON quotations;
DROP FUNCTION IF EXISTS trg_fn_protect_quotation_discount();
DROP TRIGGER  IF EXISTS trg_po_inherit_quotation_discount ON purchase_orders;
DROP FUNCTION IF EXISTS trg_fn_po_inherit_quotation_discount();
DROP TRIGGER  IF EXISTS trg_inherit_po_discount ON purchase_order_items;
DROP FUNCTION IF EXISTS trg_fn_inherit_po_discount();
DROP TRIGGER  IF EXISTS trg_inherit_quotation_discount ON quotation_items;
DROP FUNCTION IF EXISTS trg_fn_inherit_quotation_discount();

-- Drop view (depends on discount_amount being reverted)
DROP VIEW IF EXISTS quotation_reconciliation;

-- Revert GENERATED to hardcoded 0.05
ALTER TABLE purchase_order_items DROP COLUMN subtotal;
ALTER TABLE purchase_order_items ADD COLUMN subtotal NUMERIC(15,2)
  GENERATED ALWAYS AS (
    qty * selling_price * CASE WHEN item_type = 'product' THEN 0.95 ELSE 1 END
  ) STORED;
ALTER TABLE purchase_order_items DROP COLUMN discount_amount;
ALTER TABLE purchase_order_items ADD COLUMN discount_amount NUMERIC(15,2)
  GENERATED ALWAYS AS (
    CASE WHEN item_type = 'product' THEN qty * selling_price * 0.05 ELSE 0 END
  ) STORED;

ALTER TABLE quotation_items DROP COLUMN subtotal;
ALTER TABLE quotation_items ADD COLUMN subtotal NUMERIC(15,2)
  GENERATED ALWAYS AS (
    qty * selling_price * CASE WHEN item_type = 'product' THEN 0.95 ELSE 1 END
  ) STORED;
ALTER TABLE quotation_items DROP COLUMN discount_amount;
ALTER TABLE quotation_items ADD COLUMN discount_amount NUMERIC(15,2)
  GENERATED ALWAYS AS (
    CASE WHEN item_type = 'product' THEN qty * selling_price * 0.05 ELSE 0 END
  ) STORED;

-- Drop discount_pct columns
ALTER TABLE purchase_order_items DROP COLUMN IF EXISTS discount_pct;
ALTER TABLE quotation_items      DROP COLUMN IF EXISTS discount_pct;
ALTER TABLE purchase_orders      DROP COLUMN IF EXISTS discount_pct;
ALTER TABLE quotations           DROP COLUMN IF EXISTS discount_pct;

-- Recreate view (with old discount_amount column reference, post-revert)
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

-- +goose StatementEnd
