-- +goose Up

-- 00077 QUOTATION LINE AUTOFILL
-- Three pieces so a quotation line fills itself and a draft may stay
-- unfinished until it is sent.
--
-- fn_recommend_lines picks, per catalog item and client, the vendor and the
-- prices a new line starts from. Only quotations a client was sent or
-- accepted count as a deal; drafts and rejected offers do not.
--   Vendor: the one on this client's newest deal for the item while that
--   vendor and its link are still active, else the cheapest active link.
--   Harga beli: that link's current cost_price.
--   Harga jual: this client's newest deal price, else any client's newest
--   deal price, else NULL (set by hand).
--
-- fn_prepare_quotation_lines runs on the lines before fn_create_quotation
-- or fn_update_quotation stores them, in the same statement:
--   A line marked is_available = false is a request the company cannot
--   offer (Tidak Ditawarkan). Its harga jual becomes 0 and it carries no
--   vendor or harga beli, whatever the caller sent.
--   A line naming vendor_id without vendor_product_id gets that item-vendor
--   link, created or reactivated, so a vendor the item was never linked to
--   can still be picked. vendor_id itself is dropped.
--
-- fn_change_quotation_status refuses sending while any offered product
-- line lacks its product, unit, vendor, harga beli or harga jual (P0014 with
-- the count). Accepting keeps the harga jual guard (P0100) for offered lines
-- and needs at least one of them.
--
-- fn_create_purchase_order leaves Tidak Ditawarkan lines out of the PO: the
-- client cannot order what was never offered.

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION fn_recommend_lines(p_client_id BIGINT, p_item_ids BIGINT[])
RETURNS TABLE (
  item_id           BIGINT,
  vendor_product_id BIGINT,
  vendor_id         BIGINT,
  vendor_name       VARCHAR,
  cost_price        NUMERIC,
  selling_price     NUMERIC
)
LANGUAGE sql
STABLE
AS $$
  WITH deals AS (
    SELECT qi.id AS line_id, qi.offered_item_id AS item_id, q.company_client_id,
           qi.vendor_product_id, qi.selling_price, q.created_at
    FROM quotation_items qi
    JOIN quotations q ON q.id = qi.quotation_id
    WHERE qi.item_type = 'product'
      AND qi.offered_item_id = ANY(p_item_ids)
      AND q.status IN ('sent', 'accepted')
  )
  SELECT i.id, vp.id, v.id, v.name, vp.cost_price,
         COALESCE(own_price.selling_price, any_price.selling_price)
  FROM items i
  LEFT JOIN LATERAL (
    SELECT d.selling_price FROM deals d
    WHERE d.item_id = i.id AND d.company_client_id = p_client_id AND d.selling_price > 0
    ORDER BY d.created_at DESC, d.line_id DESC
    LIMIT 1
  ) own_price ON TRUE
  LEFT JOIN LATERAL (
    SELECT d.selling_price FROM deals d
    WHERE d.item_id = i.id AND d.selling_price > 0
    ORDER BY d.created_at DESC, d.line_id DESC
    LIMIT 1
  ) any_price ON TRUE
  LEFT JOIN LATERAL (
    SELECT ov.id FROM deals d
    JOIN vendor_products ov ON ov.id = d.vendor_product_id AND ov.is_active
    JOIN vendors ovv ON ovv.id = ov.vendor_id AND ovv.is_active
    WHERE d.item_id = i.id AND d.company_client_id = p_client_id
    ORDER BY d.created_at DESC, d.line_id DESC
    LIMIT 1
  ) own_vendor ON TRUE
  LEFT JOIN LATERAL (
    SELECT cv.id FROM vendor_products cv
    JOIN vendors cvv ON cvv.id = cv.vendor_id AND cvv.is_active
    WHERE cv.item_id = i.id AND cv.is_active
    ORDER BY cv.cost_price ASC NULLS LAST, cv.id ASC
    LIMIT 1
  ) cheapest ON TRUE
  LEFT JOIN vendor_products vp ON vp.id = COALESCE(own_vendor.id, cheapest.id)
  LEFT JOIN vendors v ON v.id = vp.vendor_id
  WHERE i.id = ANY(p_item_ids) AND i.is_active
  ORDER BY i.id;
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION fn_prepare_quotation_lines(p_items JSONB, p_user_id BIGINT)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
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
             updated_by = EXCLUDED.updated_by,
             updated_at = NOW()
      RETURNING id INTO v_link;
      v_item := jsonb_set(v_item, '{vendor_product_id}', to_jsonb(v_link));
    END IF;
    v_out := v_out || jsonb_build_array(v_item - 'vendor_id');
  END LOOP;
  RETURN v_out;
