-- +goose Up

-- Dedicated SQLSTATEs for business rules.
--
-- Business rules raised the untyped default P0001, so Go classified them by
-- substring-matching English RAISE text. Two raises matched no branch: the
-- 00035 invoice guard collapsed to "invalid transition", and the
-- fn_update_po_items validations surfaced as 500s. Extends the P0010/P0011
-- convention introduced by 00029.
--
--   P0010  row_version mismatch      (00029, unchanged)
--   P0011  record not found
--   P0012  invalid status transition
--   P0013  locked or blocked by a related record
--   P0014  validation failure
--   P0100  quotation has unpriced products (00040, unchanged)
--
-- Bodies are the deployed ones verbatim; only ERRCODE is added, except
-- trg_fn_qir_lock_parent which also gains the FOR UPDATE it was missing.

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
CREATE OR REPLACE FUNCTION fn_update_po_items(
  p_po_id            BIGINT,
  p_user_id          BIGINT,
  p_discount_pct     NUMERIC,
  p_notes            TEXT,
  p_shipping_address TEXT,
  p_shipping_days    INT,
  p_shipping_cost    NUMERIC,
  p_items            JSONB
) RETURNS VOID AS $$
DECLARE
  v_status VARCHAR(20);
  v_line   INT := 0;
  it       JSONB;
BEGIN
  SELECT status INTO v_status
  FROM purchase_orders
  WHERE id = p_po_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Purchase order % not found', p_po_id
      USING ERRCODE = 'P0011';
  END IF;

  IF v_status = 'DELIVERED' THEN
    RAISE EXCEPTION 'Cannot edit PO in DELIVERED state'
      USING ERRCODE = 'P0013';
  END IF;

  IF p_discount_pct IS NULL OR p_discount_pct < 0 OR p_discount_pct > 100 THEN
    RAISE EXCEPTION 'discount_pct must be between 0 and 100'
      USING ERRCODE = 'P0014';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'items must be a JSON array'
      USING ERRCODE = 'P0014';
  END IF;

  UPDATE purchase_orders
  SET discount_pct = p_discount_pct,
      notes        = p_notes,
      updated_by   = p_user_id
  WHERE id = p_po_id;

  DELETE FROM purchase_order_items WHERE po_id = p_po_id;

  FOR it IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_line := v_line + 1;
    INSERT INTO purchase_order_items (
      po_id, quotation_item_id, line_number, item_type,
      offered_item_id, item_name, item_code,
      qty, unit_id, selling_price, cost_price,
      discount_pct, is_available, ship_destination,
      created_by, updated_by
    ) VALUES (
      p_po_id,
      NULLIF(it->>'quotationItemId','')::BIGINT,
      v_line,
      'product',
      NULLIF(it->>'offeredItemId','')::BIGINT,
      COALESCE(it->>'itemName',''),
      NULLIF(it->>'itemCode',''),
      COALESCE(NULLIF(it->>'qty','')::NUMERIC, 0),
      NULLIF(it->>'unitId','')::SMALLINT,
      COALESCE(NULLIF(it->>'sellingPrice','')::NUMERIC, 0),
      NULLIF(it->>'costPrice','')::NUMERIC,
      p_discount_pct,
      COALESCE((it->>'isAvailable')::BOOLEAN, TRUE),
      NULLIF(it->>'shipDestination',''),
      p_user_id,
      p_user_id
    );
  END LOOP;

  IF p_shipping_address IS NOT NULL AND TRIM(p_shipping_address) <> '' THEN
    v_line := v_line + 1;
    INSERT INTO purchase_order_items (
      po_id, line_number, item_type,
      item_name, qty, selling_price,
      discount_pct, is_available, ship_destination, shipping_days,
      created_by, updated_by
    ) VALUES (
      p_po_id,
      v_line,
      'shipping',
      'Pengiriman',
      1,
      COALESCE(p_shipping_cost, 0),
      0,
      TRUE,
      p_shipping_address,
      p_shipping_days,
      p_user_id,
      p_user_id
    );
  END IF;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION fn_change_invoice_status(
  p_invoice_id BIGINT,
  p_target     TEXT,
  p_user_id    BIGINT
) RETURNS VOID AS $$
DECLARE
  v_current VARCHAR(20);
  v_allowed BOOLEAN := FALSE;
