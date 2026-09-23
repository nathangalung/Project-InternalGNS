-- +goose Up

-- PO read model, uniqueness, edit locks and document identity.
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

-- 5. A PO line snapshots the offered catalog item, falling back to the
--    customer's request text for unmatched lines. The PO, the delivery note
--    and the invoice built from it described goods by the request text, so
--    no document said what was actually supplied. Existing lines keep their
--    snapshot; a name edited later on the PO is left alone.

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION fn_create_purchase_order(
  p_quotation_id BIGINT,
  p_user_id      BIGINT
) RETURNS BIGINT AS $$
DECLARE
  v_po_id        BIGINT;
  v_po_no        TEXT;
  v_company_id   BIGINT;
  v_contact_id   BIGINT;
BEGIN
  SELECT id INTO v_po_id FROM purchase_orders WHERE quotation_id = p_quotation_id;
  IF v_po_id IS NOT NULL THEN
    RETURN v_po_id;
  END IF;

  SELECT company_client_id, contact_id
  INTO v_company_id, v_contact_id
  FROM quotations WHERE id = p_quotation_id;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Quotation % not found', p_quotation_id;
  END IF;

  v_po_no := fn_next_doc_no('PO', v_company_id);

  INSERT INTO purchase_orders (
    po_number, quotation_id, company_client_id, contact_id,
    po_date, status, created_by, updated_by
  ) VALUES (
    v_po_no, p_quotation_id, v_company_id, v_contact_id,
    CURRENT_DATE, 'PENDING', p_user_id, p_user_id
  ) RETURNING id INTO v_po_id;

  INSERT INTO purchase_order_items (
    po_id, quotation_item_id, line_number, item_type,
    offered_item_id, qty, unit_id, selling_price, cost_price,
    item_name, item_code, ship_destination, shipping_days,
    is_available, created_by, updated_by
  )
  SELECT
    v_po_id, qi.id, qi.line_number, qi.item_type,
    qi.offered_item_id, qi.qty, qi.unit_id, qi.selling_price, qi.cost_price,
    COALESCE(NULLIF(oi.name, ''), qi.requested_name, ''),
    COALESCE(NULLIF(oi.impa_code, ''), qi.requested_impa),
    qi.ship_destination, qi.shipping_days,
    qi.is_available, p_user_id, p_user_id
  FROM quotation_items qi
  LEFT JOIN items oi ON oi.id = qi.offered_item_id
  WHERE qi.quotation_id = p_quotation_id
  ORDER BY qi.line_number;

  RETURN v_po_id;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- 6. The delivery note number is issued when work starts (ON_PROGRESS), the
--    first point the note can be printed, instead of at DELIVERED. The PDF
--    printed a number derived from the quotation while a different one was
--    stored, so the printed and filed numbers never matched. A revert keeps
--    the number already issued. POs already in progress get theirs now.

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION fn_change_po_status(
  p_po_id      BIGINT,
  p_new_status TEXT,
  p_user_id    BIGINT
) RETURNS VOID AS $$
DECLARE
  v_old        TEXT;
  v_ok         BOOLEAN;
  v_company_id BIGINT;
  v_dn_current TEXT;
  v_dn         TEXT;
BEGIN
  SELECT status, company_client_id, delivery_note_number
    INTO v_old, v_company_id, v_dn_current
    FROM purchase_orders WHERE id = p_po_id FOR UPDATE;

  IF v_old IS NULL THEN
    RAISE EXCEPTION 'Purchase order % not found', p_po_id
      USING ERRCODE = 'P0011';
  END IF;

  IF v_old = p_new_status THEN
    RETURN;
  END IF;

  IF v_old = 'DELIVERED' AND p_new_status = 'ON_PROGRESS'
     AND EXISTS (SELECT 1 FROM invoices WHERE po_id = p_po_id) THEN
    RAISE EXCEPTION 'PO % has an invoice; cannot revert from DELIVERED', p_po_id
      USING ERRCODE = 'P0013';
  END IF;

  v_ok := CASE
    WHEN v_old = 'PENDING'     AND p_new_status IN ('UPLOADED')                        THEN TRUE
    WHEN v_old = 'UPLOADED'    AND p_new_status IN ('ON_PROGRESS','PENDING')           THEN TRUE
    WHEN v_old = 'ON_PROGRESS' AND p_new_status IN ('DELIVERED','UPLOADED')            THEN TRUE
    WHEN v_old = 'DELIVERED'   AND p_new_status IN ('ON_PROGRESS')                     THEN TRUE
    ELSE FALSE
  END;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'Invalid PO status transition: % -> %', v_old, p_new_status
      USING ERRCODE = 'P0012';
  END IF;

  IF p_new_status IN ('ON_PROGRESS', 'DELIVERED') AND v_dn_current IS NULL THEN
    v_dn := fn_next_doc_no('DN', v_company_id);
  END IF;

  UPDATE purchase_orders
  SET status               = p_new_status,
      delivery_note_number = COALESCE(v_dn, delivery_note_number),
      updated_by           = p_user_id
  WHERE id = p_po_id;

  IF p_new_status = 'DELIVERED' THEN
    PERFORM fn_create_invoice(p_po_id, p_user_id);
  END IF;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- +goose StatementBegin
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT id, company_client_id
    FROM purchase_orders
    WHERE status IN ('ON_PROGRESS', 'DELIVERED')
      AND delivery_note_number IS NULL
    ORDER BY id
  LOOP
    UPDATE purchase_orders
    SET delivery_note_number = fn_next_doc_no('DN', r.company_client_id)
    WHERE id = r.id;
  END LOOP;
