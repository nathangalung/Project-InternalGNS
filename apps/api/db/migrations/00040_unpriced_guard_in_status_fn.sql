-- +goose Up

-- Move the "finalizing requires every product priced" guard inside the status
-- function, which already holds a FOR UPDATE lock on the quotation row. The old
-- Go pre-check counted unpriced products in a separate, unlocked query, so a
-- concurrent edit could add an unpriced product between the count and the
-- status change. Raising under the lock closes that TOCTOU. ERRCODE P0100 is
-- mapped back to ErrUnpricedProducts.

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION fn_change_quotation_status(p_quotation_id BIGINT, p_new_status TEXT, p_user_id BIGINT, p_note TEXT DEFAULT NULL)
RETURNS void AS $$
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

  IF p_new_status IN ('sent','accepted') THEN
    IF EXISTS (
      SELECT 1 FROM quotation_items
      WHERE quotation_id = p_quotation_id
        AND item_type = 'product'
        AND (selling_price IS NULL OR selling_price <= 0)
    ) THEN
      RAISE EXCEPTION 'Quotation % has unpriced products', p_quotation_id
        USING ERRCODE = 'P0100';
    END IF;
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
CREATE OR REPLACE FUNCTION fn_change_quotation_status(p_quotation_id BIGINT, p_new_status TEXT, p_user_id BIGINT, p_note TEXT DEFAULT NULL)
RETURNS void AS $$
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
