-- +goose Up

-- 00017 CORRECT 00016 SIDE EFFECTS
-- 00016 misread invoices.dpp semantics. invoices.dpp is gross taxable
-- (same meaning as quotations.subtotal), and invoices.dpp_nilai_lain is
-- a derived 11/12 column. Step 1 revert backfill. Step 2 revert
-- fn_create_invoice. Step 3 fix invoices.total formula (still
-- subtotal*1.0267 bug, like quotations.grand_total was).

-- Step 1 revert dpp backfill
UPDATE invoices i
SET dpp = q.subtotal
FROM quotations q
WHERE i.quotation_id = q.id
  AND i.dpp = q.dpp_nilai_lain
  AND q.subtotal IS NOT NULL;

-- Step 2 revert fn_create_invoice
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION fn_create_invoice(
  p_po_id   BIGINT,
  p_user_id BIGINT
) RETURNS BIGINT AS $$
DECLARE
  v_inv_id        BIGINT;
  v_inv_no        TEXT;
  v_quotation_id  BIGINT;
  v_company_id    BIGINT;
  v_dpp           NUMERIC(15,2);
BEGIN
  SELECT id INTO v_inv_id FROM invoices WHERE po_id = p_po_id;
  IF v_inv_id IS NOT NULL THEN
    RETURN v_inv_id;
  END IF;

  SELECT quotation_id, company_client_id INTO v_quotation_id, v_company_id
  FROM purchase_orders WHERE id = p_po_id;

  IF v_quotation_id IS NULL THEN
    RAISE EXCEPTION 'Purchase order % not found', p_po_id;
  END IF;

  SELECT subtotal INTO v_dpp FROM quotations WHERE id = v_quotation_id;

  v_inv_no := fn_next_doc_no('INV', v_company_id);

  INSERT INTO invoices (
    invoice_no, quotation_id, po_id, company_client_id,
    invoice_date, due_date, subtotal, dpp,
    status, created_by, updated_by
  ) VALUES (
    v_inv_no, v_quotation_id, p_po_id, v_company_id,
    CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days',
    COALESCE(v_dpp, 0), COALESCE(v_dpp, 0),
    'draft', p_user_id, p_user_id
  ) RETURNING id INTO v_inv_id;

  INSERT INTO invoice_items (
    invoice_id, quotation_item_id, line_type,
    item_name, qty, unit_price,
    created_by, updated_by
  )
  SELECT
    v_inv_id, qi.id, qi.item_type,
    qi.requested_name, qi.qty, qi.selling_price,
    p_user_id, p_user_id
  FROM quotation_items qi
  WHERE qi.quotation_id = v_quotation_id
  ORDER BY qi.line_number;

  RETURN v_inv_id;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- Step 3 fix invoices.total
ALTER TABLE invoices DROP COLUMN total;
ALTER TABLE invoices
  ADD COLUMN total NUMERIC(15,2)
  GENERATED ALWAYS AS (dpp * 1.11) STORED;


-- +goose Down

ALTER TABLE invoices DROP COLUMN total;
ALTER TABLE invoices
  ADD COLUMN total NUMERIC(15,2)
  GENERATED ALWAYS AS (dpp * 11.0 / 12.0 * 1.12) STORED;

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION fn_create_invoice(
  p_po_id   BIGINT,
  p_user_id BIGINT
) RETURNS BIGINT AS $$
DECLARE
  v_inv_id        BIGINT;
  v_inv_no        TEXT;
  v_quotation_id  BIGINT;
  v_company_id    BIGINT;
  v_subtotal      NUMERIC(15,2);
  v_dpp           NUMERIC(15,2);
BEGIN
  SELECT id INTO v_inv_id FROM invoices WHERE po_id = p_po_id;
  IF v_inv_id IS NOT NULL THEN
    RETURN v_inv_id;
  END IF;

  SELECT quotation_id, company_client_id INTO v_quotation_id, v_company_id
  FROM purchase_orders WHERE id = p_po_id;

  IF v_quotation_id IS NULL THEN
    RAISE EXCEPTION 'Purchase order % not found', p_po_id;
  END IF;

  SELECT subtotal, dpp_nilai_lain
  INTO v_subtotal, v_dpp
  FROM quotations WHERE id = v_quotation_id;

  v_inv_no := fn_next_doc_no('INV', v_company_id);

  INSERT INTO invoices (
    invoice_no, quotation_id, po_id, company_client_id,
    invoice_date, due_date, subtotal, dpp,
    status, created_by, updated_by
  ) VALUES (
    v_inv_no, v_quotation_id, p_po_id, v_company_id,
    CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days',
    COALESCE(v_subtotal, 0), COALESCE(v_dpp, 0),
    'draft', p_user_id, p_user_id
  ) RETURNING id INTO v_inv_id;

  INSERT INTO invoice_items (
    invoice_id, quotation_item_id, line_type,
    item_name, qty, unit_price,
    created_by, updated_by
  )
  SELECT
    v_inv_id, qi.id, qi.item_type,
    qi.requested_name, qi.qty, qi.selling_price,
    p_user_id, p_user_id
  FROM quotation_items qi
  WHERE qi.quotation_id = v_quotation_id
  ORDER BY qi.line_number;

  RETURN v_inv_id;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

UPDATE invoices i
SET dpp = q.dpp_nilai_lain
FROM quotations q
WHERE i.quotation_id = q.id
  AND i.dpp = q.subtotal
  AND q.dpp_nilai_lain IS NOT NULL;
