-- Canonical current body of fn_update_quotation (deployed by migration 00092).
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
