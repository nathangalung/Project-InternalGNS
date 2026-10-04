-- +goose Up
-- 00092 QUOTATION SEND AND SAVE ORDER
-- fn_change_quotation_status refuses to send a quotation with no
-- validity_days: fn_expire_quotations skips such a row, so it would stay
-- Dikirim for good and print a blank Validity. A draft without one can
-- still be cancelled.
-- fn_create_quotation and fn_update_quotation prepare their own lines
-- (fn_prepare_quotation_lines) after the client, status and editor
-- checks. The query wrappers used to prepare them first, so a full save
-- linked vendors (a vendor_products row lock) before taking the quotation
-- row, the reverse of the live line saves, and could deadlock with one; a
-- save of a non-draft also answered with a vendor error.

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

  -- Leaving the draft ends every edit; wait for the other editors.
  IF v_old_status = 'draft' THEN
    PERFORM fn_quotation_no_other_editors(p_quotation_id, p_user_id);
  END IF;

  IF p_new_status IN ('rejected','cancelled') AND NULLIF(BTRIM(p_note), '') IS NULL THEN
    RAISE EXCEPTION 'Alasan wajib diisi untuk mengubah status menjadi %.',
      fn_quotation_status_label(p_new_status)
      USING ERRCODE = 'P0014';
  END IF;

  -- What is sent must expire, so it needs a validity window.
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
$function$
;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_create_quotation(p_company_client_id bigint, p_contact_id bigint, p_client_ref_no text, p_vessel_name text, p_payment_terms text, p_validity_days integer, p_discount_pct numeric, p_shipping_address text, p_shipping_days integer, p_shipping_cost numeric, p_items jsonb, p_created_by bigint, p_notes text DEFAULT NULL::text, p_status text DEFAULT 'draft'::text)
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
    RAISE EXCEPTION 'Diskon harus antara 0 dan 100; nilai yang dikirim %.', p_discount_pct
      USING ERRCODE = 'P0014';
  END IF;

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

  -- 4. Generate quotation_no
  v_quotation_no := fn_next_doc_no('Q', p_company_client_id);

  -- 5. INSERT header
  INSERT INTO quotations (
    quotation_no, version, company_client_id, company_client_name,
    contact_id, contact_name,
    client_ref_no, vessel_name, status,
    payment_terms, validity_days, discount_pct,
    total_produk, total, total_discount,
    dpp_nilai_lain, ppn_amount, grand_total,
    notes, created_by, updated_by
  ) VALUES (
    v_quotation_no, 1, p_company_client_id, v_company_name,
    p_contact_id, v_contact_name,
    p_client_ref_no, p_vessel_name, p_status,
    p_payment_terms, p_validity_days, p_discount_pct,
    v_total_produk, v_total, v_total_discount,
    v_dpp, v_ppn, v_total - v_total_discount + v_ppn,
    p_notes, p_created_by, p_created_by
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
      'SHIPPING' || COALESCE(' — ' || p_shipping_address, ''),
      1,
      (SELECT id FROM units WHERE code = 'UNIT' LIMIT 1),
      COALESCE(p_shipping_cost, 0),
      p_shipping_address,
      p_shipping_days,
      p_created_by, p_created_by
    );
  END IF;

  RETURN v_quotation_id;
