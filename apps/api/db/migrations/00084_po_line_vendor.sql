-- +goose Up

-- 00084 PO LINE VENDOR
-- The PO line stores its supplier. It was read through the quotation line
-- the PO line came from, so a vendor picked in Ubah PO was dropped on save,
-- a line added there had no vendor and skipped the work gate, and a line
-- whose product was swapped kept the old product's vendor.
--
-- A vendor link names one item, so a line only takes a link for its own
-- product. The backfill and fn_create_purchase_order leave a quotation
-- link for another item empty; fn_update_po_items refuses one.
--
-- fn_link_vendor_item is the one link rule, shared by fn_prepare_quotation_lines
-- and fn_update_po_items: only an active vendor, reactivating its link, and a
-- link still at 0 takes the first real price. A PO edit keeps a link the PO
-- already stores even after its vendor is deactivated; any other link is a
-- new pick and goes through the rule.

ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS vendor_product_id BIGINT
    REFERENCES vendor_products(id) ON DELETE RESTRICT;
CREATE INDEX IF NOT EXISTS idx_po_items_vendor_product
  ON purchase_order_items(vendor_product_id);

UPDATE purchase_order_items poi
SET vendor_product_id = qi.vendor_product_id
FROM quotation_items qi
JOIN vendor_products vp ON vp.id = qi.vendor_product_id
WHERE qi.id = poi.quotation_item_id
  AND poi.item_type = 'product'
  AND poi.vendor_product_id IS NULL
  AND vp.item_id = poi.offered_item_id;

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_link_vendor_item(p_vendor_id bigint, p_item_id bigint, p_cost numeric, p_user_id bigint)
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_link BIGINT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vendors WHERE id = p_vendor_id AND is_active) THEN
    RAISE EXCEPTION 'Vendor tidak ditemukan atau sudah nonaktif. Pilih vendor lain.'
      USING ERRCODE = 'P0014';
  END IF;
  INSERT INTO vendor_products (vendor_id, item_id, cost_price, last_quoted_at, created_by, updated_by)
  VALUES (p_vendor_id, p_item_id, COALESCE(p_cost, 0), NOW(), p_user_id, p_user_id)
  ON CONFLICT (vendor_id, item_id) DO UPDATE
     SET is_active  = TRUE,
         -- A link still at 0 takes its first real price.
         cost_price = CASE WHEN vendor_products.cost_price = 0
                           THEN EXCLUDED.cost_price
                           ELSE vendor_products.cost_price END,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()
  RETURNING id INTO v_link;
  RETURN v_link;
