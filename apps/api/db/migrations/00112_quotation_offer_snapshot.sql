-- +goose Up
-- 00112 QUOTATION OFFER SNAPSHOT
-- Quotation lines read the offered product's name and IMPA code from the
-- catalog, so renaming a product restated every quotation the client had
-- already received, and its PDF reprint. A line now keeps both from the
-- moment its quotation leaves draft (fn_freeze_quotation_offer); a draft
-- keeps neither and still follows the catalog. offered_name marks a frozen
-- line, so one whose product had no code keeps offered_impa NULL even after
-- the product gains one. Every quotation already past draft is frozen at
-- what it prints today. A PO line prints only its own name and code: the
-- blank ones that fell back to the catalog take what they printed, and Ubah
-- PO refuses a product line without a name.
ALTER TABLE quotation_items
  ADD COLUMN offered_name VARCHAR(500),
  ADD COLUMN offered_impa VARCHAR(20);

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_freeze_quotation_offer(p_quotation_id bigint)
 RETURNS void
 LANGUAGE sql
AS $function$
  UPDATE quotation_items qi
     SET offered_name = oi.name,
         offered_impa = oi.impa_code
    FROM items oi
   WHERE qi.quotation_id = p_quotation_id
     AND oi.id = qi.offered_item_id
     AND qi.offered_name IS NULL
$function$;
-- +goose StatementEnd

-- The backfill is no edit, so versions stay.
ALTER TABLE quotation_items DISABLE TRIGGER trg_quotation_items_updated_at;
UPDATE quotation_items qi
   SET offered_name = oi.name,
       offered_impa = oi.impa_code
  FROM items oi, quotations q
 WHERE oi.id = qi.offered_item_id
   AND q.id = qi.quotation_id
   AND q.status <> 'draft'
   AND qi.offered_name IS NULL;
ALTER TABLE quotation_items ENABLE TRIGGER trg_quotation_items_updated_at;

ALTER TABLE purchase_order_items DISABLE TRIGGER trg_purchase_order_items_updated_at;
UPDATE purchase_order_items poi
   SET item_name = i.name
  FROM items i
 WHERE i.id = poi.offered_item_id
   AND COALESCE(poi.item_name, '') = '';
UPDATE purchase_order_items poi
   SET item_code = i.impa_code
  FROM items i
 WHERE i.id = poi.offered_item_id
   AND poi.item_code IS NULL
   AND i.impa_code IS NOT NULL;
ALTER TABLE purchase_order_items ENABLE TRIGGER trg_purchase_order_items_updated_at;

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_change_quotation_status(p_quotation_id bigint, p_new_status text, p_user_id bigint, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_old_status VARCHAR(20);
  v_valid      BOOLEAN;
  v_incomplete INTEGER;
  v_validity   SMALLINT;
BEGIN
  SELECT status, validity_days INTO v_old_status, v_validity
  FROM quotations
  WHERE id = p_quotation_id
  FOR UPDATE;

  IF v_old_status IS NULL THEN
    RAISE EXCEPTION 'Quotation tidak ditemukan. Muat ulang halaman.'
      USING ERRCODE = 'P0011';
  END IF;

  IF v_old_status = p_new_status THEN
    RETURN;
  END IF;

  -- Mirrored by quotations.Transitions in Go.
  v_valid := CASE
    WHEN v_old_status = 'draft'    AND p_new_status IN ('sent','cancelled') THEN TRUE
    WHEN v_old_status = 'sent'     AND p_new_status IN ('accepted','rejected','cancelled') THEN TRUE
    WHEN v_old_status = 'revision' AND p_new_status IN ('rejected','cancelled') THEN TRUE
    ELSE FALSE
  END;

  IF NOT v_valid THEN
    IF p_new_status = 'revision' AND v_old_status = 'sent' THEN
      RAISE EXCEPTION 'Gunakan tombol Buat Revisi untuk merevisi quotation yang sudah dikirim.'
        USING ERRCODE = 'P0012';
    END IF;
    RAISE EXCEPTION 'Status quotation tidak dapat diubah dari % ke %.',
      fn_quotation_status_label(v_old_status), fn_quotation_status_label(p_new_status)
      USING ERRCODE = 'P0012';
  END IF;

  -- Leaving the draft ends every edit; wait for the other editors.
  IF v_old_status = 'draft' THEN
    PERFORM fn_quotation_no_other_editors(p_quotation_id, p_user_id);
  END IF;

  IF p_new_status IN ('rejected','cancelled') AND NULLIF(BTRIM(p_note), '') IS NULL THEN
    RAISE EXCEPTION 'Alasan wajib diisi untuk mengubah status menjadi %.',
      fn_quotation_status_label(p_new_status)
      USING ERRCODE = 'P0014';
  END IF;

  -- The PDF prints the Validity, so what is sent needs one.
  IF p_new_status = 'sent' AND v_validity IS NULL THEN
    RAISE EXCEPTION 'Isi masa berlaku sebelum quotation dikirim.'
      USING ERRCODE = 'P0014';
  END IF;

  -- A draft may hold unfinished lines; what is sent must be complete.
  IF p_new_status = 'sent' THEN
    SELECT count(*) INTO v_incomplete
    FROM quotation_items
    WHERE quotation_id = p_quotation_id
      AND item_type = 'product'
      AND is_available
      AND (offered_item_id IS NULL
           OR unit_id IS NULL
           OR vendor_product_id IS NULL
           OR COALESCE(cost_price, 0) <= 0
           OR selling_price IS NULL OR selling_price <= 0);
    IF v_incomplete > 0 THEN
      RAISE EXCEPTION '% baris produk belum lengkap. Isi produk, satuan, vendor, harga beli, dan harga jual sebelum quotation dikirim.', v_incomplete
        USING ERRCODE = 'P0014';
    END IF;
  END IF;

  IF p_new_status = 'accepted' THEN
    IF NOT EXISTS (
      SELECT 1 FROM quotation_items
      WHERE quotation_id = p_quotation_id
        AND item_type = 'product'
        AND is_available
    ) THEN
      RAISE EXCEPTION 'Tidak ada produk yang ditawarkan di quotation ini, jadi tidak ada yang bisa disetujui.'
        USING ERRCODE = 'P0014';
    END IF;
    IF EXISTS (
      SELECT 1 FROM quotation_items
      WHERE quotation_id = p_quotation_id
        AND item_type = 'product'
        AND is_available
        AND (selling_price IS NULL OR selling_price <= 0)
    ) THEN
      RAISE EXCEPTION 'Quotation % masih memiliki baris produk tanpa harga jual.', p_quotation_id
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

  IF v_old_status = 'draft' THEN
    -- The client receives the offer as it is now.
    PERFORM fn_freeze_quotation_offer(p_quotation_id);
    DELETE FROM quotation_edit_locks WHERE quotation_id = p_quotation_id;
  END IF;
  PERFORM fn_quotation_notify(p_quotation_id, 'status', NULL, p_user_id);
END;
$function$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_create_quotation(p_company_client_id bigint, p_contact_id bigint, p_client_ref_no text, p_vessel_name text, p_payment_terms text, p_validity_days integer, p_discount_pct numeric, p_shipping_address text, p_shipping_days integer, p_shipping_cost numeric, p_items jsonb, p_created_by bigint, p_notes text DEFAULT NULL::text, p_status text DEFAULT 'draft'::text, p_ppn_enabled boolean DEFAULT true)
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
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
  v_pct                 NUMERIC(5,2);
  v_line                NUMERIC(15,2);
  v_dpp                 NUMERIC(15,2) := 0;
  v_ppn                 NUMERIC(15,2) := 0;
BEGIN
  -- 1. Validation
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Quotation harus memiliki minimal satu baris.'
      USING ERRCODE = 'P0014';
  END IF;

  IF p_discount_pct < 0 OR p_discount_pct > 100 THEN
    RAISE EXCEPTION 'Diskon harus antara 0 dan 100. Nilai yang dikirim %.', p_discount_pct
      USING ERRCODE = 'P0014';
  END IF;

  -- Number first, before any lock.
  -- The counter row is then the first lock this transaction takes, so the
  -- line preparation (fn_link_vendor_item, trg_fn_sync_vendor_cost) never
  -- holds a row another creator needs while it waits for the counter. A
  -- refused quotation rolls the number back with it.
  v_quotation_no := fn_next_doc_no('Q');

  -- The pct the lines inherit, at column scale.
  v_pct := p_discount_pct;

  -- 2. Snapshot company_client_name + contact_name
  SELECT name INTO v_company_name
  FROM company_client WHERE id = p_company_client_id AND is_active = TRUE;

  IF v_company_name IS NULL THEN
    RAISE EXCEPTION 'Klien tidak ditemukan atau sudah nonaktif. Pilih klien lain.'
      USING ERRCODE = 'P0014';
  END IF;

  IF p_contact_id IS NOT NULL THEN
    SELECT name INTO v_contact_name
    FROM company_contacts
    WHERE id = p_contact_id AND company_id = p_company_client_id AND is_active = TRUE;

    IF v_contact_name IS NULL THEN
      RAISE EXCEPTION 'Narahubung tidak ditemukan, sudah nonaktif, atau bukan milik klien ini.'
        USING ERRCODE = 'P0014';
    END IF;
  END IF;

  -- Lines are prepared after the client checks, as fn_update_quotation
  -- prepares them after its row lock and status checks.
  p_items := fn_prepare_quotation_lines(p_items, p_created_by);

  -- 3. Pre-calculate totals. The discount is gross minus net per line, as
  -- quotation_items.subtotal and v_po_totals round them, so the header
  -- subtotal is the sum of the line subtotals. DPP and PPN are rounded per
  -- line and summed, as v_po_totals and fn_create_invoice do.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_item->>'qty')::NUMERIC(12,2);
    v_selling_price := (v_item->>'selling_price')::NUMERIC(15,2);
    v_line := ROUND(v_qty * v_selling_price * (1 - v_pct / 100), 2);

    v_total          := v_total + (v_qty * v_selling_price);
    v_total_produk   := v_total_produk + (v_qty * v_selling_price);
    v_total_discount := v_total_discount
                        + ROUND(v_qty * v_selling_price, 2)
                        - v_line;
    v_dpp            := v_dpp + fn_line_dpp(v_line);
    v_ppn            := v_ppn + fn_line_ppn(v_line);
  END LOOP;

  IF p_shipping_cost IS NOT NULL AND p_shipping_cost > 0 THEN
    v_total := v_total + p_shipping_cost;
    v_dpp   := v_dpp + fn_line_dpp(p_shipping_cost);
    v_ppn   := v_ppn + fn_line_ppn(p_shipping_cost);
  END IF;

  -- 5. INSERT header
  INSERT INTO quotations (
    quotation_no, version, company_client_id, company_client_name,
    contact_id, contact_name,
    client_ref_no, vessel_name, status,
    payment_terms, validity_days, discount_pct,
    total_produk, total, total_discount,
    dpp_nilai_lain, ppn_amount, grand_total,
    notes, created_by, updated_by, ppn_enabled
  ) VALUES (
    v_quotation_no, 1, p_company_client_id, v_company_name,
    p_contact_id, v_contact_name,
    p_client_ref_no, p_vessel_name, p_status,
    p_payment_terms, p_validity_days, p_discount_pct,
    v_total_produk, v_total, v_total_discount,
    v_dpp, v_ppn, v_total - v_total_discount + v_ppn,
    p_notes, p_created_by, p_created_by, p_ppn_enabled
  ) RETURNING id INTO v_quotation_id;

  -- 6. INSERT product items
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

  -- 7. INSERT shipping line
  IF NULLIF(TRIM(p_shipping_address), '') IS NOT NULL OR COALESCE(p_shipping_cost, 0) > 0
     OR p_shipping_days IS NOT NULL THEN
    v_line_no := v_line_no + 1;
    INSERT INTO quotation_items (
      quotation_id, line_number, item_type,
      requested_name,
      qty, unit_id, selling_price,
      ship_destination, shipping_days,
      created_by, updated_by
    ) VALUES (
      v_quotation_id,
      v_line_no,
      'shipping',
      'SHIPPING' || COALESCE(' - ' || p_shipping_address, ''),
      1,
      (SELECT id FROM units WHERE code = 'UNIT' LIMIT 1),
      COALESCE(p_shipping_cost, 0),
      p_shipping_address,
      p_shipping_days,
      p_created_by, p_created_by
    );
  END IF;

  PERFORM fn_recompute_quotation_totals(v_quotation_id);

  -- Created past draft, it is filed.
  IF p_status <> 'draft' THEN
    PERFORM fn_freeze_quotation_offer(v_quotation_id);
  END IF;

  RETURN v_quotation_id;
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
  v_company_id   BIGINT;
  v_contact_id   BIGINT;
  v_ppn_on       BOOLEAN;