END;
$function$
;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_update_quotation(p_id bigint, p_client_ref_no text, p_vessel_name text, p_payment_terms text, p_validity_days integer, p_discount_pct numeric, p_shipping_address text, p_shipping_days integer, p_shipping_cost numeric, p_items jsonb, p_user_id bigint, p_notes text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_status        VARCHAR(20);
  v_item          JSONB;
  v_line_no       SMALLINT := 0;
  v_total_produk  NUMERIC(15,2) := 0;
  v_total         NUMERIC(15,2) := 0;
  v_total_disc    NUMERIC(15,2) := 0;
  v_qty           NUMERIC(12,2);
  v_selling_price NUMERIC(15,2);
  v_learn         TEXT;
  v_known         JSONB;
  v_key           TEXT;
  v_left          INT;
  v_pct           NUMERIC(5,2);
  v_line          NUMERIC(15,2);
  v_dpp           NUMERIC(15,2) := 0;
  v_ppn           NUMERIC(15,2) := 0;
BEGIN
  -- 1. Lock + verify status='draft'
  SELECT status INTO v_status
  FROM quotations
  WHERE id = p_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Quotation % tidak ditemukan.', p_id
      USING ERRCODE = 'P0011';
  END IF;

  IF v_status != 'draft' THEN
    RAISE EXCEPTION 'Hanya quotation berstatus Draf yang dapat diubah; status saat ini %.',
      fn_quotation_status_label(v_status)
      USING ERRCODE = 'P0013';
  END IF;

  -- A whole save rewrites every line, so nobody else may be mid-edit.
  PERFORM fn_quotation_no_other_editors(p_id, p_user_id);

  -- 2. Validation
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Quotation harus memiliki minimal satu baris.'
      USING ERRCODE = 'P0014';
  END IF;

  IF p_discount_pct < 0 OR p_discount_pct > 100 THEN
    RAISE EXCEPTION 'Diskon harus antara 0 dan 100; nilai yang dikirim %.', p_discount_pct
      USING ERRCODE = 'P0014';
  END IF;

  -- Lines are prepared under the row lock, after the status checks, as
  -- the live saves do: fn_link_vendor_item locks vendor_products, so the
  -- quotation row is always taken first.
  p_items := fn_prepare_quotation_lines(p_items, p_user_id);

  -- 3. Pre-calculate totals. The discount is gross minus net per line at
  -- the pct the lines inherit, as quotation_items.subtotal and v_po_totals
  -- round them, so the header subtotal is the sum of the line subtotals.
  -- DPP and PPN are rounded per line and summed, as v_po_totals and
  -- fn_create_invoice do.
  v_pct := p_discount_pct;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_item->>'qty')::NUMERIC(12,2);
    v_selling_price := (v_item->>'selling_price')::NUMERIC(15,2);
    v_line         := ROUND(v_qty * v_selling_price * (1 - v_pct / 100), 2);
    v_total        := v_total + (v_qty * v_selling_price);
    v_total_produk := v_total_produk + (v_qty * v_selling_price);
    v_total_disc   := v_total_disc
                      + ROUND(v_qty * v_selling_price, 2)
                      - v_line;
    v_dpp          := v_dpp + fn_line_dpp(v_line);
    v_ppn          := v_ppn + fn_line_ppn(v_line);
  END LOOP;

  IF p_shipping_cost IS NOT NULL AND p_shipping_cost > 0 THEN
    v_total := v_total + p_shipping_cost;
    v_dpp   := v_dpp + fn_line_dpp(p_shipping_cost);
    v_ppn   := v_ppn + fn_line_ppn(p_shipping_cost);
  END IF;

  -- 4. Count the matches already learned, keyed like trg_learn_match
  -- (item id, then LOWER(TRIM(request text))), so a re-saved line is not
  -- counted again.
  SELECT COALESCE(jsonb_object_agg(k, n), '{}'::jsonb) INTO v_known
  FROM (
    SELECT requested_item_id::TEXT || ':' || LOWER(TRIM(requested_name)) AS k,
           COUNT(*) AS n
    FROM quotation_items
    WHERE quotation_id = p_id
      AND requested_item_id IS NOT NULL
      AND requested_name IS NOT NULL
      AND TRIM(requested_name) != ''
    GROUP BY 1
  ) s;

  -- 5. DELETE existing items.
  -- PO/invoice referencing items will be set NULL via FK ON DELETE SET NULL.
  -- Since status='draft', there are usually no PO/invoice yet — safe.
  DELETE FROM quotation_items WHERE quotation_id = p_id;

  -- 6. UPDATE header.
  -- discount_pct UPDATE bypasses trg_protect_quotation_discount because
  -- status='draft' (trigger only blocks when status != 'draft').
  -- trg_cascade_quotation_discount will fire but affect 0 rows
  -- (items already deleted).
  UPDATE quotations
  SET client_ref_no  = p_client_ref_no,
      vessel_name    = p_vessel_name,
      payment_terms  = p_payment_terms,
      validity_days  = p_validity_days,
      discount_pct   = p_discount_pct,
      total_produk   = v_total_produk,
      total          = v_total,
      total_discount = v_total_disc,
      dpp_nilai_lain = v_dpp,
      ppn_amount     = v_ppn,
      grand_total    = v_total - v_total_disc + v_ppn,
      notes          = p_notes,
      updated_by     = p_user_id
  WHERE id = p_id;

  -- 7. INSERT product items (trigger inherit discount_pct fires BEFORE INSERT).
  -- Each line whose match was already on the draft uses up one known
  -- occurrence and skips trg_learn_match; the rest learn as on create.
  v_learn := current_setting('gns.learn_match', true);
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_line_no := v_line_no + 1;
    v_key := (NULLIF((v_item->>'requested_item_id'),'')::BIGINT)::TEXT
             || ':' || LOWER(TRIM(v_item->>'requested_name'));
    v_left := COALESCE((v_known->>v_key)::INT, 0);
    IF v_left > 0 THEN
      v_known := jsonb_set(v_known, ARRAY[v_key], to_jsonb(v_left - 1));
      PERFORM set_config('gns.learn_match', 'off', true);
    ELSE
      PERFORM set_config('gns.learn_match', COALESCE(v_learn, ''), true);
    END IF;

    INSERT INTO quotation_items (
      quotation_id, line_number, item_type,
      requested_item_id, requested_impa, requested_name,
      offered_item_id, vendor_product_id,
      qty, unit_id, selling_price, cost_price,
      is_available, ship_destination, due_date,
      update_vendor_price, created_by, updated_by
    ) VALUES (
      p_id,
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
      p_user_id, p_user_id
    );
  END LOOP;
  PERFORM set_config('gns.learn_match', COALESCE(v_learn, ''), true);

  -- 8. INSERT shipping line (if present)
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
      p_id,
      v_line_no,
      'shipping',
      'SHIPPING' || COALESCE(' — ' || p_shipping_address, ''),
      1,
      (SELECT id FROM units WHERE code = 'UNIT' LIMIT 1),
      COALESCE(p_shipping_cost, 0),
      p_shipping_address,
      p_shipping_days,
      p_user_id, p_user_id
    );
  END IF;

  -- Line ids changed: line locks point at lines that are gone.
  DELETE FROM quotation_edit_locks WHERE quotation_id = p_id AND part <> 'header';
  PERFORM fn_quotation_notify(p_id, 'lines', NULL, p_user_id);

  RETURN p_id;