BEGIN
  SELECT status INTO v_current
  FROM invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF v_current IS NULL THEN
    RAISE EXCEPTION 'Invoice % not found', p_invoice_id
      USING ERRCODE = 'P0011';
  END IF;

  IF p_target NOT IN ('draft','sent','paid','overdue','cancelled') THEN
    RAISE EXCEPTION 'invalid invoice status: %', p_target
      USING ERRCODE = 'P0014';
  END IF;

  IF v_current = p_target THEN
    RETURN;
  END IF;

  IF v_current = 'draft'    AND p_target IN ('sent','cancelled')          THEN v_allowed := TRUE; END IF;
  IF v_current = 'sent'     AND p_target IN ('paid','overdue','cancelled') THEN v_allowed := TRUE; END IF;
  IF v_current = 'overdue'  AND p_target IN ('paid','cancelled')           THEN v_allowed := TRUE; END IF;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'invalid transition % -> %', v_current, p_target
      USING ERRCODE = 'P0012';
  END IF;

  UPDATE invoices
  SET status     = p_target,
      updated_by = p_user_id
  WHERE id = p_invoice_id;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- The parent read gains FOR UPDATE: the status was checked unlocked, the same
-- TOCTOU 00040 closed for quotations. No path locks a request row before the
-- parent, so the child-to-parent order introduces no cycle.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION trg_fn_qir_lock_parent() RETURNS TRIGGER AS $$
DECLARE
  v_qid       BIGINT;
  v_status    VARCHAR(20);
BEGIN
  v_qid := COALESCE(NEW.quotation_id, OLD.quotation_id);

  SELECT status INTO v_status
  FROM quotations
  WHERE id = v_qid
  FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Parent quotation % not found', v_qid
      USING ERRCODE = 'P0011';
  END IF;

  IF v_status NOT IN ('draft', 'revision') THEN
    RAISE EXCEPTION
      'Cannot modify quotation_item_requests: parent quotation % has status "%". Only draft/revision allow request edits.',
      v_qid, v_status
      USING ERRCODE = 'P0013';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- +goose Down

-- Restore the untyped P0001 bodies deployed by 00035, 00043, 00025 and 00022.

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

  IF v_old = 'DELIVERED' AND p_new_status = 'ON_PROGRESS'
     AND EXISTS (SELECT 1 FROM invoices WHERE po_id = p_po_id) THEN
    RAISE EXCEPTION 'PO % has an invoice; cannot revert from DELIVERED', p_po_id;
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

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION fn_update_po_items(
  p_po_id            BIGINT,
  p_user_id          BIGINT,
  p_discount_pct     NUMERIC,
  p_notes            TEXT,
  p_shipping_address TEXT,
  p_shipping_days    INT,
  p_shipping_cost    NUMERIC,
  p_items            JSONB
) RETURNS VOID AS $$
DECLARE
  v_status VARCHAR(20);
  v_line   INT := 0;
  it       JSONB;
