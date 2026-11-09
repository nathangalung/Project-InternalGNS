-- +goose Up
-- 00122 CAN AND A RETIRED OTH
-- CAN becomes a unit of its own beside TIN: a can is printed as CAN, and
-- CANS names it too. KALENG means either, so like MT and LB it names
-- neither and the user picks CAN or TIN.
--
-- OTH (Lainnya) is retired, not deleted. Filed documents keep printing it
-- (a sent quotation, a PO, an invoice and Coretax read the row as filed),
-- so its row stays, but nothing picks it again: the pickers leave it out,
-- a draft line, an Ubah PO line and a product default naming it are
-- refused, and a revision copies it as no unit, which the send rule then
-- asks for. Product defaults and draft lines that still name it are
-- cleared here, so the next user picks a real unit.
-- A database without master data skips the unit rows, like 00118.

ALTER TABLE units ADD COLUMN is_active BOOLEAN NOT NULL DEFAULT TRUE;

UPDATE units SET is_active = FALSE WHERE code = 'OTH';

-- CAN moves off TIN before the code exists, since an alias never equals a code.
DELETE FROM unit_aliases a
USING units u
WHERE u.id = a.unit_id AND u.code = 'TIN' AND a.alias IN ('CAN', 'CANS', 'KALENG');

INSERT INTO units (code, name, coretax_code)
SELECT 'CAN', 'Can', 'UM.0033'
WHERE EXISTS (SELECT 1 FROM units WHERE code = 'OTH')
ON CONFLICT (code) DO NOTHING;

INSERT INTO unit_aliases (alias, unit_id)
SELECT 'CANS', u.id FROM units u WHERE u.code = 'CAN'
ON CONFLICT (alias) DO NOTHING;

-- A default is only where a new line starts.
UPDATE items i
   SET default_unit_id = NULL
  FROM units u
 WHERE u.id = i.default_unit_id AND NOT u.is_active;

