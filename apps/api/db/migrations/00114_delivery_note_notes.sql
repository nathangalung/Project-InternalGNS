-- +goose Up
-- 00114 DELIVERY NOTE NOTES
-- The delivery note's last column printed each line's destination, which
-- repeated the shipping address on every row. The header Address now says
-- where the goods go and the column is Notes: a note per PO line, typed
-- when the note is downloaded. NULL means no note was saved yet, so the
-- note prints the default the API works out ("Kirim ke:" and the line's own
-- destination when it is not the Address). An empty note prints nothing.
-- Ubah PO replaces every line, so it carries each kept line's note over by
-- its id.
ALTER TABLE purchase_order_items ADD COLUMN dn_note VARCHAR(500);

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_update_po_dn_notes(p_po_id bigint, p_if_match integer, p_notes jsonb, p_user_id bigint)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_current INT;
  v_status  VARCHAR(20);
  v_new     INT;
BEGIN
  SELECT row_version, status INTO v_current, v_status
  FROM purchase_orders
  WHERE id = p_po_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PO tidak ditemukan. Muat ulang halaman.'
      USING ERRCODE = 'P0011';
  END IF;

  IF p_if_match IS NOT NULL AND v_current <> p_if_match THEN
    RAISE EXCEPTION 'Data ini baru saja diubah pengguna lain. Muat ulang lalu coba lagi.'
      USING ERRCODE = 'P0010';
  END IF;

  -- The note exists from ON_PROGRESS on.
  IF v_status NOT IN ('ON_PROGRESS', 'DELIVERED') THEN
    RAISE EXCEPTION 'Catatan surat jalan hanya bisa diubah saat PO Dalam Progres atau Dikirim.'
      USING ERRCODE = 'P0013';
  END IF;

  IF p_notes IS NULL OR jsonb_typeof(p_notes) <> 'array' OR jsonb_array_length(p_notes) = 0 THEN
    RAISE EXCEPTION 'Daftar catatan surat jalan kosong.'
      USING ERRCODE = 'P0014';
  END IF;

  -- Each note is for a product line of this PO.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_notes) AS e
    WHERE NOT EXISTS (
      SELECT 1 FROM purchase_order_items poi
      WHERE poi.id = (e->>'lineId')::BIGINT
        AND poi.po_id = p_po_id
        AND poi.item_type = 'product'
    )
  ) THEN
    RAISE EXCEPTION 'Baris ini bukan baris produk PO ini. Muat ulang halaman.'
      USING ERRCODE = 'P0014';
  END IF;

  UPDATE purchase_order_items poi
  SET dn_note    = COALESCE(e->>'note', ''),
      updated_by = p_user_id
  FROM jsonb_array_elements(p_notes) AS e
  WHERE poi.id = (e->>'lineId')::BIGINT
    AND poi.po_id = p_po_id;

  UPDATE purchase_orders
  SET updated_by = p_user_id
  WHERE id = p_po_id
  RETURNING row_version INTO v_new;

  RETURN v_new;
END;
$function$;
-- +goose StatementEnd

-- Ubah PO keeps each kept line's note.
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
  v_old_costs   JSONB;
  v_old_notes   JSONB;
  v_cost        NUMERIC;
  it            JSONB;