END;
$function$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_prepare_quotation_lines(p_items jsonb, p_user_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_out     JSONB := '[]'::JSONB;
  v_item    JSONB;
  v_vendor  BIGINT;
  v_offered BIGINT;
  v_link    BIGINT;
BEGIN
  -- Leave a missing list to the caller's own validation.
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RETURN p_items;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_vendor := NULLIF(v_item->>'vendor_id', '')::BIGINT;
    IF (v_item->>'is_available') = 'false' THEN
      -- Tidak Ditawarkan: nothing is sold, so nothing is priced.
      v_item := (v_item - 'vendor_product_id' - 'cost_price' - 'update_vendor_price')
                || jsonb_build_object('selling_price', '0');
    ELSIF v_vendor IS NOT NULL AND NULLIF(v_item->>'vendor_product_id', '') IS NULL THEN
      v_offered := NULLIF(v_item->>'offered_item_id', '')::BIGINT;
      IF v_offered IS NULL THEN
        RAISE EXCEPTION 'Pilih produk yang ditawarkan sebelum memilih vendor.'
          USING ERRCODE = 'P0014';
      END IF;
      v_link := fn_link_vendor_item(
        v_vendor, v_offered, NULLIF(v_item->>'cost_price', '')::NUMERIC, p_user_id);
      v_item := jsonb_set(v_item, '{vendor_product_id}', to_jsonb(v_link));
    END IF;
    v_out := v_out || jsonb_build_array(v_item - 'vendor_id');
  END LOOP;
  RETURN v_out;
END;
$function$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_update_po_items(p_po_id bigint, p_user_id bigint, p_discount_pct numeric, p_notes text, p_shipping_address text, p_shipping_days integer, p_shipping_cost numeric, p_items jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_status      VARCHAR(20);
  v_quotation   BIGINT;
  v_line        INT := 0;
  v_offered     BIGINT;
  v_vendor      BIGINT;
  v_link        BIGINT;
  v_link_vendor BIGINT;
  v_stored      BIGINT[];
  it            JSONB;
BEGIN
  SELECT status, quotation_id INTO v_status, v_quotation
  FROM purchase_orders
  WHERE id = p_po_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'PO % tidak ditemukan.', p_po_id
      USING ERRCODE = 'P0011';
  END IF;

  IF v_status IN ('DELIVERED', 'CANCELLED') THEN
    RAISE EXCEPTION 'PO yang sudah dikirim atau dibatalkan tidak dapat diubah.'
      USING ERRCODE = 'P0013';
  END IF;

  IF p_discount_pct IS NULL OR p_discount_pct < 0 OR p_discount_pct > 100 THEN
    RAISE EXCEPTION 'Diskon harus antara 0 dan 100.'
      USING ERRCODE = 'P0014';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'Daftar baris PO tidak valid.'
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

  -- A line links only this quotation.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) AS e
    WHERE NULLIF(e->>'quotationItemId', '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM quotation_items qi
        WHERE qi.id = (e->>'quotationItemId')::BIGINT
          AND qi.quotation_id = v_quotation
      )
  ) THEN
    RAISE EXCEPTION 'Baris quotation tidak termasuk dalam quotation PO ini.'
      USING ERRCODE = 'P0014';
  END IF;

  UPDATE purchase_orders
  SET discount_pct = p_discount_pct,
      notes        = p_notes,
      updated_by   = p_user_id
  WHERE id = p_po_id;

  -- Links the PO already stores stay valid.
  SELECT COALESCE(array_agg(vendor_product_id), '{}') INTO v_stored
  FROM purchase_order_items
  WHERE po_id = p_po_id AND vendor_product_id IS NOT NULL;

  DELETE FROM purchase_order_items WHERE po_id = p_po_id;

  FOR it IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_line    := v_line + 1;
    v_offered := NULLIF(it->>'offeredItemId','')::BIGINT;
    v_link    := NULLIF(it->>'vendorProductId','')::BIGINT;
    v_vendor  := NULLIF(it->>'vendorId','')::BIGINT;

    -- The supplier offers this product.
    IF (v_link IS NOT NULL OR v_vendor IS NOT NULL) AND v_offered IS NULL THEN
      RAISE EXCEPTION 'Pilih produk yang ditawarkan sebelum memilih vendor.'
        USING ERRCODE = 'P0014';
    END IF;
    IF v_link IS NOT NULL THEN
      SELECT vendor_id INTO v_link_vendor
      FROM vendor_products WHERE id = v_link AND item_id = v_offered;
      IF NOT FOUND THEN
        RAISE EXCEPTION 'Vendor ini tidak menyediakan produk tersebut. Pilih vendor lain.'
          USING ERRCODE = 'P0014';
      END IF;
      -- A new pick is linked like a vendor id.
      IF NOT v_link = ANY (v_stored) THEN
        v_link := fn_link_vendor_item(
          v_link_vendor, v_offered, NULLIF(it->>'costPrice','')::NUMERIC, p_user_id);
      END IF;
    ELSIF v_vendor IS NOT NULL THEN
      v_link := fn_link_vendor_item(
        v_vendor, v_offered, NULLIF(it->>'costPrice','')::NUMERIC, p_user_id);
    END IF;

    INSERT INTO purchase_order_items (
      po_id, quotation_item_id, line_number, item_type,
      offered_item_id, vendor_product_id, item_name, item_code,
      qty, unit_id, selling_price, cost_price,
      discount_pct, is_available, ship_destination,
      created_by, updated_by
    ) VALUES (
      p_po_id,
      NULLIF(it->>'quotationItemId','')::BIGINT,
      v_line,
      'product',
      v_offered,
      v_link,
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
CREATE OR REPLACE FUNCTION public.fn_create_purchase_order(p_quotation_id bigint, p_user_id bigint)
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
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
    RAISE EXCEPTION 'Quotation % tidak ditemukan.', p_quotation_id
      USING ERRCODE = 'P0011';
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
    offered_item_id, vendor_product_id, qty, unit_id, selling_price, cost_price,
    item_name, item_code, ship_destination, shipping_days,
    is_available, created_by, updated_by
  )
  SELECT
    v_po_id, qi.id, qi.line_number, qi.item_type,
    qi.offered_item_id, vp.id, qi.qty, qi.unit_id, qi.selling_price, qi.cost_price,
    COALESCE(NULLIF(oi.name, ''), qi.requested_name, ''),
    CASE WHEN oi.id IS NOT NULL THEN NULLIF(oi.impa_code, '') ELSE qi.requested_impa END,
    qi.ship_destination, qi.shipping_days,
    qi.is_available, p_user_id, p_user_id
  FROM quotation_items qi
  LEFT JOIN items oi ON oi.id = qi.offered_item_id
  -- Only a link for the offered product is the line's supplier.
  LEFT JOIN vendor_products vp
    ON vp.id = qi.vendor_product_id AND vp.item_id = qi.offered_item_id
  WHERE qi.quotation_id = p_quotation_id
    -- A Tidak Ditawarkan request is never ordered.
    AND (qi.item_type <> 'product' OR qi.is_available)
  ORDER BY qi.line_number;

  RETURN v_po_id;