-- A draft is still being written; the send rule asks for a unit.
UPDATE quotation_items qi
   SET unit_id = NULL
  FROM units u, quotations q
 WHERE u.id = qi.unit_id AND NOT u.is_active
   AND q.id = qi.quotation_id AND q.status = 'draft';

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_refuse_retired_unit(p_unit smallint, p_kept smallint, p_column text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_code TEXT;
BEGIN
  -- No unit, or the one the row already has, is always fine.
  IF p_unit IS NULL OR p_unit IS NOT DISTINCT FROM p_kept THEN
    RETURN;
  END IF;
  SELECT code INTO v_code FROM units WHERE id = p_unit AND NOT is_active;
  IF FOUND THEN
    RAISE EXCEPTION 'Satuan % sudah tidak dipakai. Pilih satuan lain.', v_code
      USING ERRCODE = 'P0014', COLUMN = COALESCE(p_column, '');
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
      v_item := (v_item - 'vendor_product_id' - 'cost_price' - 'update_vendor_price' - 'product_url')
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
    ELSIF NULLIF(v_item->>'vendor_product_id', '') IS NOT NULL
      AND NULLIF(v_item->>'offered_item_id', '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM vendor_products
        WHERE id = (v_item->>'vendor_product_id')::BIGINT
          AND item_id = (v_item->>'offered_item_id')::BIGINT) THEN
      -- A vendor link names one product.
      RAISE EXCEPTION 'Vendor ini tidak menyediakan produk tersebut. Pilih vendor lain.'
        USING ERRCODE = 'P0014';
    END IF;
    -- A typed Link Produk goes on the line's vendor link; none keeps it.
    v_link := NULLIF(v_item->>'vendor_product_id', '')::BIGINT;
    IF v_item ? 'product_url' AND v_link IS NOT NULL THEN
      UPDATE vendor_products
         SET product_url = NULLIF(BTRIM(v_item->>'product_url'), ''),
             updated_by  = p_user_id
       WHERE id = v_link
         AND item_id = NULLIF(v_item->>'offered_item_id', '')::BIGINT
         AND product_url IS DISTINCT FROM NULLIF(BTRIM(v_item->>'product_url'), '');
    END IF;
    -- A retired unit is never picked again.
    PERFORM fn_refuse_retired_unit(NULLIF(v_item->>'unit_id', '')::SMALLINT, NULL, NULL);
    v_out := v_out || jsonb_build_array(v_item - 'vendor_id' - 'product_url');
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
  v_old_costs   JSONB;
  v_old_notes   JSONB;
  v_old_units   JSONB;
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

  -- Units, kept by line id: a line may keep a retired one.
  SELECT COALESCE(jsonb_object_agg(id::TEXT, unit_id), '{}') INTO v_old_units
  FROM purchase_order_items
  WHERE po_id = p_po_id AND unit_id IS NOT NULL;

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

    -- A typed Link Produk goes on the line's vendor link; none keeps it.
    IF it ? 'productUrl' AND v_link IS NOT NULL THEN
      UPDATE vendor_products
         SET product_url = NULLIF(BTRIM(it->>'productUrl'), ''), updated_by = p_user_id
       WHERE id = v_link
         AND product_url IS DISTINCT FROM NULLIF(BTRIM(it->>'productUrl'), '');
    END IF;

    -- A line keeps its stored unit, retired or not, but picks no retired one.
    PERFORM fn_refuse_retired_unit(
      NULLIF(it->>'unitId','')::SMALLINT, (v_old_units->>(it->>'id'))::SMALLINT, NULL);

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
$function$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_revise_quotation(p_quotation_id bigint, p_user_id bigint, p_note text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_orig   quotations%ROWTYPE;
  v_new_id BIGINT;
  v_new_no TEXT;
  v_learn  TEXT;
BEGIN
  SELECT * INTO v_orig
  FROM quotations
  WHERE id = p_quotation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quotation tidak ditemukan. Muat ulang halaman.'
      USING ERRCODE = 'P0011';
  END IF;

  IF v_orig.status <> 'sent' THEN
    RAISE EXCEPTION 'Hanya quotation berstatus Dikirim yang dapat direvisi. Status saat ini %.',
      fn_quotation_status_label(v_orig.status)
      USING ERRCODE = 'P0012';
  END IF;

  -- Version n+1 prints as Rev.n on the base number.
  v_new_no := regexp_replace(v_orig.quotation_no, ' Rev\.[0-9]+$', '')
              || ' Rev.' || v_orig.version;

  INSERT INTO quotations (
    quotation_no, version, parent_id,
    company_client_id, company_client_name, contact_id, contact_name,
    client_ref_no, vessel_name, status, notes,
    payment_terms, validity_days, discount_pct,
    total_produk, total, total_discount,
    dpp_nilai_lain, ppn_amount, grand_total,
    created_by, updated_by, ppn_enabled
  ) VALUES (
    v_new_no, v_orig.version + 1, v_orig.id,
    v_orig.company_client_id, v_orig.company_client_name, v_orig.contact_id, v_orig.contact_name,
    v_orig.client_ref_no, v_orig.vessel_name, 'draft', v_orig.notes,
    v_orig.payment_terms, v_orig.validity_days, v_orig.discount_pct,
    v_orig.total_produk, v_orig.total, v_orig.total_discount,
    -- The lines are copied as they are, so their tax is too.
    v_orig.dpp_nilai_lain, v_orig.ppn_amount, v_orig.grand_total,
    p_user_id, p_user_id, v_orig.ppn_enabled
  ) RETURNING id INTO v_new_id;

  UPDATE quotation_status_history
  SET note = 'Revisi dari ' || v_orig.quotation_no
  WHERE quotation_id = v_new_id;

  INSERT INTO quotation_item_requests (
    quotation_id, line_no, request_text, request_impa,
    requested_qty, requested_uom, matched_item_id, match_status,
    source_type, source_ref, notes, reviewed_by, reviewed_at,
    created_by, updated_by
  )
  SELECT v_new_id, r.line_no, r.request_text, r.request_impa,
         r.requested_qty, r.requested_uom, r.matched_item_id, r.match_status,
         r.source_type, r.source_ref, r.notes, r.reviewed_by, r.reviewed_at,
         p_user_id, p_user_id
  FROM quotation_item_requests r
  WHERE r.quotation_id = v_orig.id;

  -- The copy teaches trg_learn_match nothing.
  v_learn := current_setting('gns.learn_match', true);
  PERFORM set_config('gns.learn_match', 'off', true);

  -- Vendor cost sync stays off: the copy quotes no new price.
  -- A retired unit is left out, so the revision asks for a current one.
  INSERT INTO quotation_items (
    quotation_id, line_number, item_type,
    requested_item_id, requested_impa, requested_name,
    offered_item_id, vendor_product_id,
    qty, unit_id, selling_price, cost_price, discount_pct,
    is_available, ship_destination, due_date, shipping_days,
    update_vendor_price, request_id, created_by, updated_by
  )
  SELECT v_new_id, qi.line_number, qi.item_type,
         qi.requested_item_id, qi.requested_impa, qi.requested_name,
         qi.offered_item_id, qi.vendor_product_id,
         qi.qty, u.id, qi.selling_price, qi.cost_price, qi.discount_pct,
         qi.is_available, qi.ship_destination, qi.due_date, qi.shipping_days,
         FALSE, nr.id, p_user_id, p_user_id
  FROM quotation_items qi
  LEFT JOIN units u ON u.id = qi.unit_id AND u.is_active
  LEFT JOIN quotation_item_requests orr ON orr.id = qi.request_id
  LEFT JOIN quotation_item_requests nr
         ON nr.quotation_id = v_new_id AND nr.line_no = orr.line_no
  WHERE qi.quotation_id = v_orig.id
  ORDER BY qi.line_number;

  PERFORM set_config('gns.learn_match', COALESCE(v_learn, ''), true);

  UPDATE quotations
  SET status     = 'revision',
      updated_by = p_user_id
  WHERE id = v_orig.id;

  INSERT INTO quotation_status_history
    (quotation_id, from_status, to_status, note, changed_by)
  VALUES
    (v_orig.id, 'sent', 'revision',
     COALESCE(NULLIF(BTRIM(p_note), ''), 'Direvisi menjadi ' || v_new_no),
     p_user_id);

  RETURN v_new_id;
END;
$function$;
-- +goose StatementEnd

-- +goose Down
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
      v_item := (v_item - 'vendor_product_id' - 'cost_price' - 'update_vendor_price' - 'product_url')
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
    ELSIF NULLIF(v_item->>'vendor_product_id', '') IS NOT NULL
      AND NULLIF(v_item->>'offered_item_id', '') IS NOT NULL
      AND NOT EXISTS (
        SELECT 1 FROM vendor_products
        WHERE id = (v_item->>'vendor_product_id')::BIGINT
          AND item_id = (v_item->>'offered_item_id')::BIGINT) THEN
      -- A vendor link names one product.
      RAISE EXCEPTION 'Vendor ini tidak menyediakan produk tersebut. Pilih vendor lain.'
        USING ERRCODE = 'P0014';
    END IF;
    -- A typed Link Produk goes on the line's vendor link; none keeps it.
    v_link := NULLIF(v_item->>'vendor_product_id', '')::BIGINT;
    IF v_item ? 'product_url' AND v_link IS NOT NULL THEN
      UPDATE vendor_products
         SET product_url = NULLIF(BTRIM(v_item->>'product_url'), ''),
             updated_by  = p_user_id
       WHERE id = v_link
         AND item_id = NULLIF(v_item->>'offered_item_id', '')::BIGINT
         AND product_url IS DISTINCT FROM NULLIF(BTRIM(v_item->>'product_url'), '');
    END IF;
    v_out := v_out || jsonb_build_array(v_item - 'vendor_id' - 'product_url');
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

    -- A typed Link Produk goes on the line's vendor link; none keeps it.
    IF it ? 'productUrl' AND v_link IS NOT NULL THEN
      UPDATE vendor_products
         SET product_url = NULLIF(BTRIM(it->>'productUrl'), ''), updated_by = p_user_id
       WHERE id = v_link
         AND product_url IS DISTINCT FROM NULLIF(BTRIM(it->>'productUrl'), '');
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
$function$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_revise_quotation(p_quotation_id bigint, p_user_id bigint, p_note text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_orig   quotations%ROWTYPE;
  v_new_id BIGINT;
  v_new_no TEXT;
  v_learn  TEXT;
BEGIN
  SELECT * INTO v_orig
  FROM quotations
  WHERE id = p_quotation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quotation tidak ditemukan. Muat ulang halaman.'
      USING ERRCODE = 'P0011';
  END IF;

  IF v_orig.status <> 'sent' THEN
    RAISE EXCEPTION 'Hanya quotation berstatus Dikirim yang dapat direvisi. Status saat ini %.',
      fn_quotation_status_label(v_orig.status)
      USING ERRCODE = 'P0012';
  END IF;

  -- Version n+1 prints as Rev.n on the base number.
  v_new_no := regexp_replace(v_orig.quotation_no, ' Rev\.[0-9]+$', '')
              || ' Rev.' || v_orig.version;

  INSERT INTO quotations (
    quotation_no, version, parent_id,
    company_client_id, company_client_name, contact_id, contact_name,
    client_ref_no, vessel_name, status, notes,
    payment_terms, validity_days, discount_pct,
    total_produk, total, total_discount,
    dpp_nilai_lain, ppn_amount, grand_total,
    created_by, updated_by, ppn_enabled
  ) VALUES (
    v_new_no, v_orig.version + 1, v_orig.id,
    v_orig.company_client_id, v_orig.company_client_name, v_orig.contact_id, v_orig.contact_name,
    v_orig.client_ref_no, v_orig.vessel_name, 'draft', v_orig.notes,
    v_orig.payment_terms, v_orig.validity_days, v_orig.discount_pct,
    v_orig.total_produk, v_orig.total, v_orig.total_discount,
    -- The lines are copied as they are, so their tax is too.
    v_orig.dpp_nilai_lain, v_orig.ppn_amount, v_orig.grand_total,
    p_user_id, p_user_id, v_orig.ppn_enabled
  ) RETURNING id INTO v_new_id;

  UPDATE quotation_status_history
  SET note = 'Revisi dari ' || v_orig.quotation_no
  WHERE quotation_id = v_new_id;

  INSERT INTO quotation_item_requests (
    quotation_id, line_no, request_text, request_impa,
    requested_qty, requested_uom, matched_item_id, match_status,
    source_type, source_ref, notes, reviewed_by, reviewed_at,
    created_by, updated_by
  )
  SELECT v_new_id, r.line_no, r.request_text, r.request_impa,
         r.requested_qty, r.requested_uom, r.matched_item_id, r.match_status,
         r.source_type, r.source_ref, r.notes, r.reviewed_by, r.reviewed_at,
         p_user_id, p_user_id
  FROM quotation_item_requests r
  WHERE r.quotation_id = v_orig.id;

  -- The copy teaches trg_learn_match nothing.
  v_learn := current_setting('gns.learn_match', true);
  PERFORM set_config('gns.learn_match', 'off', true);

  -- Vendor cost sync stays off: the copy quotes no new price.
  INSERT INTO quotation_items (
    quotation_id, line_number, item_type,
    requested_item_id, requested_impa, requested_name,
    offered_item_id, vendor_product_id,
    qty, unit_id, selling_price, cost_price, discount_pct,
    is_available, ship_destination, due_date, shipping_days,
    update_vendor_price, request_id, created_by, updated_by
  )
  SELECT v_new_id, qi.line_number, qi.item_type,
         qi.requested_item_id, qi.requested_impa, qi.requested_name,
         qi.offered_item_id, qi.vendor_product_id,
         qi.qty, qi.unit_id, qi.selling_price, qi.cost_price, qi.discount_pct,
         qi.is_available, qi.ship_destination, qi.due_date, qi.shipping_days,
         FALSE, nr.id, p_user_id, p_user_id
  FROM quotation_items qi
  LEFT JOIN quotation_item_requests orr ON orr.id = qi.request_id
  LEFT JOIN quotation_item_requests nr
         ON nr.quotation_id = v_new_id AND nr.line_no = orr.line_no
  WHERE qi.quotation_id = v_orig.id
  ORDER BY qi.line_number;

  PERFORM set_config('gns.learn_match', COALESCE(v_learn, ''), true);

  UPDATE quotations
  SET status     = 'revision',
      updated_by = p_user_id
  WHERE id = v_orig.id;

  INSERT INTO quotation_status_history
    (quotation_id, from_status, to_status, note, changed_by)
  VALUES
    (v_orig.id, 'sent', 'revision',
     COALESCE(NULLIF(BTRIM(p_note), ''), 'Direvisi menjadi ' || v_new_no),
     p_user_id);

  RETURN v_new_id;
END;
$function$;
-- +goose StatementEnd

DROP FUNCTION IF EXISTS public.fn_refuse_retired_unit(smallint, smallint, text);

-- CAN and KALENG go back to being spellings of TIN. A used CAN keeps its row.
DELETE FROM unit_aliases WHERE alias = 'CANS';
DELETE FROM units u
WHERE u.code = 'CAN'
  AND NOT EXISTS (SELECT 1 FROM items WHERE default_unit_id = u.id)
  AND NOT EXISTS (SELECT 1 FROM quotation_items WHERE unit_id = u.id)
  AND NOT EXISTS (SELECT 1 FROM purchase_order_items WHERE unit_id = u.id)
  AND NOT EXISTS (SELECT 1 FROM invoice_items WHERE unit_id = u.id);
INSERT INTO unit_aliases (alias, unit_id)
SELECT 'KALENG', u.id FROM units u WHERE u.code = 'TIN'
ON CONFLICT (alias) DO NOTHING;
INSERT INTO unit_aliases (alias, unit_id)
SELECT v.alias, u.id
FROM (VALUES ('CAN'), ('CANS')) v(alias)
JOIN units u ON u.code = 'TIN'
WHERE NOT EXISTS (SELECT 1 FROM units WHERE code = 'CAN')
ON CONFLICT (alias) DO NOTHING;

ALTER TABLE units DROP COLUMN is_active;
