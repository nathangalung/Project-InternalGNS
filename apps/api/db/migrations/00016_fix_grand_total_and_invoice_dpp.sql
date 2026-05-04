-- +goose Up

-- 00016 FIX MONEY MATH BUGS
-- 1. Recompute quotations.grand_total. Old formula gave subtotal*1.0267
--    instead of subtotal*1.11. Underbilled clients by ~8.3% per invoice.
-- 2. Rewrite fn_create_invoice so invoices.dpp stores dpp_nilai_lain
--    (taxable base), not gross subtotal.
-- 3. Backfill invoices.dpp from source quotation.dpp_nilai_lain.

-- Step 1 grand_total
ALTER TABLE quotations DROP COLUMN grand_total;
ALTER TABLE quotations
  ADD COLUMN grand_total NUMERIC(15,2)
  GENERATED ALWAYS AS ((total - total_discount) * 1.11) STORED;

-- Step 2 fn_create_invoice
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

-- Step 3 backfill
UPDATE invoices i
SET dpp = q.dpp_nilai_lain
FROM quotations q
WHERE i.quotation_id = q.id
  AND i.dpp = q.subtotal
  AND q.dpp_nilai_lain IS NOT NULL;


-- +goose Down

ALTER TABLE quotations DROP COLUMN grand_total;
ALTER TABLE quotations
  ADD COLUMN grand_total NUMERIC(15,2)
  GENERATED ALWAYS AS ((total - total_discount) * 11.0 / 12.0 * 1.12) STORED;

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
