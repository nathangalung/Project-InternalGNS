-- +goose Up
-- +goose StatementBegin

-- 00019 ENRICH invoice_items SNAPSHOT FIELDS
-- Adds line_number, offered_item_id, cost_price, unit_id.
-- item_code, unit_code, goods_or_service already exist from baseline.

ALTER TABLE invoice_items
  ADD COLUMN line_number      SMALLINT,
  ADD COLUMN offered_item_id  BIGINT REFERENCES items(id) ON DELETE RESTRICT,
  ADD COLUMN cost_price       NUMERIC(15,2),
  ADD COLUMN unit_id          SMALLINT REFERENCES units(id) ON DELETE RESTRICT;

-- Backfill from linked quotation_items.
UPDATE invoice_items ii
SET line_number     = qi.line_number,
    item_code       = COALESCE(ii.item_code, qi.requested_impa),
    offered_item_id = qi.offered_item_id,
    cost_price      = qi.cost_price,
    unit_id         = qi.unit_id,
    unit_code       = COALESCE(ii.unit_code, u.code)
FROM quotation_items qi
LEFT JOIN units u ON u.id = qi.unit_id
WHERE ii.quotation_item_id = qi.id;

CREATE INDEX idx_invoice_items_offered_item ON invoice_items(offered_item_id);
CREATE INDEX idx_invoice_items_unit ON invoice_items(unit_id);

-- +goose StatementEnd


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
    invoice_id, quotation_item_id, line_type, line_number,
    item_name, item_code, offered_item_id, unit_id, unit_code,
    qty, unit_price, cost_price,
    created_by, updated_by
  )
  SELECT
    v_inv_id, qi.id, qi.item_type, qi.line_number,
    qi.requested_name, qi.requested_impa, qi.offered_item_id, qi.unit_id, u.code,
    qi.qty, qi.selling_price, qi.cost_price,
    p_user_id, p_user_id
  FROM quotation_items qi
  LEFT JOIN units u ON u.id = qi.unit_id
  WHERE qi.quotation_id = v_quotation_id
  ORDER BY qi.line_number;

  RETURN v_inv_id;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd


-- +goose Down
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

DROP INDEX IF EXISTS idx_invoice_items_unit;
DROP INDEX IF EXISTS idx_invoice_items_offered_item;

ALTER TABLE invoice_items
  DROP COLUMN IF EXISTS unit_id,
  DROP COLUMN IF EXISTS cost_price,
  DROP COLUMN IF EXISTS offered_item_id,
  DROP COLUMN IF EXISTS line_number;

-- +goose StatementEnd