BEGIN
  SELECT status INTO v_status
  FROM purchase_orders
  WHERE id = p_po_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Purchase order % not found', p_po_id;
  END IF;

  IF v_status = 'DELIVERED' THEN
    RAISE EXCEPTION 'Cannot edit PO in DELIVERED state';
  END IF;

  IF p_discount_pct IS NULL OR p_discount_pct < 0 OR p_discount_pct > 100 THEN
    RAISE EXCEPTION 'discount_pct must be between 0 and 100';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'items must be a JSON array';
  END IF;

  UPDATE purchase_orders
  SET discount_pct = p_discount_pct,
      notes        = p_notes,
      updated_by   = p_user_id
  WHERE id = p_po_id;

  DELETE FROM purchase_order_items WHERE po_id = p_po_id;

  FOR it IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_line := v_line + 1;
    INSERT INTO purchase_order_items (
      po_id, quotation_item_id, line_number, item_type,
      offered_item_id, item_name, item_code,
      qty, unit_id, selling_price, cost_price,
      discount_pct, is_available, ship_destination,
      created_by, updated_by
    ) VALUES (
      p_po_id,
      NULLIF(it->>'quotationItemId','')::BIGINT,
      v_line,
      'product',
      NULLIF(it->>'offeredItemId','')::BIGINT,
      COALESCE(it->>'itemName',''),
      NULLIF(it->>'itemCode',''),
      COALESCE(NULLIF(it->>'qty','')::NUMERIC, 0),
      NULLIF(it->>'unitId','')::SMALLINT,
      COALESCE(NULLIF(it->>'sellingPrice','')::NUMERIC, 0),
      NULLIF(it->>'costPrice','')::NUMERIC,
      p_discount_pct,
      COALESCE((it->>'isAvailable')::BOOLEAN, TRUE),
      NULLIF(it->>'shipDestination',''),
      p_user_id,
      p_user_id
    );
  END LOOP;

  IF p_shipping_address IS NOT NULL AND TRIM(p_shipping_address) <> '' THEN
    v_line := v_line + 1;
    INSERT INTO purchase_order_items (
      po_id, line_number, item_type,
      item_name, qty, selling_price,
      discount_pct, is_available, ship_destination, shipping_days,
      created_by, updated_by
    ) VALUES (
      p_po_id,
      v_line,
      'shipping',
      'Pengiriman',
      1,
      COALESCE(p_shipping_cost, 0),
      0,
      TRUE,
      p_shipping_address,
      p_shipping_days,
      p_user_id,
      p_user_id
    );
  END IF;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION fn_change_invoice_status(
  p_invoice_id BIGINT,
  p_target     TEXT,
  p_user_id    BIGINT
) RETURNS VOID AS $$
DECLARE
  v_current VARCHAR(20);
  v_allowed BOOLEAN := FALSE;
BEGIN
  SELECT status INTO v_current
  FROM invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF v_current IS NULL THEN
    RAISE EXCEPTION 'Invoice % not found', p_invoice_id;
  END IF;

  IF p_target NOT IN ('draft','sent','paid','overdue','cancelled') THEN
    RAISE EXCEPTION 'invalid invoice status: %', p_target;
  END IF;

  IF v_current = p_target THEN
    RETURN;
  END IF;

  IF v_current = 'draft'    AND p_target IN ('sent','cancelled')          THEN v_allowed := TRUE; END IF;
  IF v_current = 'sent'     AND p_target IN ('paid','overdue','cancelled') THEN v_allowed := TRUE; END IF;
  IF v_current = 'overdue'  AND p_target IN ('paid','cancelled')           THEN v_allowed := TRUE; END IF;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'invalid transition % -> %', v_current, p_target;
  END IF;

  UPDATE invoices
  SET status     = p_target,
      updated_by = p_user_id
  WHERE id = p_invoice_id;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION trg_fn_qir_lock_parent() RETURNS TRIGGER AS $$
DECLARE
  v_qid       BIGINT;
  v_status    VARCHAR(20);
BEGIN
  v_qid := COALESCE(NEW.quotation_id, OLD.quotation_id);

  SELECT status INTO v_status
  FROM quotations
  WHERE id = v_qid;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Parent quotation % not found', v_qid;
  END IF;

  IF v_status NOT IN ('draft', 'revision') THEN
    RAISE EXCEPTION
      'Cannot modify quotation_item_requests: parent quotation % has status "%". Only draft/revision allow request edits.',
      v_qid, v_status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd
