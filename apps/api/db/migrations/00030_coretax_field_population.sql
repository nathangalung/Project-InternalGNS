-- +goose Up
-- +goose StatementBegin

-- 00030 COrETAX field population
-- fn_create_invoice keeps 00021 sourcing from purchase_order_items so edited PO
-- prices flow through; adds goods_or_service snapshot ('B' product, 'J' shipping).
-- fn_change_po_status: stamp delivery_note_number on first DELIVERED transition.

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

  SELECT COALESCE(SUM(subtotal), 0) INTO v_dpp
  FROM purchase_order_items WHERE po_id = p_po_id;

  v_inv_no := fn_next_doc_no('INV', v_company_id);

  INSERT INTO invoices (
    invoice_no, quotation_id, po_id, company_client_id,
    invoice_date, due_date, subtotal, dpp,
    status, created_by, updated_by
  ) VALUES (
    v_inv_no, v_quotation_id, p_po_id, v_company_id,
    CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days',
    v_dpp, v_dpp,
    'draft', p_user_id, p_user_id
  ) RETURNING id INTO v_inv_id;

  INSERT INTO invoice_items (
    invoice_id, quotation_item_id, line_type, line_number,
    item_name, item_code, offered_item_id, unit_id, unit_code,
    qty, unit_price, cost_price, ship_destination, goods_or_service,
    dpp, dpp_nilai_lain, ppn_rate, ppn_amount,
    created_by, updated_by
  )
  SELECT
    v_inv_id, pi.quotation_item_id, pi.item_type, pi.line_number,
    COALESCE(pi.item_name, ''), pi.item_code, pi.offered_item_id, pi.unit_id, u.code,
    pi.qty,
    CASE
      WHEN pi.item_type = 'product' THEN pi.selling_price * (1 - pi.discount_pct / 100)
      ELSE pi.selling_price
    END,
    pi.cost_price,
    pi.ship_destination,
    CASE pi.item_type WHEN 'shipping' THEN 'J' ELSE 'B' END,
    pi.subtotal,
    ROUND(pi.subtotal * 11.0 / 12.0, 2),
    12.00,
    ROUND(pi.subtotal * 11.0 / 12.0 * 0.12, 2),
    p_user_id, p_user_id
  FROM purchase_order_items pi
  LEFT JOIN units u ON u.id = pi.unit_id
  WHERE pi.po_id = p_po_id
  ORDER BY pi.line_number;

  RETURN v_inv_id;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd


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
    RAISE EXCEPTION 'Purchase order % not found', p_po_id;
  END IF;

  IF v_old = p_new_status THEN
    RETURN;
  END IF;

  v_ok := CASE
    WHEN v_old = 'PENDING'     AND p_new_status IN ('UPLOADED')                        THEN TRUE
    WHEN v_old = 'UPLOADED'    AND p_new_status IN ('ON_PROGRESS','PENDING')           THEN TRUE
    WHEN v_old = 'ON_PROGRESS' AND p_new_status IN ('DELIVERED','UPLOADED')            THEN TRUE
    WHEN v_old = 'DELIVERED'   AND p_new_status IN ('ON_PROGRESS')                     THEN TRUE
    ELSE FALSE
  END;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'Invalid PO status transition: % -> %', v_old, p_new_status;
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


-- +goose StatementBegin
CREATE OR REPLACE FUNCTION fn_change_po_status(
  p_po_id      BIGINT,
  p_new_status TEXT,
  p_user_id    BIGINT
) RETURNS VOID AS $$
DECLARE
  v_old TEXT;
  v_ok  BOOLEAN;
BEGIN
  SELECT status INTO v_old FROM purchase_orders WHERE id = p_po_id FOR UPDATE;

  IF v_old IS NULL THEN
    RAISE EXCEPTION 'Purchase order % not found', p_po_id;
  END IF;

  IF v_old = p_new_status THEN
    RETURN;
  END IF;

  v_ok := CASE
    WHEN v_old = 'PENDING'     AND p_new_status IN ('UPLOADED')                        THEN TRUE
    WHEN v_old = 'UPLOADED'    AND p_new_status IN ('ON_PROGRESS','PENDING')           THEN TRUE
    WHEN v_old = 'ON_PROGRESS' AND p_new_status IN ('DELIVERED','UPLOADED')            THEN TRUE
    WHEN v_old = 'DELIVERED'   AND p_new_status IN ('ON_PROGRESS')                     THEN TRUE
    ELSE FALSE
  END;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'Invalid PO status transition: % -> %', v_old, p_new_status;
  END IF;

  UPDATE purchase_orders
  SET status = p_new_status, updated_by = p_user_id
  WHERE id = p_po_id;

  IF p_new_status = 'DELIVERED' THEN
    PERFORM fn_create_invoice(p_po_id, p_user_id);
  END IF;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd
