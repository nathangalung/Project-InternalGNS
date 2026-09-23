-- +goose Up

-- PO read model, uniqueness and edit locks.
--
-- 1. v_po_totals gives every PO screen the same money figures the invoice is
--    billed from: DPP is the sum of the per-line net subtotals, and the tax
--    figures are rounded per line and then summed, exactly as fn_create_invoice
--    does. Before this, the detail screen recomputed them from the quotation's
--    discount, so a PO whose discount or lines had been edited showed figures
--    no stored record contained.
-- 2. purchase_orders.quotation_id becomes UNIQUE: fn_create_purchase_order
--    already assumes one PO per quotation and only a constraint makes that
--    true under concurrent acceptances.
-- 3. po_number holds the client's own PO number once it is edited, so it is
--    unique per client rather than globally. A number another client already
--    used no longer blocks acceptance.
--
-- Pre-flight on production data before applying:
--   SELECT quotation_id FROM purchase_orders
--    GROUP BY quotation_id HAVING COUNT(*) > 1;
--   SELECT company_client_id, po_number FROM purchase_orders
--    GROUP BY company_client_id, po_number HAVING COUNT(*) > 1;

CREATE VIEW v_po_totals AS
SELECT poi.po_id,
       SUM(poi.subtotal)                                                   AS po_subtotal,
       SUM(poi.total_selling) FILTER (WHERE poi.item_type = 'product')     AS po_total_produk,
       SUM(poi.subtotal - poi.total_cost)
         FILTER (WHERE poi.item_type = 'product')                          AS po_total_profit,
       SUM(ROUND(poi.subtotal * 11.0 / 12.0, 2))                           AS po_dpp_nilai_lain,
       SUM(ROUND(ROUND(poi.subtotal * 11.0 / 12.0, 2) * 0.12, 2))          AS po_ppn_amount,
       SUM(poi.subtotal)
         + SUM(ROUND(ROUND(poi.subtotal * 11.0 / 12.0, 2) * 0.12, 2))      AS po_grand_total,
       SUM(ROUND(poi.qty * poi.selling_price, 2)) - SUM(poi.subtotal)      AS po_total_discount
FROM purchase_order_items poi
GROUP BY poi.po_id;

COMMENT ON VIEW v_po_totals IS
  'PO money figures mirroring fn_create_invoice: per-line rounding, summed.';

ALTER TABLE purchase_orders DROP CONSTRAINT purchase_orders_po_number_key;

CREATE UNIQUE INDEX uq_purchase_orders_client_po_number
  ON purchase_orders (company_client_id, po_number);

CREATE UNIQUE INDEX uq_purchase_orders_quotation_id
  ON purchase_orders (quotation_id);

DROP INDEX idx_po_quotation;

-- 4. Details and notes move behind functions so both carry an optimistic lock
--    (P0010) and details refuse the edit once the invoice has left draft
--    (P0013). po_number and po_date print on the invoice, so editing them
--    after it is filed would rewrite a document already sent to the client.
--    A cancelled invoice is void, so it does not hold the PO.

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION fn_update_po_details(
  p_po_id     BIGINT,
  p_if_match  INT,
  p_po_number TEXT,
  p_po_date   DATE,
  p_user_id   BIGINT
) RETURNS INT AS $$
DECLARE
  v_current INT;
  v_new     INT;
BEGIN
  SELECT row_version INTO v_current
  FROM purchase_orders
  WHERE id = p_po_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order % not found', p_po_id
      USING ERRCODE = 'P0011';
  END IF;

  IF p_if_match IS NOT NULL AND v_current <> p_if_match THEN
    RAISE EXCEPTION 'row_version mismatch (expected %, got %)', v_current, p_if_match
      USING ERRCODE = 'P0010';
  END IF;

  IF EXISTS (
    SELECT 1 FROM invoices
    WHERE po_id = p_po_id AND status IN ('sent', 'paid', 'overdue')
  ) THEN
    RAISE EXCEPTION 'PO % has a filed invoice; po_number and po_date are read-only', p_po_id
      USING ERRCODE = 'P0013';
  END IF;

  UPDATE purchase_orders
  SET po_number  = p_po_number,
      po_date    = p_po_date,
      updated_by = p_user_id
  WHERE id = p_po_id
  RETURNING row_version INTO v_new;

  RETURN v_new;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION fn_update_po_notes(
  p_po_id    BIGINT,
  p_if_match INT,
  p_notes    TEXT,
  p_user_id  BIGINT
) RETURNS INT AS $$
DECLARE
  v_current INT;
  v_new     INT;
BEGIN
  SELECT row_version INTO v_current
  FROM purchase_orders
  WHERE id = p_po_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order % not found', p_po_id
      USING ERRCODE = 'P0011';
  END IF;

  IF p_if_match IS NOT NULL AND v_current <> p_if_match THEN
    RAISE EXCEPTION 'row_version mismatch (expected %, got %)', v_current, p_if_match
      USING ERRCODE = 'P0010';
  END IF;

  UPDATE purchase_orders
  SET notes      = p_notes,
      updated_by = p_user_id
  WHERE id = p_po_id
  RETURNING row_version INTO v_new;

  RETURN v_new;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- +goose Down

DROP FUNCTION IF EXISTS fn_update_po_notes(BIGINT, INT, TEXT, BIGINT);
DROP FUNCTION IF EXISTS fn_update_po_details(BIGINT, INT, TEXT, DATE, BIGINT);

CREATE INDEX idx_po_quotation ON purchase_orders (quotation_id);
DROP INDEX uq_purchase_orders_quotation_id;
DROP INDEX uq_purchase_orders_client_po_number;
ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_po_number_key UNIQUE (po_number);
DROP VIEW v_po_totals;
