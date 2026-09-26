-- +goose Up

-- 00071 PO REQUIRES A PRICED PRODUCT
-- fn_update_po_items checked only the discount range and that items was an
-- array, so an edit could leave a PO with no product line, or with a product
-- at selling price 0, and DELIVERED then issued a Rp 0 invoice. The quotation
-- refuses both (an empty item list on create, P0100 on sent or accepted).
-- The PO edit now refuses them with P0014, and fn_change_po_status refuses
-- ON_PROGRESS and DELIVERED with P0012 while the stored lines break the rule,
-- before a delivery-note number is drawn. Quantity keeps its >= 0 bound: a
-- qty 0 line records an item that was not delivered.

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_update_po_items(p_po_id bigint, p_user_id bigint, p_discount_pct numeric, p_notes text, p_shipping_address text, p_shipping_days integer, p_shipping_cost numeric, p_items jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
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

  IF v_status IN ('DELIVERED', 'CANCELLED') THEN
    RAISE EXCEPTION 'PO yang sudah dikirim atau dibatalkan tidak dapat diubah.'
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

  -- Every element becomes a product line.
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'PO harus memiliki minimal satu baris produk.'
      USING ERRCODE = 'P0014';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) AS e
    WHERE COALESCE(NULLIF(e->>'sellingPrice', '')::NUMERIC, 0) <= 0
  ) THEN
    RAISE EXCEPTION 'Semua baris produk harus memiliki harga jual.'
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
$function$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_change_po_status(p_po_id bigint, p_new_status text, p_user_id bigint, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_old        TEXT;
  v_ok         BOOLEAN;
  v_company_id BIGINT;
  v_dn_current TEXT;
  v_file       TEXT;
  v_dn         TEXT;
  v_note       TEXT := NULLIF(BTRIM(p_note), '');
BEGIN
  SELECT status, company_client_id, delivery_note_number, file_url
    INTO v_old, v_company_id, v_dn_current, v_file
    FROM purchase_orders WHERE id = p_po_id FOR UPDATE;

  IF v_old IS NULL THEN
    RAISE EXCEPTION 'Purchase order % not found', p_po_id
      USING ERRCODE = 'P0011';
  END IF;

  IF v_old = p_new_status THEN
    RETURN;
  END IF;

  IF v_old IN ('DELIVERED', 'CANCELLED') THEN
    RAISE EXCEPTION 'PO yang sudah dikirim atau dibatalkan tidak dapat diubah statusnya.'
      USING ERRCODE = 'P0012';
  END IF;

  -- PENDING and UPLOADED follow the file.
  IF (v_old = 'PENDING' AND p_new_status = 'UPLOADED')
     OR (v_old = 'UPLOADED' AND p_new_status = 'PENDING') THEN
    RAISE EXCEPTION 'Status ini mengikuti berkas PO. Unggah atau hapus berkas PO untuk mengubahnya.'
      USING ERRCODE = 'P0012';
  END IF;

  v_ok := CASE
    WHEN v_old = 'PENDING'     AND p_new_status IN ('CANCELLED')                        THEN TRUE
    WHEN v_old = 'UPLOADED'    AND p_new_status IN ('ON_PROGRESS','CANCELLED')          THEN TRUE
    WHEN v_old = 'ON_PROGRESS' AND p_new_status IN ('DELIVERED','UPLOADED','CANCELLED') THEN TRUE
    ELSE FALSE
  END;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'Perubahan status PO ini tidak diizinkan.'
      USING ERRCODE = 'P0012';
  END IF;

  IF p_new_status = 'CANCELLED' AND v_note IS NULL THEN
    RAISE EXCEPTION 'Alasan pembatalan wajib diisi.'
      USING ERRCODE = 'P0014';
  END IF;

  IF p_new_status = 'UPLOADED' AND v_file IS NULL THEN
    RAISE EXCEPTION 'PO belum memiliki berkas. Unggah berkas PO terlebih dahulu.'
      USING ERRCODE = 'P0012';
  END IF;

  -- Work needs a priced product.
  IF p_new_status IN ('ON_PROGRESS', 'DELIVERED') AND (
    NOT EXISTS (
      SELECT 1 FROM purchase_order_items
      WHERE po_id = p_po_id AND item_type = 'product'
    )
    OR EXISTS (
      SELECT 1 FROM purchase_order_items
      WHERE po_id = p_po_id AND item_type = 'product'
        AND (selling_price IS NULL OR selling_price <= 0)
    )
  ) THEN
    RAISE EXCEPTION 'PO harus memiliki minimal satu baris produk dan setiap baris produk harus memiliki harga jual. Lengkapi melalui Ubah PO.'
      USING ERRCODE = 'P0012';
  END IF;

  IF p_new_status IN ('ON_PROGRESS', 'DELIVERED') AND v_dn_current IS NULL THEN
    v_dn := fn_next_doc_no('DN', v_company_id);
  END IF;

  UPDATE purchase_orders
  SET status               = p_new_status,
      delivery_note_number = COALESCE(v_dn, delivery_note_number),
      updated_by           = p_user_id
  WHERE id = p_po_id;

  INSERT INTO po_status_history (po_id, from_status, to_status, note, changed_by)
  VALUES (p_po_id, v_old, p_new_status, v_note, p_user_id);

  IF p_new_status = 'DELIVERED' THEN
    PERFORM fn_create_invoice(p_po_id, p_user_id);
  END IF;
END;
$function$;
-- +goose StatementEnd

-- +goose Down

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_update_po_items(p_po_id bigint, p_user_id bigint, p_discount_pct numeric, p_notes text, p_shipping_address text, p_shipping_days integer, p_shipping_cost numeric, p_items jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
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

  IF v_status IN ('DELIVERED', 'CANCELLED') THEN
    RAISE EXCEPTION 'PO yang sudah dikirim atau dibatalkan tidak dapat diubah.'
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
$function$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_change_po_status(p_po_id bigint, p_new_status text, p_user_id bigint, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_old        TEXT;
  v_ok         BOOLEAN;
  v_company_id BIGINT;
  v_dn_current TEXT;
  v_file       TEXT;
  v_dn         TEXT;
  v_note       TEXT := NULLIF(BTRIM(p_note), '');
BEGIN
  SELECT status, company_client_id, delivery_note_number, file_url
    INTO v_old, v_company_id, v_dn_current, v_file
    FROM purchase_orders WHERE id = p_po_id FOR UPDATE;

  IF v_old IS NULL THEN
    RAISE EXCEPTION 'Purchase order % not found', p_po_id
      USING ERRCODE = 'P0011';
  END IF;

  IF v_old = p_new_status THEN
    RETURN;
  END IF;

  IF v_old IN ('DELIVERED', 'CANCELLED') THEN
    RAISE EXCEPTION 'PO yang sudah dikirim atau dibatalkan tidak dapat diubah statusnya.'
      USING ERRCODE = 'P0012';
  END IF;

  -- PENDING and UPLOADED follow the file.
  IF (v_old = 'PENDING' AND p_new_status = 'UPLOADED')
     OR (v_old = 'UPLOADED' AND p_new_status = 'PENDING') THEN
    RAISE EXCEPTION 'Status ini mengikuti berkas PO. Unggah atau hapus berkas PO untuk mengubahnya.'
      USING ERRCODE = 'P0012';
  END IF;

  v_ok := CASE
    WHEN v_old = 'PENDING'     AND p_new_status IN ('CANCELLED')                        THEN TRUE
    WHEN v_old = 'UPLOADED'    AND p_new_status IN ('ON_PROGRESS','CANCELLED')          THEN TRUE
    WHEN v_old = 'ON_PROGRESS' AND p_new_status IN ('DELIVERED','UPLOADED','CANCELLED') THEN TRUE
    ELSE FALSE
  END;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'Perubahan status PO ini tidak diizinkan.'
      USING ERRCODE = 'P0012';
  END IF;

  IF p_new_status = 'CANCELLED' AND v_note IS NULL THEN
    RAISE EXCEPTION 'Alasan pembatalan wajib diisi.'
      USING ERRCODE = 'P0014';
  END IF;

  IF p_new_status = 'UPLOADED' AND v_file IS NULL THEN
    RAISE EXCEPTION 'PO belum memiliki berkas. Unggah berkas PO terlebih dahulu.'
      USING ERRCODE = 'P0012';
  END IF;

  IF p_new_status IN ('ON_PROGRESS', 'DELIVERED') AND v_dn_current IS NULL THEN
    v_dn := fn_next_doc_no('DN', v_company_id);
  END IF;

  UPDATE purchase_orders
  SET status               = p_new_status,
      delivery_note_number = COALESCE(v_dn, delivery_note_number),
      updated_by           = p_user_id
  WHERE id = p_po_id;

  INSERT INTO po_status_history (po_id, from_status, to_status, note, changed_by)
  VALUES (p_po_id, v_old, p_new_status, v_note, p_user_id);

  IF p_new_status = 'DELIVERED' THEN
    PERFORM fn_create_invoice(p_po_id, p_user_id);
  END IF;
END;
$function$;
-- +goose StatementEnd
