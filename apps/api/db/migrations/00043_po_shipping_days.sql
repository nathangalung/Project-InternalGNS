-- +goose Up

-- Persist shipping days on the PO shipping line. fn_update_po_items accepted
-- p_shipping_days but never stored it, so the value was silently discarded
-- and the detail page always showed a dash. Mirrors 00036 for quotations.
ALTER TABLE purchase_order_items ADD COLUMN IF NOT EXISTS shipping_days INT;

COMMENT ON COLUMN purchase_order_items.shipping_days IS
  'Estimated delivery working days, shipping lines only.';

-- Recover days for POs snapshotted after 00036 stored them on the quotation.
UPDATE purchase_order_items poi
SET shipping_days = qi.shipping_days
FROM quotation_items qi
WHERE poi.quotation_item_id = qi.id
  AND qi.shipping_days IS NOT NULL;

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


-- +goose Down

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
      discount_pct, is_available, ship_destination,
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
      p_user_id,
      p_user_id
    );
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

ALTER TABLE purchase_order_items DROP COLUMN IF EXISTS shipping_days;