BEGIN
  SELECT id INTO v_po_id FROM purchase_orders WHERE quotation_id = p_quotation_id;
  IF v_po_id IS NOT NULL THEN
    RETURN v_po_id;
  END IF;

  SELECT company_client_id, contact_id, ppn_enabled
  INTO v_company_id, v_contact_id, v_ppn_on
  FROM quotations WHERE id = p_quotation_id;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Quotation tidak ditemukan. Muat ulang halaman.'
      USING ERRCODE = 'P0011';
  END IF;

  -- po_number is the client's own, entered later.
  INSERT INTO purchase_orders (
    quotation_id, company_client_id, contact_id,
    po_date, status, created_by, updated_by, ppn_enabled
  ) VALUES (
    p_quotation_id, v_company_id, v_contact_id,
    CURRENT_DATE, 'PENDING', p_user_id, p_user_id, v_ppn_on
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
    -- What the client accepted, frozen at send.
    COALESCE(NULLIF(qi.offered_name, ''), NULLIF(oi.name, ''), qi.requested_name, ''),
    CASE WHEN qi.offered_name IS NOT NULL THEN NULLIF(qi.offered_impa, '')
         WHEN oi.id IS NOT NULL THEN NULLIF(oi.impa_code, '')
         ELSE qi.requested_impa END,
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
$function$;
-- +goose StatementEnd

-- +goose Down
-- The previous bodies read the catalog again. PO names the Up filled in
-- stay, since they are what those lines printed.

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_change_quotation_status(p_quotation_id bigint, p_new_status text, p_user_id bigint, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_old_status VARCHAR(20);
  v_valid      BOOLEAN;
  v_incomplete INTEGER;
  v_validity   SMALLINT;
BEGIN
  SELECT status, validity_days INTO v_old_status, v_validity
  FROM quotations
  WHERE id = p_quotation_id
  FOR UPDATE;

  IF v_old_status IS NULL THEN
    RAISE EXCEPTION 'Quotation tidak ditemukan. Muat ulang halaman.'
      USING ERRCODE = 'P0011';
  END IF;

  IF v_old_status = p_new_status THEN
    RETURN;
  END IF;

  -- Mirrored by quotations.Transitions in Go.
  v_valid := CASE
    WHEN v_old_status = 'draft'    AND p_new_status IN ('sent','cancelled') THEN TRUE
    WHEN v_old_status = 'sent'     AND p_new_status IN ('accepted','rejected','cancelled') THEN TRUE
    WHEN v_old_status = 'revision' AND p_new_status IN ('rejected','cancelled') THEN TRUE
    ELSE FALSE
  END;

  IF NOT v_valid THEN
    IF p_new_status = 'revision' AND v_old_status = 'sent' THEN
      RAISE EXCEPTION 'Gunakan tombol Buat Revisi untuk merevisi quotation yang sudah dikirim.'
        USING ERRCODE = 'P0012';
    END IF;
    RAISE EXCEPTION 'Status quotation tidak dapat diubah dari % ke %.',
      fn_quotation_status_label(v_old_status), fn_quotation_status_label(p_new_status)
      USING ERRCODE = 'P0012';
  END IF;

  -- Leaving the draft ends every edit; wait for the other editors.
  IF v_old_status = 'draft' THEN
    PERFORM fn_quotation_no_other_editors(p_quotation_id, p_user_id);
  END IF;

  IF p_new_status IN ('rejected','cancelled') AND NULLIF(BTRIM(p_note), '') IS NULL THEN
    RAISE EXCEPTION 'Alasan wajib diisi untuk mengubah status menjadi %.',
      fn_quotation_status_label(p_new_status)
      USING ERRCODE = 'P0014';
  END IF;

  -- The PDF prints the Validity, so what is sent needs one.
  IF p_new_status = 'sent' AND v_validity IS NULL THEN
    RAISE EXCEPTION 'Isi masa berlaku sebelum quotation dikirim.'
      USING ERRCODE = 'P0014';
  END IF;

  -- A draft may hold unfinished lines; what is sent must be complete.
  IF p_new_status = 'sent' THEN
    SELECT count(*) INTO v_incomplete
    FROM quotation_items
    WHERE quotation_id = p_quotation_id
      AND item_type = 'product'
      AND is_available
      AND (offered_item_id IS NULL
           OR unit_id IS NULL
           OR vendor_product_id IS NULL
           OR COALESCE(cost_price, 0) <= 0
           OR selling_price IS NULL OR selling_price <= 0);
    IF v_incomplete > 0 THEN
      RAISE EXCEPTION '% baris produk belum lengkap. Isi produk, satuan, vendor, harga beli, dan harga jual sebelum quotation dikirim.', v_incomplete
        USING ERRCODE = 'P0014';
    END IF;
  END IF;

  IF p_new_status = 'accepted' THEN
    IF NOT EXISTS (
      SELECT 1 FROM quotation_items
      WHERE quotation_id = p_quotation_id
        AND item_type = 'product'
        AND is_available
    ) THEN
      RAISE EXCEPTION 'Tidak ada produk yang ditawarkan di quotation ini, jadi tidak ada yang bisa disetujui.'
        USING ERRCODE = 'P0014';
    END IF;
    IF EXISTS (
      SELECT 1 FROM quotation_items
      WHERE quotation_id = p_quotation_id
        AND item_type = 'product'
        AND is_available
        AND (selling_price IS NULL OR selling_price <= 0)
    ) THEN
      RAISE EXCEPTION 'Quotation % masih memiliki baris produk tanpa harga jual.', p_quotation_id
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

  IF v_old_status = 'draft' THEN
    DELETE FROM quotation_edit_locks WHERE quotation_id = p_quotation_id;
  END IF;
  PERFORM fn_quotation_notify(p_quotation_id, 'status', NULL, p_user_id);
END;
$function$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_create_quotation(p_company_client_id bigint, p_contact_id bigint, p_client_ref_no text, p_vessel_name text, p_payment_terms text, p_validity_days integer, p_discount_pct numeric, p_shipping_address text, p_shipping_days integer, p_shipping_cost numeric, p_items jsonb, p_created_by bigint, p_notes text DEFAULT NULL::text, p_status text DEFAULT 'draft'::text, p_ppn_enabled boolean DEFAULT true)
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
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
  v_pct                 NUMERIC(5,2);
  v_line                NUMERIC(15,2);
  v_dpp                 NUMERIC(15,2) := 0;
  v_ppn                 NUMERIC(15,2) := 0;
BEGIN
  -- 1. Validation
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Quotation harus memiliki minimal satu baris.'
      USING ERRCODE = 'P0014';
  END IF;

  IF p_discount_pct < 0 OR p_discount_pct > 100 THEN
    RAISE EXCEPTION 'Diskon harus antara 0 dan 100. Nilai yang dikirim %.', p_discount_pct
      USING ERRCODE = 'P0014';
  END IF;

  -- Number first, before any lock.
  -- The counter row is then the first lock this transaction takes, so the
  -- line preparation (fn_link_vendor_item, trg_fn_sync_vendor_cost) never
  -- holds a row another creator needs while it waits for the counter. A
  -- refused quotation rolls the number back with it.
  v_quotation_no := fn_next_doc_no('Q');

  -- The pct the lines inherit, at column scale.
  v_pct := p_discount_pct;

  -- 2. Snapshot company_client_name + contact_name
  SELECT name INTO v_company_name
  FROM company_client WHERE id = p_company_client_id AND is_active = TRUE;

  IF v_company_name IS NULL THEN
    RAISE EXCEPTION 'Klien tidak ditemukan atau sudah nonaktif. Pilih klien lain.'
      USING ERRCODE = 'P0014';
  END IF;

  IF p_contact_id IS NOT NULL THEN
    SELECT name INTO v_contact_name
    FROM company_contacts
    WHERE id = p_contact_id AND company_id = p_company_client_id AND is_active = TRUE;

    IF v_contact_name IS NULL THEN
      RAISE EXCEPTION 'Narahubung tidak ditemukan, sudah nonaktif, atau bukan milik klien ini.'
        USING ERRCODE = 'P0014';
    END IF;
  END IF;

  -- Lines are prepared after the client checks, as fn_update_quotation
  -- prepares them after its row lock and status checks.
  p_items := fn_prepare_quotation_lines(p_items, p_created_by);

  -- 3. Pre-calculate totals. The discount is gross minus net per line, as
  -- quotation_items.subtotal and v_po_totals round them, so the header
  -- subtotal is the sum of the line subtotals. DPP and PPN are rounded per
  -- line and summed, as v_po_totals and fn_create_invoice do.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_item->>'qty')::NUMERIC(12,2);
    v_selling_price := (v_item->>'selling_price')::NUMERIC(15,2);
    v_line := ROUND(v_qty * v_selling_price * (1 - v_pct / 100), 2);

    v_total          := v_total + (v_qty * v_selling_price);
    v_total_produk   := v_total_produk + (v_qty * v_selling_price);
    v_total_discount := v_total_discount
                        + ROUND(v_qty * v_selling_price, 2)
                        - v_line;
    v_dpp            := v_dpp + fn_line_dpp(v_line);
    v_ppn            := v_ppn + fn_line_ppn(v_line);
  END LOOP;

  IF p_shipping_cost IS NOT NULL AND p_shipping_cost > 0 THEN
    v_total := v_total + p_shipping_cost;
    v_dpp   := v_dpp + fn_line_dpp(p_shipping_cost);
    v_ppn   := v_ppn + fn_line_ppn(p_shipping_cost);
  END IF;

  -- 5. INSERT header
  INSERT INTO quotations (
    quotation_no, version, company_client_id, company_client_name,
    contact_id, contact_name,
    client_ref_no, vessel_name, status,
    payment_terms, validity_days, discount_pct,
    total_produk, total, total_discount,
    dpp_nilai_lain, ppn_amount, grand_total,
    notes, created_by, updated_by, ppn_enabled
  ) VALUES (
    v_quotation_no, 1, p_company_client_id, v_company_name,
    p_contact_id, v_contact_name,
    p_client_ref_no, p_vessel_name, p_status,
    p_payment_terms, p_validity_days, p_discount_pct,
    v_total_produk, v_total, v_total_discount,
    v_dpp, v_ppn, v_total - v_total_discount + v_ppn,
    p_notes, p_created_by, p_created_by, p_ppn_enabled
  ) RETURNING id INTO v_quotation_id;

  -- 6. INSERT product items
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

  -- 7. INSERT shipping line
  IF NULLIF(TRIM(p_shipping_address), '') IS NOT NULL OR COALESCE(p_shipping_cost, 0) > 0
     OR p_shipping_days IS NOT NULL THEN
    v_line_no := v_line_no + 1;
    INSERT INTO quotation_items (
      quotation_id, line_number, item_type,
      requested_name,
      qty, unit_id, selling_price,
      ship_destination, shipping_days,
      created_by, updated_by
    ) VALUES (
      v_quotation_id,
      v_line_no,
      'shipping',
      'SHIPPING' || COALESCE(' - ' || p_shipping_address, ''),
      1,
      (SELECT id FROM units WHERE code = 'UNIT' LIMIT 1),
      COALESCE(p_shipping_cost, 0),
      p_shipping_address,
      p_shipping_days,
      p_created_by, p_created_by
    );
  END IF;

  PERFORM fn_recompute_quotation_totals(v_quotation_id);

  RETURN v_quotation_id;
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
  v_company_id   BIGINT;
  v_contact_id   BIGINT;
  v_ppn_on       BOOLEAN;
BEGIN
  SELECT id INTO v_po_id FROM purchase_orders WHERE quotation_id = p_quotation_id;
  IF v_po_id IS NOT NULL THEN
    RETURN v_po_id;
  END IF;

  SELECT company_client_id, contact_id, ppn_enabled
  INTO v_company_id, v_contact_id, v_ppn_on
  FROM quotations WHERE id = p_quotation_id;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Quotation tidak ditemukan. Muat ulang halaman.'
      USING ERRCODE = 'P0011';
  END IF;

  -- po_number is the client's own, entered later.
  INSERT INTO purchase_orders (
    quotation_id, company_client_id, contact_id,
    po_date, status, created_by, updated_by, ppn_enabled
  ) VALUES (
    p_quotation_id, v_company_id, v_contact_id,
    CURRENT_DATE, 'PENDING', p_user_id, p_user_id, v_ppn_on
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
$function$;
-- +goose StatementEnd

DROP FUNCTION IF EXISTS public.fn_freeze_quotation_offer(bigint);
ALTER TABLE quotation_items
  DROP COLUMN IF EXISTS offered_impa,
  DROP COLUMN IF EXISTS offered_name;