END;
$function$;
-- +goose StatementEnd

-- +goose Down

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_create_purchase_order(p_quotation_id bigint, p_user_id bigint)
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
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
    RAISE EXCEPTION 'Quotation % tidak ditemukan.', p_quotation_id
      USING ERRCODE = 'P0011';
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
    COALESCE(NULLIF(oi.name, ''), qi.requested_name, ''),
    CASE WHEN oi.id IS NOT NULL THEN NULLIF(oi.impa_code, '') ELSE qi.requested_impa END,
    qi.ship_destination, qi.shipping_days,
    qi.is_available, p_user_id, p_user_id
  FROM quotation_items qi
  LEFT JOIN items oi ON oi.id = qi.offered_item_id
  WHERE qi.quotation_id = p_quotation_id
    -- A Tidak Ditawarkan request is never ordered.
    AND (qi.item_type <> 'product' OR qi.is_available)
  ORDER BY qi.line_number;

  RETURN v_po_id;
END;
$function$;
-- +goose StatementEnd

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
    RAISE EXCEPTION 'PO % tidak ditemukan.', p_po_id
      USING ERRCODE = 'P0011';
  END IF;

  IF v_status IN ('DELIVERED', 'CANCELLED') THEN
    RAISE EXCEPTION 'PO yang sudah dikirim atau dibatalkan tidak dapat diubah.'
      USING ERRCODE = 'P0013';
  END IF;

  IF p_discount_pct IS NULL OR p_discount_pct < 0 OR p_discount_pct > 100 THEN
    RAISE EXCEPTION 'Diskon harus antara 0 dan 100.'
      USING ERRCODE = 'P0014';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'Daftar baris PO tidak valid.'
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
CREATE OR REPLACE FUNCTION public.fn_prepare_quotation_lines(p_items jsonb, p_user_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_out     JSONB := '[]'::JSONB;
  v_item    JSONB;
  v_vendor  BIGINT;
  v_offered BIGINT;
  v_link    BIGINT;
BEGIN
  -- Leave a missing list to the caller's own validation.
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RETURN p_items;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_vendor := NULLIF(v_item->>'vendor_id', '')::BIGINT;
    IF (v_item->>'is_available') = 'false' THEN
      -- Tidak Ditawarkan: nothing is sold, so nothing is priced.
      v_item := (v_item - 'vendor_product_id' - 'cost_price' - 'update_vendor_price')
                || jsonb_build_object('selling_price', '0');
    ELSIF v_vendor IS NOT NULL AND NULLIF(v_item->>'vendor_product_id', '') IS NULL THEN
      v_offered := NULLIF(v_item->>'offered_item_id', '')::BIGINT;
      IF v_offered IS NULL THEN
        RAISE EXCEPTION 'Pilih produk yang ditawarkan sebelum memilih vendor.'
          USING ERRCODE = 'P0014';
      END IF;
      IF NOT EXISTS (SELECT 1 FROM vendors WHERE id = v_vendor AND is_active) THEN
        RAISE EXCEPTION 'Vendor tidak ditemukan atau sudah nonaktif. Pilih vendor lain.'
          USING ERRCODE = 'P0014';
      END IF;
      INSERT INTO vendor_products (vendor_id, item_id, cost_price, last_quoted_at, created_by, updated_by)
      VALUES (v_vendor, v_offered,
              COALESCE(NULLIF(v_item->>'cost_price', '')::NUMERIC, 0),
              NOW(), p_user_id, p_user_id)
      ON CONFLICT (vendor_id, item_id) DO UPDATE
         SET is_active  = TRUE,
             -- A link still at 0 takes its first real price.
             cost_price = CASE WHEN vendor_products.cost_price = 0
                               THEN EXCLUDED.cost_price
                               ELSE vendor_products.cost_price END,
             updated_by = EXCLUDED.updated_by,
             updated_at = NOW()
      RETURNING id INTO v_link;
      v_item := jsonb_set(v_item, '{vendor_product_id}', to_jsonb(v_link));
    END IF;
    v_out := v_out || jsonb_build_array(v_item - 'vendor_id');
  END LOOP;
  RETURN v_out;
END;
$function$;
-- +goose StatementEnd

DROP FUNCTION IF EXISTS public.fn_link_vendor_item(bigint, bigint, numeric, bigint);
DROP INDEX IF EXISTS idx_po_items_vendor_product;
ALTER TABLE purchase_order_items DROP COLUMN IF EXISTS vendor_product_id;