BEGIN
  SELECT status, quotation_id INTO v_status, v_quotation
  FROM purchase_orders
  WHERE id = p_po_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'PO tidak ditemukan. Muat ulang halaman.'
      USING ERRCODE = 'P0011';
  END IF;

  IF v_status = 'CANCELLED' THEN
    RAISE EXCEPTION 'PO yang dibatalkan tidak dapat diubah.'
      USING ERRCODE = 'P0013';
  END IF;

  -- The PO lock above orders this with fn_replace_invoice.
  IF fn_po_lines_locked(p_po_id, v_status) THEN
    RAISE EXCEPTION 'PO yang sudah dikirim hanya bisa diubah jika invoicenya dibatalkan dan invoice pengganti belum diterbitkan.'
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

  -- A PO line prints only its own name.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) AS e
    WHERE NULLIF(BTRIM(e->>'itemName'), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'Isi nama produk di setiap baris produk.'
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

  -- What each link cost on this PO before the edit.
  SELECT COALESCE(jsonb_object_agg(vendor_product_id::TEXT, cost_price), '{}') INTO v_old_costs
  FROM purchase_order_items
  WHERE po_id = p_po_id AND vendor_product_id IS NOT NULL AND cost_price IS NOT NULL;

  -- Delivery note notes, kept by line id.
  SELECT COALESCE(jsonb_object_agg(id::TEXT, dn_note), '{}') INTO v_old_notes
  FROM purchase_order_items
  WHERE po_id = p_po_id AND dn_note IS NOT NULL;

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
      discount_pct, is_available, ship_destination, dn_note,
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
      v_old_notes->>(it->>'id'),
      p_user_id,
      p_user_id
    );

    -- A changed harga beli is the catalog's current price for that vendor.
    v_cost := NULLIF(it->>'costPrice','')::NUMERIC;
    IF v_link IS NOT NULL AND v_cost > 0
       AND (v_old_costs->>(v_link::TEXT))::NUMERIC IS DISTINCT FROM v_cost THEN
      UPDATE vendor_products
         SET cost_price = v_cost, last_quoted_at = NOW(), updated_by = p_user_id
       WHERE id = v_link AND cost_price IS DISTINCT FROM v_cost;
    END IF;
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
;
-- +goose StatementEnd

-- +goose Down
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
  v_old_costs   JSONB;
  v_cost        NUMERIC;
  it            JSONB;
BEGIN
  SELECT status, quotation_id INTO v_status, v_quotation
  FROM purchase_orders
  WHERE id = p_po_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'PO tidak ditemukan. Muat ulang halaman.'
      USING ERRCODE = 'P0011';
  END IF;

  IF v_status = 'CANCELLED' THEN
    RAISE EXCEPTION 'PO yang dibatalkan tidak dapat diubah.'
      USING ERRCODE = 'P0013';
  END IF;

  -- The PO lock above orders this with fn_replace_invoice.
  IF fn_po_lines_locked(p_po_id, v_status) THEN
    RAISE EXCEPTION 'PO yang sudah dikirim hanya bisa diubah jika invoicenya dibatalkan dan invoice pengganti belum diterbitkan.'
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

  -- A PO line prints only its own name.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) AS e
    WHERE NULLIF(BTRIM(e->>'itemName'), '') IS NULL
  ) THEN
    RAISE EXCEPTION 'Isi nama produk di setiap baris produk.'
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

  -- What each link cost on this PO before the edit.
  SELECT COALESCE(jsonb_object_agg(vendor_product_id::TEXT, cost_price), '{}') INTO v_old_costs
  FROM purchase_order_items
  WHERE po_id = p_po_id AND vendor_product_id IS NOT NULL AND cost_price IS NOT NULL;

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

    -- A changed harga beli is the catalog's current price for that vendor.
    v_cost := NULLIF(it->>'costPrice','')::NUMERIC;
    IF v_link IS NOT NULL AND v_cost > 0
       AND (v_old_costs->>(v_link::TEXT))::NUMERIC IS DISTINCT FROM v_cost THEN
      UPDATE vendor_products
         SET cost_price = v_cost, last_quoted_at = NOW(), updated_by = p_user_id
       WHERE id = v_link AND cost_price IS DISTINCT FROM v_cost;
    END IF;
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
;
-- +goose StatementEnd

DROP FUNCTION IF EXISTS public.fn_update_po_dn_notes(bigint, integer, jsonb, bigint);
ALTER TABLE purchase_order_items DROP COLUMN IF EXISTS dn_note;
