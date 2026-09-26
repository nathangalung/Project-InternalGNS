-- +goose Up

-- 00063 QUOTATION EDIT CONFLICT AND CLONE LEARNING
-- 1. fn_update_quotation refused a non-draft with an untyped English P0001,
--    which the API rendered as 422 with text the UI could not show. The
--    refusal is now P0013 (409) in Indonesian, like the request lock, and a
--    missing id is P0011 (404) on the legacy unversioned path too.
-- 2. fn_revise_quotation copies every line into the new draft, and each copy
--    fired trg_learn_match: the request text counted as a fresh match and its
--    mapping reverted to whatever the original held, undoing any newer
--    mapping. The clone now switches learning off for its own INSERT through
--    the transaction-local setting gns.learn_match and restores it right
--    after, so later saves in the same transaction still learn. Existing
--    counts are not recomputed: past clone inflation cannot be told apart
--    from real reuse.

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.trg_fn_learn_match()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  -- A revision clone is not new evidence.
  IF current_setting('gns.learn_match', true) = 'off' THEN
    RETURN NEW;
  END IF;

  IF NEW.requested_item_id IS NOT NULL
     AND NEW.requested_name IS NOT NULL
     AND TRIM(NEW.requested_name) != '' THEN

    INSERT INTO item_request_matches
      (request_text, matched_item_id, match_count, last_used_at)
    VALUES
      (NEW.requested_name, NEW.requested_item_id, 1, NOW())
    ON CONFLICT (LOWER(TRIM(request_text)))
    DO UPDATE SET
      match_count     = item_request_matches.match_count + 1,
      last_used_at    = NOW(),
      matched_item_id = EXCLUDED.matched_item_id;

  END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION trg_fn_learn_match() IS
  'On each quotation_item INSERT with requested_item_id set, upserts item_request_matches (increments match_count via unique idx on LOWER(TRIM(request_text))). Skipped while the transaction-local setting gns.learn_match is off, which fn_revise_quotation sets around its line copy.';
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
    RAISE EXCEPTION 'Quotation % tidak ditemukan.', p_quotation_id
      USING ERRCODE = 'P0011';
  END IF;

  IF v_orig.status <> 'sent' THEN
    RAISE EXCEPTION 'Hanya quotation berstatus Dikirim yang dapat direvisi; status saat ini %.',
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
    created_by, updated_by
  ) VALUES (
    v_new_no, v_orig.version + 1, v_orig.id,
    v_orig.company_client_id, v_orig.company_client_name, v_orig.contact_id, v_orig.contact_name,
    v_orig.client_ref_no, v_orig.vessel_name, 'draft', v_orig.notes,
    v_orig.payment_terms, v_orig.validity_days, v_orig.discount_pct,
    v_orig.total_produk, v_orig.total, v_orig.total_discount,
    p_user_id, p_user_id
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

  -- 2. Validation
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Quotation must have at least 1 item';
  END IF;

  IF p_discount_pct < 0 OR p_discount_pct > 100 THEN
    RAISE EXCEPTION 'discount_pct must be 0..100, got %', p_discount_pct;
  END IF;

  -- 3. Pre-calculate totals
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_item->>'qty')::NUMERIC(12,2);
    v_selling_price := (v_item->>'selling_price')::NUMERIC(15,2);
    v_total        := v_total + (v_qty * v_selling_price);
    v_total_produk := v_total_produk + (v_qty * v_selling_price);
    v_total_disc   := v_total_disc + (v_qty * v_selling_price * (p_discount_pct / 100));
  END LOOP;

  IF p_shipping_cost IS NOT NULL AND p_shipping_cost > 0 THEN
    v_total := v_total + p_shipping_cost;
  END IF;

  -- 4. DELETE existing items.
  -- PO/invoice referencing items will be set NULL via FK ON DELETE SET NULL.
  -- Since status='draft', there are usually no PO/invoice yet — safe.
  DELETE FROM quotation_items WHERE quotation_id = p_id;

  -- 5. UPDATE header.
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
      notes          = p_notes,
      updated_by     = p_user_id
  WHERE id = p_id;

  -- 6. INSERT product items (trigger inherit discount_pct fires BEFORE INSERT)
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

  -- 7. INSERT shipping line (if present)
  IF p_shipping_cost IS NOT NULL AND p_shipping_cost > 0 THEN
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
      p_shipping_cost,
      p_shipping_address,
      p_shipping_days,
      p_user_id, p_user_id
    );
  END IF;

  RETURN p_id;
