-- +goose Up
-- +goose StatementBegin

-- 00009 fn_create_quotation
-- Atomic quotation create from wizard.
-- p_items JSONB array, item shape:
-- { "requested_item_id":   int|null,
-- "requested_impa":      text|null,
-- "requested_name":      text,
-- "offered_item_id":     int|null,
-- "vendor_product_id":   int|null,
-- "qty":                 numeric,
-- "unit_id":             int,
-- "selling_price":       numeric,
-- "cost_price":          numeric|null,
-- "update_vendor_price": bool,
-- "ship_destination":    text|null,
-- "due_date":            date|null }

CREATE FUNCTION fn_create_quotation(
  p_company_client_id  BIGINT,
  p_contact_id         BIGINT,
  p_client_ref_no      TEXT,
  p_vessel_name        TEXT,
  p_payment_terms      TEXT,
  p_validity_days      INT,
  p_discount_pct       NUMERIC(5,4),
  p_shipping_address   TEXT,
  p_shipping_days      INT,
  p_shipping_cost      NUMERIC(15,2),
  p_items              JSONB,
  p_created_by         BIGINT,
  p_notes              TEXT DEFAULT NULL,
  p_status             TEXT DEFAULT 'draft'
) RETURNS BIGINT AS $$
DECLARE
  v_quotation_id        BIGINT;
  v_quotation_no        TEXT;
  v_company_name        VARCHAR;
  v_contact_name        VARCHAR;
  v_item                JSONB;
  v_line_no             SMALLINT := 0;
  v_total_produk        NUMERIC(15,2) := 0;
  v_total               NUMERIC(15,2) := 0;
  v_total_discount      NUMERIC(15,2) := 0;
  v_qty                 NUMERIC(12,2);
  v_selling_price       NUMERIC(15,2);
  v_item_subtotal       NUMERIC(15,2);
BEGIN
  -- 1. Validation
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Quotation must have at least 1 item';
  END IF;

  IF p_discount_pct < 0 OR p_discount_pct > 1 THEN
    RAISE EXCEPTION 'discount_pct must be 0..1, got %', p_discount_pct;
  END IF;

  -- 2. Snapshot names from master.
  SELECT name INTO v_company_name
  FROM company_client WHERE id = p_company_client_id AND is_active = TRUE;

  IF v_company_name IS NULL THEN
    RAISE EXCEPTION 'company_client_id % not found or inactive', p_company_client_id;
  END IF;

  IF p_contact_id IS NOT NULL THEN
    SELECT name INTO v_contact_name
    FROM company_contacts
    WHERE id = p_contact_id AND company_id = p_company_client_id AND is_active = TRUE;

    IF v_contact_name IS NULL THEN
      RAISE EXCEPTION 'contact_id % not found or not belong to company %', p_contact_id, p_company_client_id;
    END IF;
  END IF;

  -- 3. Pre-calculate totals from items.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_item->>'qty')::NUMERIC(12,2);
    v_selling_price := (v_item->>'selling_price')::NUMERIC(15,2);

    v_total          := v_total + (v_qty * v_selling_price);
    -- Product subtotal only.
    v_total_produk   := v_total_produk + (v_qty * v_selling_price);
    -- Products only; shipping later.
    v_total_discount := v_total_discount + (v_qty * v_selling_price * p_discount_pct);
  END LOOP;

  -- Add shipping; no discount.
  IF p_shipping_cost IS NOT NULL AND p_shipping_cost > 0 THEN
    v_total := v_total + p_shipping_cost;
  END IF;

  -- 4. Generate quotation_no atomically.
  v_quotation_no := fn_next_doc_no('Q', p_company_client_id);

  -- 5. INSERT header
  INSERT INTO quotations (
    quotation_no, version, company_client_id, company_client_name,
    contact_id, contact_name,
    client_ref_no, vessel_name, status,
    payment_terms, validity_days, discount_pct,
    total_produk, total, total_discount,
    notes, created_by, updated_by
  ) VALUES (
    v_quotation_no, 1, p_company_client_id, v_company_name,
    p_contact_id, v_contact_name,
    p_client_ref_no, p_vessel_name, p_status,
    p_payment_terms, p_validity_days, p_discount_pct,
    v_total_produk, v_total, v_total_discount,
    p_notes, p_created_by, p_created_by
  ) RETURNING id INTO v_quotation_id;

  -- 6. INSERT product items.
  -- Triggers handle discount and vendor sync.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_line_no := v_line_no + 1;
    INSERT INTO quotation_items (
      quotation_id, line_number, item_type,
      requested_item_id, requested_impa, requested_name,
      offered_item_id, vendor_product_id,
      qty, unit_id, selling_price, cost_price,
      is_available, ship_destination, due_date,
      update_vendor_price, created_by, updated_by
    ) VALUES (
      v_quotation_id,
      v_line_no,
      'product',
      NULLIF((v_item->>'requested_item_id'),'')::BIGINT,
      v_item->>'requested_impa',
      v_item->>'requested_name',
      NULLIF((v_item->>'offered_item_id'),'')::BIGINT,
      NULLIF((v_item->>'vendor_product_id'),'')::BIGINT,
      (v_item->>'qty')::NUMERIC(12,2),
      (v_item->>'unit_id')::SMALLINT,
      (v_item->>'selling_price')::NUMERIC(15,2),
      NULLIF((v_item->>'cost_price'),'')::NUMERIC(15,2),
      COALESCE((v_item->>'is_available')::BOOLEAN, TRUE),
      v_item->>'ship_destination',
      NULLIF((v_item->>'due_date'),'')::DATE,
      COALESCE((v_item->>'update_vendor_price')::BOOLEAN, FALSE),
      p_created_by, p_created_by
    );
  END LOOP;

  -- 7. INSERT shipping line if any.
  -- Discount excluded by GENERATED column.
  IF p_shipping_cost IS NOT NULL AND p_shipping_cost > 0 THEN
    v_line_no := v_line_no + 1;
    INSERT INTO quotation_items (
      quotation_id, line_number, item_type,
      requested_name,
      qty, unit_id, selling_price,
      ship_destination,
      created_by, updated_by
    ) VALUES (
      v_quotation_id,
      v_line_no,
      'shipping',
      'SHIPPING' || COALESCE(' — ' || p_shipping_address, ''),
      1,
      (SELECT id FROM units WHERE code = 'UNIT' LIMIT 1),  -- fallback UNIT
      p_shipping_cost,
      p_shipping_address,
      p_created_by, p_created_by
    );
  END IF;

  -- 8. Return new quotation_id
  RETURN v_quotation_id;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd


-- +goose StatementBegin
COMMENT ON FUNCTION fn_create_quotation(
  BIGINT, BIGINT, TEXT, TEXT, TEXT, INT, NUMERIC(5,4),
  TEXT, INT, NUMERIC(15,2), JSONB, BIGINT, TEXT, TEXT
) IS
  'Atomic create: doc_no, snapshot, header, items, optional shipping.';
-- +goose StatementEnd


-- +goose Down
-- +goose StatementBegin
DROP FUNCTION IF EXISTS fn_create_quotation(
  BIGINT, BIGINT, TEXT, TEXT, TEXT, INT, NUMERIC(5,4),
  TEXT, INT, NUMERIC(15,2), JSONB, BIGINT, TEXT, TEXT
);
-- +goose StatementEnd