END;
$function$
;
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

  -- Leaving the draft ends every edit; wait for the other editors.
  IF v_old_status = 'draft' THEN
    PERFORM fn_quotation_no_other_editors(p_quotation_id, p_user_id);
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

  IF v_old_status = 'draft' THEN
    DELETE FROM quotation_edit_locks WHERE quotation_id = p_quotation_id;
  END IF;
  PERFORM fn_quotation_notify(p_quotation_id, 'status', NULL, p_user_id);
END;
$function$
;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_create_quotation(p_company_client_id bigint, p_contact_id bigint, p_client_ref_no text, p_vessel_name text, p_payment_terms text, p_validity_days integer, p_discount_pct numeric, p_shipping_address text, p_shipping_days integer, p_shipping_cost numeric, p_items jsonb, p_created_by bigint, p_notes text DEFAULT NULL::text, p_status text DEFAULT 'draft'::text)
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
    RAISE EXCEPTION 'Diskon harus antara 0 dan 100; nilai yang dikirim %.', p_discount_pct
      USING ERRCODE = 'P0014';
  END IF;

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

  -- 4. Generate quotation_no
  v_quotation_no := fn_next_doc_no('Q', p_company_client_id);

  -- 5. INSERT header
  INSERT INTO quotations (
    quotation_no, version, company_client_id, company_client_name,
    contact_id, contact_name,
    client_ref_no, vessel_name, status,
    payment_terms, validity_days, discount_pct,
    total_produk, total, total_discount,
    dpp_nilai_lain, ppn_amount, grand_total,
    notes, created_by, updated_by
  ) VALUES (
    v_quotation_no, 1, p_company_client_id, v_company_name,
    p_contact_id, v_contact_name,
    p_client_ref_no, p_vessel_name, p_status,
    p_payment_terms, p_validity_days, p_discount_pct,
    v_total_produk, v_total, v_total_discount,
    v_dpp, v_ppn, v_total - v_total_discount + v_ppn,
    p_notes, p_created_by, p_created_by
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
      'SHIPPING' || COALESCE(' — ' || p_shipping_address, ''),
      1,
      (SELECT id FROM units WHERE code = 'UNIT' LIMIT 1),
      COALESCE(p_shipping_cost, 0),
      p_shipping_address,
      p_shipping_days,
      p_created_by, p_created_by
    );
  END IF;

  RETURN v_quotation_id;
