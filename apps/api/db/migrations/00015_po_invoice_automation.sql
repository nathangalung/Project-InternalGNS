-- +goose Up
-- +goose StatementBegin

-- 00015 — PURCHASE ORDER + INVOICE AUTOMATION
-- 1. Expand PO status set: PENDING, UPLOADED, ON_PROGRESS, DELIVERED.
-- 2. Add PO file metadata columns mirrored from FE upload UX.
-- 3. fn_create_purchase_order: snapshot quotation items into PO.
-- 4. fn_change_po_status: state machine + auto invoice draft on DELIVERED.
-- 5. fn_create_invoice: snapshot PO items into invoice draft.
-- 6. Hook fn_change_quotation_status to auto-create PO on accepted.


-- 1. Expand PO status check
ALTER TABLE purchase_orders DROP CONSTRAINT purchase_orders_status_check;
ALTER TABLE purchase_orders
  ADD CONSTRAINT purchase_orders_status_check
  CHECK (status IN ('PENDING','UPLOADED','ON_PROGRESS','DELIVERED'));

-- 2. PO file metadata; widen file_url for embedded data URLs
ALTER TABLE purchase_orders
  ALTER COLUMN file_url TYPE TEXT,
  ADD COLUMN file_name VARCHAR(255),
  ADD COLUMN file_size BIGINT,
  ADD COLUMN uploaded_at TIMESTAMPTZ;

-- +goose StatementEnd


-- 3. fn_create_purchase_order
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
  -- Idempotent: skip if PO already exists for this quotation
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
-- +goose StatementEnd


-- 4. fn_create_invoice
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


-- 5. fn_change_po_status with state machine
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


-- 6a. Backfill PO rows for existing accepted quotations (idempotent fn)
-- +goose StatementBegin
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT id, COALESCE(updated_by, created_by) AS user_id
    FROM quotations
    WHERE status = 'accepted'
  LOOP
    PERFORM fn_create_purchase_order(r.id, r.user_id);
  END LOOP;
END $$;
-- +goose StatementEnd


-- 6. Hook quotation status accepted to auto-create PO
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION fn_change_quotation_status(
  p_quotation_id BIGINT,
  p_new_status   TEXT,
  p_user_id      BIGINT,
  p_note         TEXT DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
  v_old_status VARCHAR(20);
  v_valid      BOOLEAN;
BEGIN
  SELECT status INTO v_old_status
  FROM quotations
  WHERE id = p_quotation_id
  FOR UPDATE;

  IF v_old_status IS NULL THEN
    RAISE EXCEPTION 'Quotation % not found', p_quotation_id;
  END IF;

  IF v_old_status = p_new_status THEN
    RETURN;
  END IF;

  v_valid := CASE
    WHEN v_old_status = 'draft'    AND p_new_status IN ('sent','expired') THEN TRUE
    WHEN v_old_status = 'sent'     AND p_new_status IN ('accepted','rejected','revision','expired') THEN TRUE
    WHEN v_old_status = 'revision' AND p_new_status IN ('sent','rejected') THEN TRUE
    ELSE FALSE
  END;

  IF NOT v_valid THEN
    RAISE EXCEPTION 'Invalid status transition: % -> % (terminal: accepted/rejected/expired cannot exit)',
      v_old_status, p_new_status;
  END IF;

  UPDATE quotations
  SET status     = p_new_status,
      updated_by = p_user_id
  WHERE id = p_quotation_id;

  INSERT INTO quotation_status_history
    (quotation_id, from_status, to_status, note, changed_by)
  VALUES
    (p_quotation_id, v_old_status, p_new_status, p_note, p_user_id);

  IF p_new_status = 'accepted' THEN
    PERFORM fn_create_purchase_order(p_quotation_id, p_user_id);
  END IF;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd


-- +goose Down
-- +goose StatementBegin

-- Restore quotation status fn from 00013 (no PO auto-create)
CREATE OR REPLACE FUNCTION fn_change_quotation_status(
  p_quotation_id BIGINT,
  p_new_status   TEXT,
  p_user_id      BIGINT,
  p_note         TEXT DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
  v_old_status VARCHAR(20);
  v_valid      BOOLEAN;
BEGIN
  SELECT status INTO v_old_status
  FROM quotations
  WHERE id = p_quotation_id
  FOR UPDATE;

  IF v_old_status IS NULL THEN
    RAISE EXCEPTION 'Quotation % not found', p_quotation_id;
  END IF;

  IF v_old_status = p_new_status THEN
    RETURN;
  END IF;

  v_valid := CASE
    WHEN v_old_status = 'draft'    AND p_new_status IN ('sent','expired') THEN TRUE
    WHEN v_old_status = 'sent'     AND p_new_status IN ('accepted','rejected','revision','expired') THEN TRUE
    WHEN v_old_status = 'revision' AND p_new_status IN ('sent','rejected') THEN TRUE
    ELSE FALSE
  END;

  IF NOT v_valid THEN
    RAISE EXCEPTION 'Invalid status transition: % -> %', v_old_status, p_new_status;
  END IF;

  UPDATE quotations
  SET status     = p_new_status,
      updated_by = p_user_id
  WHERE id = p_quotation_id;

  INSERT INTO quotation_status_history
    (quotation_id, from_status, to_status, note, changed_by)
  VALUES
    (p_quotation_id, v_old_status, p_new_status, p_note, p_user_id);
END;
$$ LANGUAGE plpgsql;

DROP FUNCTION IF EXISTS fn_change_po_status(BIGINT, TEXT, BIGINT);
DROP FUNCTION IF EXISTS fn_create_invoice(BIGINT, BIGINT);
DROP FUNCTION IF EXISTS fn_create_purchase_order(BIGINT, BIGINT);

ALTER TABLE purchase_orders
  DROP COLUMN IF EXISTS uploaded_at,
  DROP COLUMN IF EXISTS file_size,
  DROP COLUMN IF EXISTS file_name,
  ALTER COLUMN file_url TYPE VARCHAR(500);

ALTER TABLE purchase_orders DROP CONSTRAINT purchase_orders_status_check;
ALTER TABLE purchase_orders
  ADD CONSTRAINT purchase_orders_status_check
  CHECK (status IN ('PENDING','UPLOADED','DELIVERED'));

-- +goose StatementEnd