END;
$$;
-- +goose StatementEnd

-- +goose Down

-- Restore the 00046 and 00043 bodies.

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION fn_change_po_status(
  p_po_id      BIGINT,
  p_new_status TEXT,
  p_user_id    BIGINT
) RETURNS VOID AS $$
DECLARE
  v_old        TEXT;
  v_ok         BOOLEAN;
  v_company_id BIGINT;
  v_dn_current TEXT;
  v_dn         TEXT;
BEGIN
  SELECT status, company_client_id, delivery_note_number
    INTO v_old, v_company_id, v_dn_current
    FROM purchase_orders WHERE id = p_po_id FOR UPDATE;

  IF v_old IS NULL THEN
    RAISE EXCEPTION 'Purchase order % not found', p_po_id
      USING ERRCODE = 'P0011';
  END IF;

  IF v_old = p_new_status THEN
    RETURN;
  END IF;

  IF v_old = 'DELIVERED' AND p_new_status = 'ON_PROGRESS'
     AND EXISTS (SELECT 1 FROM invoices WHERE po_id = p_po_id) THEN
    RAISE EXCEPTION 'PO % has an invoice; cannot revert from DELIVERED', p_po_id
      USING ERRCODE = 'P0013';
  END IF;

  v_ok := CASE
    WHEN v_old = 'PENDING'     AND p_new_status IN ('UPLOADED')                        THEN TRUE
    WHEN v_old = 'UPLOADED'    AND p_new_status IN ('ON_PROGRESS','PENDING')           THEN TRUE
    WHEN v_old = 'ON_PROGRESS' AND p_new_status IN ('DELIVERED','UPLOADED')            THEN TRUE
    WHEN v_old = 'DELIVERED'   AND p_new_status IN ('ON_PROGRESS')                     THEN TRUE
    ELSE FALSE
  END;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'Invalid PO status transition: % -> %', v_old, p_new_status
      USING ERRCODE = 'P0012';
  END IF;

  IF p_new_status = 'DELIVERED' AND v_dn_current IS NULL THEN
    v_dn := fn_next_doc_no('DN', v_company_id);
  END IF;

  UPDATE purchase_orders
  SET status               = p_new_status,
      delivery_note_number = COALESCE(v_dn, delivery_note_number),
      updated_by           = p_user_id
  WHERE id = p_po_id;

  IF p_new_status = 'DELIVERED' THEN
    PERFORM fn_create_invoice(p_po_id, p_user_id);
  END IF;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION fn_create_purchase_order(
  p_quotation_id BIGINT,
  p_user_id      BIGINT
) RETURNS BIGINT AS $$
DECLARE
  v_po_id        BIGINT;
  v_po_no        TEXT;
  v_company_id   BIGINT;
  v_contact_id   BIGINT;
BEGIN
  SELECT id INTO v_po_id FROM purchase_orders WHERE quotation_id = p_quotation_id;
  IF v_po_id IS NOT NULL THEN
    RETURN v_po_id;
  END IF;

  SELECT company_client_id, contact_id
  INTO v_company_id, v_contact_id
  FROM quotations WHERE id = p_quotation_id;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Quotation % not found', p_quotation_id;
  END IF;

  v_po_no := fn_next_doc_no('PO', v_company_id);

  INSERT INTO purchase_orders (
    po_number, quotation_id, company_client_id, contact_id,
    po_date, status, created_by, updated_by
  ) VALUES (
    v_po_no, p_quotation_id, v_company_id, v_contact_id,
    CURRENT_DATE, 'PENDING', p_user_id, p_user_id
  ) RETURNING id INTO v_po_id;

  INSERT INTO purchase_order_items (
    po_id, quotation_item_id, line_number, item_type,
    offered_item_id, qty, unit_id, selling_price, cost_price,
    item_name, item_code, ship_destination, shipping_days,
    is_available, created_by, updated_by
  )
  SELECT
    v_po_id, qi.id, qi.line_number, qi.item_type,
    qi.offered_item_id, qi.qty, qi.unit_id, qi.selling_price, qi.cost_price,
    COALESCE(qi.requested_name, ''), qi.requested_impa, qi.ship_destination, qi.shipping_days,
    qi.is_available, p_user_id, p_user_id
  FROM quotation_items qi
  WHERE qi.quotation_id = p_quotation_id
  ORDER BY qi.line_number;

  RETURN v_po_id;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

DROP FUNCTION IF EXISTS fn_update_po_notes(BIGINT, INT, TEXT, BIGINT);
DROP FUNCTION IF EXISTS fn_update_po_details(BIGINT, INT, TEXT, DATE, BIGINT);

CREATE INDEX idx_po_quotation ON purchase_orders (quotation_id);
DROP INDEX uq_purchase_orders_quotation_id;
DROP INDEX uq_purchase_orders_client_po_number;
ALTER TABLE purchase_orders ADD CONSTRAINT purchase_orders_po_number_key UNIQUE (po_number);
DROP VIEW v_po_totals;