END;
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_change_quotation_status(p_quotation_id bigint, p_new_status text, p_user_id bigint, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_old_status VARCHAR(20);
  v_valid      BOOLEAN;
  v_incomplete INTEGER;
BEGIN
  SELECT status INTO v_old_status
  FROM quotations
  WHERE id = p_quotation_id
  FOR UPDATE;

  IF v_old_status IS NULL THEN
    RAISE EXCEPTION 'Quotation % tidak ditemukan.', p_quotation_id
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
    IF p_new_status = 'expired' THEN
      RAISE EXCEPTION 'Status Kedaluwarsa diberikan otomatis setelah masa berlaku quotation habis.'
        USING ERRCODE = 'P0012';
    END IF;
    RAISE EXCEPTION 'Status quotation tidak dapat diubah dari % ke %.',
      fn_quotation_status_label(v_old_status), fn_quotation_status_label(p_new_status)
      USING ERRCODE = 'P0012';
  END IF;

  IF p_new_status IN ('rejected','cancelled') AND NULLIF(BTRIM(p_note), '') IS NULL THEN
    RAISE EXCEPTION 'Alasan wajib diisi untuk mengubah status menjadi %.',
      fn_quotation_status_label(p_new_status)
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


-- +goose Down

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_change_quotation_status(p_quotation_id bigint, p_new_status text, p_user_id bigint, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_old_status VARCHAR(20);
  v_valid      BOOLEAN;
BEGIN
  SELECT status INTO v_old_status
  FROM quotations
  WHERE id = p_quotation_id
  FOR UPDATE;

  IF v_old_status IS NULL THEN
    RAISE EXCEPTION 'Quotation % tidak ditemukan.', p_quotation_id
      USING ERRCODE = 'P0011';
  END IF;

  IF v_old_status = p_new_status THEN
    RETURN;
  END IF;

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
    IF p_new_status = 'expired' THEN
      RAISE EXCEPTION 'Status Kedaluwarsa diberikan otomatis setelah masa berlaku quotation habis.'
        USING ERRCODE = 'P0012';
    END IF;
    RAISE EXCEPTION 'Status quotation tidak dapat diubah dari % ke %.',
      fn_quotation_status_label(v_old_status), fn_quotation_status_label(p_new_status)
      USING ERRCODE = 'P0012';
  END IF;

  IF p_new_status IN ('rejected','cancelled') AND NULLIF(BTRIM(p_note), '') IS NULL THEN
    RAISE EXCEPTION 'Alasan wajib diisi untuk mengubah status menjadi %.',
      fn_quotation_status_label(p_new_status)
      USING ERRCODE = 'P0014';
  END IF;

  IF p_new_status IN ('sent','accepted') THEN
    IF EXISTS (
      SELECT 1 FROM quotation_items
      WHERE quotation_id = p_quotation_id
        AND item_type = 'product'
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
  ORDER BY qi.line_number;

  RETURN v_po_id;
END;
$function$;
-- +goose StatementEnd

DROP FUNCTION IF EXISTS fn_prepare_quotation_lines(JSONB, BIGINT);
DROP FUNCTION IF EXISTS fn_recommend_lines(BIGINT, BIGINT[]);