END;
$function$
;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_update_quotation(p_id bigint, p_client_ref_no text, p_vessel_name text, p_payment_terms text, p_validity_days integer, p_discount_pct numeric, p_shipping_address text, p_shipping_days integer, p_shipping_cost numeric, p_items jsonb, p_user_id bigint, p_notes text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_status        VARCHAR(20);
  v_item          JSONB;
  v_line_no       SMALLINT := 0;
  v_total_produk  NUMERIC(15,2) := 0;
  v_total         NUMERIC(15,2) := 0;
  v_total_disc    NUMERIC(15,2) := 0;
  v_qty           NUMERIC(12,2);
  v_selling_price NUMERIC(15,2);
  v_learn         TEXT;
  v_known         JSONB;
  v_key           TEXT;
  v_left          INT;
  v_pct           NUMERIC(5,2);
  v_line          NUMERIC(15,2);
  v_dpp           NUMERIC(15,2) := 0;
  v_ppn           NUMERIC(15,2) := 0;
BEGIN
  -- 1. Lock + verify status='draft'
  SELECT status INTO v_status
  FROM quotations
  WHERE id = p_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Quotation % tidak ditemukan.', p_id
      USING ERRCODE = 'P0011';
  END IF;

  IF v_status != 'draft' THEN
    RAISE EXCEPTION 'Hanya quotation berstatus Draf yang dapat diubah; status saat ini %.',
      fn_quotation_status_label(v_status)
      USING ERRCODE = 'P0013';
  END IF;

  -- A whole save rewrites every line, so nobody else may be mid-edit.
  PERFORM fn_quotation_no_other_editors(p_id, p_user_id);

  -- 2. Validation
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Quotation harus memiliki minimal satu baris.'
      USING ERRCODE = 'P0014';
  END IF;

  IF p_discount_pct < 0 OR p_discount_pct > 100 THEN
    RAISE EXCEPTION 'Diskon harus antara 0 dan 100; nilai yang dikirim %.', p_discount_pct
      USING ERRCODE = 'P0014';
  END IF;

  -- 3. Pre-calculate totals. The discount is gross minus net per line at
  -- the pct the lines inherit, as quotation_items.subtotal and v_po_totals
  -- round them, so the header subtotal is the sum of the line subtotals.
  -- DPP and PPN are rounded per line and summed, as v_po_totals and
  -- fn_create_invoice do.
  v_pct := p_discount_pct;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_item->>'qty')::NUMERIC(12,2);
    v_selling_price := (v_item->>'selling_price')::NUMERIC(15,2);
    v_line         := ROUND(v_qty * v_selling_price * (1 - v_pct / 100), 2);
    v_total        := v_total + (v_qty * v_selling_price);
    v_total_produk := v_total_produk + (v_qty * v_selling_price);
    v_total_disc   := v_total_disc
                      + ROUND(v_qty * v_selling_price, 2)
                      - v_line;
    v_dpp          := v_dpp + fn_line_dpp(v_line);
    v_ppn          := v_ppn + fn_line_ppn(v_line);
  END LOOP;

  IF p_shipping_cost IS NOT NULL AND p_shipping_cost > 0 THEN
    v_total := v_total + p_shipping_cost;
    v_dpp   := v_dpp + fn_line_dpp(p_shipping_cost);
    v_ppn   := v_ppn + fn_line_ppn(p_shipping_cost);
  END IF;

  -- 4. Count the matches already learned, keyed like trg_learn_match
  -- (item id, then LOWER(TRIM(request text))), so a re-saved line is not
  -- counted again.
  SELECT COALESCE(jsonb_object_agg(k, n), '{}'::jsonb) INTO v_known
  FROM (
    SELECT requested_item_id::TEXT || ':' || LOWER(TRIM(requested_name)) AS k,
           COUNT(*) AS n
    FROM quotation_items
    WHERE quotation_id = p_id
      AND requested_item_id IS NOT NULL
      AND requested_name IS NOT NULL
      AND TRIM(requested_name) != ''
    GROUP BY 1
  ) s;

  -- 5. DELETE existing items.
  -- PO/invoice referencing items will be set NULL via FK ON DELETE SET NULL.
  -- Since status='draft', there are usually no PO/invoice yet — safe.
  DELETE FROM quotation_items WHERE quotation_id = p_id;

  -- 6. UPDATE header.
  -- discount_pct UPDATE bypasses trg_protect_quotation_discount because
  -- status='draft' (trigger only blocks when status != 'draft').
  -- trg_cascade_quotation_discount will fire but affect 0 rows
  -- (items already deleted).
  UPDATE quotations
  SET client_ref_no  = p_client_ref_no,
      vessel_name    = p_vessel_name,
      payment_terms  = p_payment_terms,
      validity_days  = p_validity_days,
      discount_pct   = p_discount_pct,
      total_produk   = v_total_produk,
      total          = v_total,
      total_discount = v_total_disc,
      dpp_nilai_lain = v_dpp,
      ppn_amount     = v_ppn,
      grand_total    = v_total - v_total_disc + v_ppn,
      notes          = p_notes,
      updated_by     = p_user_id
  WHERE id = p_id;

  -- 7. INSERT product items (trigger inherit discount_pct fires BEFORE INSERT).
  -- Each line whose match was already on the draft uses up one known
  -- occurrence and skips trg_learn_match; the rest learn as on create.
  v_learn := current_setting('gns.learn_match', true);
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_line_no := v_line_no + 1;
    v_key := (NULLIF((v_item->>'requested_item_id'),'')::BIGINT)::TEXT
             || ':' || LOWER(TRIM(v_item->>'requested_name'));
    v_left := COALESCE((v_known->>v_key)::INT, 0);
    IF v_left > 0 THEN
      v_known := jsonb_set(v_known, ARRAY[v_key], to_jsonb(v_left - 1));
      PERFORM set_config('gns.learn_match', 'off', true);
    ELSE
      PERFORM set_config('gns.learn_match', COALESCE(v_learn, ''), true);
    END IF;

    INSERT INTO quotation_items (
      quotation_id, line_number, item_type,
      requested_item_id, requested_impa, requested_name,
      offered_item_id, vendor_product_id,
      qty, unit_id, selling_price, cost_price,
      is_available, ship_destination, due_date,
      update_vendor_price, created_by, updated_by
    ) VALUES (
      p_id,
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
      p_user_id, p_user_id
    );
  END LOOP;
  PERFORM set_config('gns.learn_match', COALESCE(v_learn, ''), true);

  -- 8. INSERT shipping line (if present)
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
      p_id,
      v_line_no,
      'shipping',
      'SHIPPING' || COALESCE(' — ' || p_shipping_address, ''),
      1,
      (SELECT id FROM units WHERE code = 'UNIT' LIMIT 1),
      COALESCE(p_shipping_cost, 0),
      p_shipping_address,
      p_shipping_days,
      p_user_id, p_user_id
    );
  END IF;

  -- Line ids changed: line locks point at lines that are gone.
  DELETE FROM quotation_edit_locks WHERE quotation_id = p_id AND part <> 'header';
  PERFORM fn_quotation_notify(p_id, 'lines', NULL, p_user_id);

  RETURN p_id;
END;
$function$
;
-- +goose StatementEnd