END;
$function$;
-- +goose StatementEnd

-- +goose Down

-- Down restores the 00059, 00036 and 00003 bodies.

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
BEGIN
  -- 1. Lock + verify status='draft'
  SELECT status INTO v_status
  FROM quotations
  WHERE id = p_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Quotation % not found', p_id;
  END IF;

  IF v_status != 'draft' THEN
    RAISE EXCEPTION 'Cannot edit quotation % — status is "%". Only draft can be edited; create revision via clone instead.', p_id, v_status;
  END IF;

  -- 2. Validation
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Quotation must have at least 1 item';
  END IF;

  IF p_discount_pct < 0 OR p_discount_pct > 100 THEN
    RAISE EXCEPTION 'discount_pct must be 0..100, got %', p_discount_pct;
  END IF;

  -- 3. Pre-calculate totals
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_item->>'qty')::NUMERIC(12,2);
    v_selling_price := (v_item->>'selling_price')::NUMERIC(15,2);
    v_total        := v_total + (v_qty * v_selling_price);
    v_total_produk := v_total_produk + (v_qty * v_selling_price);
    v_total_disc   := v_total_disc + (v_qty * v_selling_price * (p_discount_pct / 100));
  END LOOP;

  IF p_shipping_cost IS NOT NULL AND p_shipping_cost > 0 THEN
    v_total := v_total + p_shipping_cost;
  END IF;

  -- 4. DELETE existing items.
  -- PO/invoice referencing items will be set NULL via FK ON DELETE SET NULL.
  -- Since status='draft', there are usually no PO/invoice yet — safe.
  DELETE FROM quotation_items WHERE quotation_id = p_id;

  -- 5. UPDATE header.
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
      notes          = p_notes,
      updated_by     = p_user_id
  WHERE id = p_id;

  -- 6. INSERT product items (trigger inherit discount_pct fires BEFORE INSERT)
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

  -- 7. INSERT shipping line (if present)
  IF p_shipping_cost IS NOT NULL AND p_shipping_cost > 0 THEN
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
      p_shipping_cost,
      p_shipping_address,
      p_shipping_days,
      p_user_id, p_user_id
    );
  END IF;

  RETURN p_id;
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
BEGIN
  SELECT * INTO v_orig
  FROM quotations
  WHERE id = p_quotation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quotation % tidak ditemukan.', p_quotation_id
      USING ERRCODE = 'P0011';
  END IF;

  IF v_orig.status <> 'sent' THEN
    RAISE EXCEPTION 'Hanya quotation berstatus Dikirim yang dapat direvisi; status saat ini %.',
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
    created_by, updated_by
  ) VALUES (
    v_new_no, v_orig.version + 1, v_orig.id,
    v_orig.company_client_id, v_orig.company_client_name, v_orig.contact_id, v_orig.contact_name,
    v_orig.client_ref_no, v_orig.vessel_name, 'draft', v_orig.notes,
    v_orig.payment_terms, v_orig.validity_days, v_orig.discount_pct,
    v_orig.total_produk, v_orig.total, v_orig.total_discount,
    p_user_id, p_user_id
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

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.trg_fn_learn_match()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.requested_item_id IS NOT NULL
     AND NEW.requested_name IS NOT NULL
     AND TRIM(NEW.requested_name) != '' THEN

    INSERT INTO item_request_matches
      (request_text, matched_item_id, match_count, last_used_at)
    VALUES
      (NEW.requested_name, NEW.requested_item_id, 1, NOW())
    ON CONFLICT (LOWER(TRIM(request_text)))
    DO UPDATE SET
      match_count     = item_request_matches.match_count + 1,
      last_used_at    = NOW(),
      matched_item_id = EXCLUDED.matched_item_id;

  END IF;
  RETURN NEW;
END;
$function$;

COMMENT ON FUNCTION trg_fn_learn_match() IS
  'On each quotation_item INSERT with requested_item_id set, upserts item_request_matches (increments match_count via unique idx on LOWER(TRIM(request_text))).';
-- +goose StatementEnd
