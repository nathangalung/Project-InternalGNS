-- +goose Up
-- +goose StatementBegin

-- 00020 PO+INVOICE ITEMS FULL SNAPSHOT
-- Adds item_name + ship_destination on po_items.
-- Adds ship_destination on invoice_items.
-- Updates fn_create_purchase_order, fn_create_invoice to capture.

ALTER TABLE purchase_order_items
  ADD COLUMN item_name        TEXT,
  ADD COLUMN item_code        VARCHAR(20),
  ADD COLUMN ship_destination VARCHAR(255);

ALTER TABLE invoice_items
  ADD COLUMN ship_destination VARCHAR(255);

UPDATE purchase_order_items poi
SET item_name        = COALESCE(qi.requested_name, ''),
    item_code        = qi.requested_impa,
    ship_destination = qi.ship_destination
FROM quotation_items qi
WHERE poi.quotation_item_id = qi.id;

UPDATE invoice_items ii
SET ship_destination = qi.ship_destination
FROM quotation_items qi
WHERE ii.quotation_item_id = qi.id;

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
    item_name, item_code, ship_destination,
    is_available, created_by, updated_by
  )
  SELECT
    v_po_id, qi.id, qi.line_number, qi.item_type,
    qi.offered_item_id, qi.qty, qi.unit_id, qi.selling_price, qi.cost_price,
    COALESCE(qi.requested_name, ''), qi.requested_impa, qi.ship_destination,
    qi.is_available, p_user_id, p_user_id
  FROM quotation_items qi
  WHERE qi.quotation_id = p_quotation_id
  ORDER BY qi.line_number;

  RETURN v_po_id;
END;
$$ LANGUAGE plpgsql;
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
    qty, unit_price, cost_price, ship_destination,
    created_by, updated_by
  )
  SELECT
    v_inv_id, qi.id, qi.item_type, qi.line_number,
    qi.requested_name, qi.requested_impa, qi.offered_item_id, qi.unit_id, u.code,
    qi.qty, qi.selling_price, qi.cost_price, qi.ship_destination,
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
    is_available, created_by, updated_by
  )
  SELECT
    v_po_id, qi.id, qi.line_number, qi.item_type,
    qi.offered_item_id, qi.qty, qi.unit_id, qi.selling_price, qi.cost_price,
    qi.is_available, p_user_id, p_user_id
  FROM quotation_items qi
  WHERE qi.quotation_id = p_quotation_id
  ORDER BY qi.line_number;

  RETURN v_po_id;
END;
$$ LANGUAGE plpgsql;

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

ALTER TABLE invoice_items DROP COLUMN IF EXISTS ship_destination;
ALTER TABLE purchase_order_items
  DROP COLUMN IF EXISTS ship_destination,
  DROP COLUMN IF EXISTS item_code,
  DROP COLUMN IF EXISTS item_name;

-- +goose StatementEnd
