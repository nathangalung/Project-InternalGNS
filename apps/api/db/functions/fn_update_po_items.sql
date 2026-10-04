-- Canonical current body of fn_update_po_items (deployed by migration 00097).
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

  IF v_status = 'CANCELLED' THEN
    RAISE EXCEPTION 'PO yang dibatalkan tidak dapat diubah.'
      USING ERRCODE = 'P0013';
  END IF;

  -- The PO lock above orders this with fn_replace_invoice.
  IF fn_po_lines_locked(p_po_id, v_status) THEN
    RAISE EXCEPTION 'PO yang sudah dikirim hanya dapat diubah setelah invoicenya dibatalkan dan sebelum invoice pengganti diterbitkan.'
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

  -- Address, a charge or days keep the line, as on the quotation.
  IF NULLIF(TRIM(p_shipping_address), '') IS NOT NULL OR COALESCE(p_shipping_cost, 0) > 0
     OR p_shipping_days IS NOT NULL THEN
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
      NULLIF(TRIM(p_shipping_address), ''),
      p_shipping_days,
      p_user_id,
      p_user_id
    );
  END IF;

  -- A delivered PO keeps what DELIVERED required.
  IF v_status = 'DELIVERED' THEN
    IF NOT EXISTS (
      SELECT 1 FROM purchase_order_items
      WHERE po_id = p_po_id AND item_type = 'product' AND total_selling > 0
    ) THEN
      RAISE EXCEPTION 'Jumlah semua baris produk masih 0. Isi jumlah minimal satu baris produk.'
        USING ERRCODE = 'P0014';
    END IF;
    IF NULLIF(TRIM(p_shipping_address), '') IS NULL AND EXISTS (
      SELECT 1 FROM purchase_order_items
      WHERE po_id = p_po_id AND item_type = 'product'
        AND NULLIF(TRIM(ship_destination), '') IS NULL
    ) THEN
      RAISE EXCEPTION 'Alamat pengiriman wajib diisi selama ada baris produk tanpa alamat tujuan.'
        USING ERRCODE = 'P0014';
    END IF;
  END IF;
END;
$function$
