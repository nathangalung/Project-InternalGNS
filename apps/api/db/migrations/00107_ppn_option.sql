-- +goose Up
-- 00107 PPN OPTION
-- A quotation is with PPN 12% (the default) or without it. Without PPN its
-- DPP Nilai Lain and PPN are 0 and the grand total is the subtotal. The
-- choice travels to the PO and the invoice it makes. The rate stays 12%.
-- fn_recompute_quotation_totals is the one rule for a quotation's totals;
-- create, full update and header save end by running it.
ALTER TABLE quotations ADD COLUMN ppn_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE purchase_orders ADD COLUMN ppn_enabled BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE invoices ADD COLUMN ppn_enabled BOOLEAN NOT NULL DEFAULT TRUE;

DROP FUNCTION fn_create_quotation(bigint,bigint,text,text,text,integer,numeric,text,integer,numeric,jsonb,bigint,text,text);
DROP FUNCTION fn_update_quotation_versioned(bigint,integer,text,text,text,integer,numeric,text,integer,numeric,jsonb,bigint,text);
DROP FUNCTION fn_update_quotation(bigint,text,text,text,integer,numeric,text,integer,numeric,jsonb,bigint,text);
DROP FUNCTION fn_quotation_update_header(bigint,text,text,text,integer,numeric,text,integer,numeric,text,bigint);

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_recompute_quotation_totals(p_quotation_id bigint)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_pct          NUMERIC(5,2);
  v_line         RECORD;
  v_net          NUMERIC(15,2);
  v_total_produk NUMERIC(15,2) := 0;
  v_total        NUMERIC(15,2) := 0;
  v_total_disc   NUMERIC(15,2) := 0;
  v_dpp          NUMERIC(15,2) := 0;
  v_ppn          NUMERIC(15,2) := 0;
  v_ppn_on       BOOLEAN;
BEGIN
  SELECT discount_pct, ppn_enabled INTO v_pct, v_ppn_on FROM quotations WHERE id = p_quotation_id;
  -- Same accumulation as fn_create_quotation, so the header matches it.
  FOR v_line IN
    SELECT item_type, qty, selling_price FROM quotation_items
    WHERE quotation_id = p_quotation_id ORDER BY line_number
  LOOP
    IF v_line.item_type = 'product' THEN
      v_net          := ROUND(v_line.qty * v_line.selling_price * (1 - v_pct / 100), 2);
      v_total        := v_total + (v_line.qty * v_line.selling_price);
      v_total_produk := v_total_produk + (v_line.qty * v_line.selling_price);
      v_total_disc   := v_total_disc
                        + ROUND(v_line.qty * v_line.selling_price, 2)
                        - v_net;
    ELSIF v_line.selling_price > 0 THEN
      v_net   := v_line.selling_price;
      v_total := v_total + v_net;
    ELSE
      v_net := 0;
    END IF;
    v_dpp := v_dpp + fn_line_dpp(v_net);
    v_ppn := v_ppn + fn_line_ppn(v_net);
  END LOOP;

  -- Without PPN there is no tax base either.
  IF NOT v_ppn_on THEN
    v_dpp := 0;
    v_ppn := 0;
  END IF;

  UPDATE quotations
  SET total_produk   = v_total_produk,
      total          = v_total,
      total_discount = v_total_disc,
      dpp_nilai_lain = v_dpp,
      ppn_amount     = v_ppn,
      grand_total    = v_total - v_total_disc + v_ppn
  WHERE id = p_quotation_id;
END;
$function$
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
$function$
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_update_quotation(p_id bigint, p_client_ref_no text, p_vessel_name text, p_payment_terms text, p_validity_days integer, p_discount_pct numeric, p_shipping_address text, p_shipping_days integer, p_shipping_cost numeric, p_items jsonb, p_user_id bigint, p_notes text DEFAULT NULL::text, p_ppn_enabled boolean DEFAULT NULL::boolean)
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
    RAISE EXCEPTION 'Quotation tidak ditemukan. Muat ulang halaman.'
      USING ERRCODE = 'P0011';
  END IF;

  IF v_status != 'draft' THEN
    RAISE EXCEPTION 'Hanya quotation berstatus Draf yang dapat diubah. Status saat ini %.',
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
    RAISE EXCEPTION 'Diskon harus antara 0 dan 100. Nilai yang dikirim %.', p_discount_pct
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
      ppn_enabled    = COALESCE(p_ppn_enabled, ppn_enabled),
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
      'SHIPPING' || COALESCE(' - ' || p_shipping_address, ''),
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

  PERFORM fn_recompute_quotation_totals(p_id);

  RETURN p_id;
END;
$function$
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_update_quotation_versioned(p_id bigint, p_if_match integer, p_client_ref_no text, p_vessel_name text, p_payment_terms text, p_validity_days integer, p_discount_pct numeric, p_shipping_address text, p_shipping_days integer, p_shipping_cost numeric, p_items jsonb, p_user_id bigint, p_notes text DEFAULT NULL::text, p_ppn_enabled boolean DEFAULT NULL::boolean)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_current INT;
  v_new     INT;
BEGIN
  SELECT row_version INTO v_current
  FROM quotations
  WHERE id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quotation tidak ditemukan. Muat ulang halaman.' USING ERRCODE = 'P0011';
  END IF;

  IF v_current <> p_if_match THEN
    RAISE EXCEPTION 'Data ini baru saja diubah pengguna lain. Muat ulang lalu coba lagi.'
      USING ERRCODE = 'P0010';
  END IF;

  PERFORM fn_update_quotation(
    p_id, p_client_ref_no, p_vessel_name, p_payment_terms,
    p_validity_days, p_discount_pct, p_shipping_address,
    p_shipping_days, p_shipping_cost, p_items, p_user_id, p_notes, p_ppn_enabled
  );

  SELECT row_version INTO v_new FROM quotations WHERE id = p_id;
  RETURN v_new;
END;
$function$
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_quotation_update_header(p_quotation_id bigint, p_client_ref_no text, p_vessel_name text, p_payment_terms text, p_validity_days integer, p_discount_pct numeric, p_shipping_address text, p_shipping_days integer, p_shipping_cost numeric, p_notes text, p_user_id bigint, p_ppn_enabled boolean DEFAULT NULL::boolean)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_ship_id BIGINT;
  v_next    SMALLINT;
BEGIN
  PERFORM fn_quotation_lock_draft(p_quotation_id);
  PERFORM fn_quotation_part_held(p_quotation_id, 'header', p_user_id);
  IF p_discount_pct < 0 OR p_discount_pct > 100 THEN
    RAISE EXCEPTION 'Diskon harus antara 0 dan 100. Nilai yang dikirim %.', p_discount_pct
      USING ERRCODE = 'P0014';
  END IF;

  -- The discount cascade trigger re-prices every line.
  UPDATE quotations
  SET client_ref_no = p_client_ref_no,
      vessel_name   = p_vessel_name,
      payment_terms = p_payment_terms,
      validity_days = p_validity_days,
      discount_pct  = p_discount_pct,
      notes         = p_notes,
      ppn_enabled   = COALESCE(p_ppn_enabled, ppn_enabled),
      updated_by    = p_user_id
  WHERE id = p_quotation_id;

  SELECT id INTO v_ship_id FROM quotation_items
  WHERE quotation_id = p_quotation_id AND item_type = 'shipping';
  IF NULLIF(TRIM(p_shipping_address), '') IS NOT NULL OR COALESCE(p_shipping_cost, 0) > 0
     OR p_shipping_days IS NOT NULL THEN
    IF v_ship_id IS NULL THEN
      SELECT COALESCE(MAX(line_number), 0) + 1 INTO v_next
      FROM quotation_items WHERE quotation_id = p_quotation_id;
      INSERT INTO quotation_items (
        quotation_id, line_number, item_type, requested_name, qty, unit_id, selling_price,
        ship_destination, shipping_days, created_by, updated_by
      ) VALUES (
        p_quotation_id, v_next, 'shipping',
        'SHIPPING' || COALESCE(' - ' || p_shipping_address, ''), 1,
        (SELECT id FROM units WHERE code = 'UNIT' LIMIT 1),
        COALESCE(p_shipping_cost, 0), p_shipping_address, p_shipping_days,
        p_user_id, p_user_id
      );
    ELSE
      UPDATE quotation_items
      SET requested_name   = 'SHIPPING' || COALESCE(' - ' || p_shipping_address, ''),
          selling_price    = COALESCE(p_shipping_cost, 0),
          ship_destination = p_shipping_address,
          shipping_days    = p_shipping_days,
          updated_by       = p_user_id
      WHERE id = v_ship_id;
    END IF;
  ELSIF v_ship_id IS NOT NULL THEN
    DELETE FROM quotation_items WHERE id = v_ship_id;
  END IF;

  PERFORM fn_recompute_quotation_totals(p_quotation_id);
  PERFORM fn_quotation_notify(p_quotation_id, 'header', 'header', p_user_id);
END;
$function$
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
$function$
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
$function$
-- +goose StatementEnd

-- A PO without PPN has no tax base and no PPN.
CREATE OR REPLACE VIEW v_po_totals AS
SELECT poi.po_id,
       sum(poi.subtotal) AS po_subtotal,
       sum(poi.total_selling) FILTER (WHERE poi.item_type::text = 'product'::text) AS po_total_produk,
       sum(poi.subtotal - poi.total_cost) FILTER (WHERE poi.item_type::text = 'product'::text) AS po_total_profit,
       sum(CASE WHEN po.ppn_enabled THEN round(poi.subtotal * 11.0 / 12.0, 2) ELSE 0.00 END) AS po_dpp_nilai_lain,
       sum(CASE WHEN po.ppn_enabled THEN round(round(poi.subtotal * 11.0 / 12.0, 2) * 0.12, 2) ELSE 0.00 END) AS po_ppn_amount,
       sum(poi.subtotal)
         + sum(CASE WHEN po.ppn_enabled THEN round(round(poi.subtotal * 11.0 / 12.0, 2) * 0.12, 2) ELSE 0.00 END) AS po_grand_total,
       sum(round(poi.qty * poi.selling_price, 2)) - sum(poi.subtotal) AS po_total_discount
FROM purchase_order_items poi
JOIN purchase_orders po ON po.id = poi.po_id
GROUP BY poi.po_id;

-- +goose StatementBegin
-- Snapshots a delivered PO's items into a draft invoice. Line tax figures are
-- rounded per line; the header tax figures are the SUM of those per-line values
-- so the invoice matches what is filed with DJP per line via e-faktur.
-- gross_unit_price and total_discount are snapshotted so the printed totals
-- block satisfies TotalProduk - Diskon = DPP without reading the quotation.
CREATE OR REPLACE FUNCTION public.fn_create_invoice(p_po_id bigint, p_user_id bigint)
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_inv_id        BIGINT;
  v_inv_no        TEXT;
  v_quotation_id  BIGINT;
  v_company_id    BIGINT;
  v_dpp           NUMERIC(15,2);
  v_replaces_id   BIGINT;
  v_ppn_on        BOOLEAN;
BEGIN
  -- A cancelled invoice is void, so only a live one makes this a no-op.
  SELECT id INTO v_inv_id FROM invoices
  WHERE po_id = p_po_id AND status <> 'cancelled';
  IF v_inv_id IS NOT NULL THEN
    RETURN v_inv_id;
  END IF;

  SELECT quotation_id, company_client_id, ppn_enabled INTO v_quotation_id, v_company_id, v_ppn_on
  FROM purchase_orders WHERE id = p_po_id;

  IF v_quotation_id IS NULL THEN
    RAISE EXCEPTION 'PO tidak ditemukan. Muat ulang halaman.'
      USING ERRCODE = 'P0011';
  END IF;

  -- The newest cancelled invoice nothing replaces yet is the one corrected.
  SELECT c.id INTO v_replaces_id
  FROM invoices c
  WHERE c.po_id = p_po_id
    AND c.status = 'cancelled'
    AND NOT EXISTS (SELECT 1 FROM invoices r WHERE r.replaces_invoice_id = c.id)
  ORDER BY c.id DESC
  LIMIT 1;

  SELECT COALESCE(SUM(subtotal), 0) INTO v_dpp
  FROM purchase_order_items WHERE po_id = p_po_id;

  v_inv_no := fn_next_doc_no('INV');

  -- The buyer is stored as the client is now.
  INSERT INTO invoices (
    invoice_no, quotation_id, po_id, company_client_id,
    buyer_name, buyer_npwp, buyer_address,
    invoice_date, due_date, subtotal, dpp,
    status, faktur_type, replaces_invoice_id, created_by, updated_by, ppn_enabled
  )
  SELECT
    v_inv_no, v_quotation_id, p_po_id, v_company_id,
    cc.name, cc.npwp, cc.address,
    CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days',
    v_dpp, v_dpp,
    'draft',
    CASE WHEN v_replaces_id IS NULL THEN 'Normal' ELSE 'Pengganti' END,
    v_replaces_id,
    p_user_id, p_user_id, v_ppn_on
  FROM company_client cc
  WHERE cc.id = v_company_id
  RETURNING id INTO v_inv_id;

  INSERT INTO invoice_items (
    invoice_id, quotation_item_id, line_type, line_number,
    item_name, item_code, offered_item_id, unit_id, unit_code,
    qty, unit_price, gross_unit_price, cost_price, ship_destination, goods_or_service,
    dpp, dpp_nilai_lain, ppn_rate, ppn_amount,
    created_by, updated_by
  )
  SELECT
    v_inv_id, pi.quotation_item_id, pi.item_type, pi.line_number,
    COALESCE(pi.item_name, ''), pi.item_code, pi.offered_item_id, pi.unit_id, u.code,
    pi.qty,
    CASE
      WHEN pi.item_type = 'product' THEN pi.selling_price * (1 - pi.discount_pct / 100)
      ELSE pi.selling_price
    END,
    pi.selling_price,
    pi.cost_price,
    pi.ship_destination,
    CASE pi.item_type WHEN 'shipping' THEN 'J' ELSE 'B' END,
    pi.subtotal,
    -- Without PPN the line carries no tax base, rate or PPN.
    CASE WHEN v_ppn_on THEN ROUND(pi.subtotal * 11.0 / 12.0, 2) ELSE 0.00 END,
    CASE WHEN v_ppn_on THEN 12.00 ELSE 0.00 END,
    CASE WHEN v_ppn_on THEN ROUND(ROUND(pi.subtotal * 11.0 / 12.0, 2) * 0.12, 2) ELSE 0.00 END,
    p_user_id, p_user_id
  FROM purchase_order_items pi
  LEFT JOIN units u ON u.id = pi.unit_id
  WHERE pi.po_id = p_po_id
  ORDER BY pi.line_number;

  -- Header totals are the sum of the per-line rounded values.
  UPDATE invoices inv SET
    dpp_nilai_lain = li.sum_dnl,
    ppn_amount     = li.sum_ppn,
    total          = inv.dpp + li.sum_ppn
  FROM (
    SELECT COALESCE(SUM(dpp_nilai_lain), 0) AS sum_dnl,
           COALESCE(SUM(ppn_amount), 0)     AS sum_ppn
    FROM invoice_items WHERE invoice_id = v_inv_id
  ) li
  WHERE inv.id = v_inv_id;

  -- Realised discount = gross line amounts minus the net subtotals that make
  -- up dpp. Read from purchase_order_items: invoice_items.unit_price is
  -- already net, so the same difference there would be zero. Gross is rounded
  -- per line, matching both the generated subtotal column and the per-line
  -- Amount printed on the PDF, so shipping lines contribute exactly 0.
  UPDATE invoices SET total_discount = (
    SELECT COALESCE(SUM(ROUND(pi.qty * pi.selling_price, 2)) - SUM(pi.subtotal), 0)
    FROM purchase_order_items pi
    WHERE pi.po_id = p_po_id
  )
  WHERE id = v_inv_id;

  RETURN v_inv_id;
END;
$function$
-- +goose StatementEnd

-- +goose Down
DROP FUNCTION fn_create_quotation(bigint,bigint,text,text,text,integer,numeric,text,integer,numeric,jsonb,bigint,text,text,boolean);
DROP FUNCTION fn_update_quotation_versioned(bigint,integer,text,text,text,integer,numeric,text,integer,numeric,jsonb,bigint,text,boolean);
DROP FUNCTION fn_update_quotation(bigint,text,text,text,integer,numeric,text,integer,numeric,jsonb,bigint,text,boolean);
DROP FUNCTION fn_quotation_update_header(bigint,text,text,text,integer,numeric,text,integer,numeric,text,bigint,boolean);

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_recompute_quotation_totals(p_quotation_id bigint)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_pct          NUMERIC(5,2);
  v_line         RECORD;
  v_net          NUMERIC(15,2);
  v_total_produk NUMERIC(15,2) := 0;
  v_total        NUMERIC(15,2) := 0;
  v_total_disc   NUMERIC(15,2) := 0;
  v_dpp          NUMERIC(15,2) := 0;
  v_ppn          NUMERIC(15,2) := 0;
BEGIN
  SELECT discount_pct INTO v_pct FROM quotations WHERE id = p_quotation_id;
  -- Same accumulation as fn_create_quotation, so the header matches it.
  FOR v_line IN
    SELECT item_type, qty, selling_price FROM quotation_items
    WHERE quotation_id = p_quotation_id ORDER BY line_number
  LOOP
    IF v_line.item_type = 'product' THEN
      v_net          := ROUND(v_line.qty * v_line.selling_price * (1 - v_pct / 100), 2);
      v_total        := v_total + (v_line.qty * v_line.selling_price);
      v_total_produk := v_total_produk + (v_line.qty * v_line.selling_price);
      v_total_disc   := v_total_disc
                        + ROUND(v_line.qty * v_line.selling_price, 2)
                        - v_net;
    ELSIF v_line.selling_price > 0 THEN
      v_net   := v_line.selling_price;
      v_total := v_total + v_net;
    ELSE
      v_net := 0;
    END IF;
    v_dpp := v_dpp + fn_line_dpp(v_net);
    v_ppn := v_ppn + fn_line_ppn(v_net);
  END LOOP;

  UPDATE quotations
  SET total_produk   = v_total_produk,
      total          = v_total,
      total_discount = v_total_disc,
      dpp_nilai_lain = v_dpp,
      ppn_amount     = v_ppn,
      grand_total    = v_total - v_total_disc + v_ppn
  WHERE id = p_quotation_id;
END;
$function$
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
      'SHIPPING' || COALESCE(' - ' || p_shipping_address, ''),
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
    RAISE EXCEPTION 'Quotation tidak ditemukan. Muat ulang halaman.'
      USING ERRCODE = 'P0011';
  END IF;

  IF v_status != 'draft' THEN
    RAISE EXCEPTION 'Hanya quotation berstatus Draf yang dapat diubah. Status saat ini %.',
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
    RAISE EXCEPTION 'Diskon harus antara 0 dan 100. Nilai yang dikirim %.', p_discount_pct
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
      'SHIPPING' || COALESCE(' - ' || p_shipping_address, ''),
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
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_update_quotation_versioned(p_id bigint, p_if_match integer, p_client_ref_no text, p_vessel_name text, p_payment_terms text, p_validity_days integer, p_discount_pct numeric, p_shipping_address text, p_shipping_days integer, p_shipping_cost numeric, p_items jsonb, p_user_id bigint, p_notes text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_current INT;
  v_new     INT;
BEGIN
  SELECT row_version INTO v_current
  FROM quotations
  WHERE id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quotation tidak ditemukan. Muat ulang halaman.' USING ERRCODE = 'P0011';
  END IF;

  IF v_current <> p_if_match THEN
    RAISE EXCEPTION 'Data ini baru saja diubah pengguna lain. Muat ulang lalu coba lagi.'
      USING ERRCODE = 'P0010';
  END IF;

  PERFORM fn_update_quotation(
    p_id, p_client_ref_no, p_vessel_name, p_payment_terms,
    p_validity_days, p_discount_pct, p_shipping_address,
    p_shipping_days, p_shipping_cost, p_items, p_user_id, p_notes
  );

  SELECT row_version INTO v_new FROM quotations WHERE id = p_id;
  RETURN v_new;
END;
$function$
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_quotation_update_header(p_quotation_id bigint, p_client_ref_no text, p_vessel_name text, p_payment_terms text, p_validity_days integer, p_discount_pct numeric, p_shipping_address text, p_shipping_days integer, p_shipping_cost numeric, p_notes text, p_user_id bigint)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_ship_id BIGINT;
  v_next    SMALLINT;
BEGIN
  PERFORM fn_quotation_lock_draft(p_quotation_id);
  PERFORM fn_quotation_part_held(p_quotation_id, 'header', p_user_id);
  IF p_discount_pct < 0 OR p_discount_pct > 100 THEN
    RAISE EXCEPTION 'Diskon harus antara 0 dan 100. Nilai yang dikirim %.', p_discount_pct
      USING ERRCODE = 'P0014';
  END IF;

  -- The discount cascade trigger re-prices every line.
  UPDATE quotations
  SET client_ref_no = p_client_ref_no,
      vessel_name   = p_vessel_name,
      payment_terms = p_payment_terms,
      validity_days = p_validity_days,
      discount_pct  = p_discount_pct,
      notes         = p_notes,
      updated_by    = p_user_id
  WHERE id = p_quotation_id;

  SELECT id INTO v_ship_id FROM quotation_items
  WHERE quotation_id = p_quotation_id AND item_type = 'shipping';
  IF NULLIF(TRIM(p_shipping_address), '') IS NOT NULL OR COALESCE(p_shipping_cost, 0) > 0
     OR p_shipping_days IS NOT NULL THEN
    IF v_ship_id IS NULL THEN
      SELECT COALESCE(MAX(line_number), 0) + 1 INTO v_next
      FROM quotation_items WHERE quotation_id = p_quotation_id;
      INSERT INTO quotation_items (
        quotation_id, line_number, item_type, requested_name, qty, unit_id, selling_price,
        ship_destination, shipping_days, created_by, updated_by
      ) VALUES (
        p_quotation_id, v_next, 'shipping',
        'SHIPPING' || COALESCE(' - ' || p_shipping_address, ''), 1,
        (SELECT id FROM units WHERE code = 'UNIT' LIMIT 1),
        COALESCE(p_shipping_cost, 0), p_shipping_address, p_shipping_days,
        p_user_id, p_user_id
      );
    ELSE
      UPDATE quotation_items
      SET requested_name   = 'SHIPPING' || COALESCE(' - ' || p_shipping_address, ''),
          selling_price    = COALESCE(p_shipping_cost, 0),
          ship_destination = p_shipping_address,
          shipping_days    = p_shipping_days,
          updated_by       = p_user_id
      WHERE id = v_ship_id;
    END IF;
  ELSIF v_ship_id IS NOT NULL THEN
    DELETE FROM quotation_items WHERE id = v_ship_id;
  END IF;

  PERFORM fn_recompute_quotation_totals(p_quotation_id);
  PERFORM fn_quotation_notify(p_quotation_id, 'header', 'header', p_user_id);
END;
$function$
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
    created_by, updated_by
  ) VALUES (
    v_new_no, v_orig.version + 1, v_orig.id,
    v_orig.company_client_id, v_orig.company_client_name, v_orig.contact_id, v_orig.contact_name,
    v_orig.client_ref_no, v_orig.vessel_name, 'draft', v_orig.notes,
    v_orig.payment_terms, v_orig.validity_days, v_orig.discount_pct,
    v_orig.total_produk, v_orig.total, v_orig.total_discount,
    -- The lines are copied as they are, so their tax is too.
    v_orig.dpp_nilai_lain, v_orig.ppn_amount, v_orig.grand_total,
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
$function$
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
BEGIN
  SELECT id INTO v_po_id FROM purchase_orders WHERE quotation_id = p_quotation_id;
  IF v_po_id IS NOT NULL THEN
    RETURN v_po_id;
  END IF;

  SELECT company_client_id, contact_id
  INTO v_company_id, v_contact_id
  FROM quotations WHERE id = p_quotation_id;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Quotation tidak ditemukan. Muat ulang halaman.'
      USING ERRCODE = 'P0011';
  END IF;

  -- po_number is the client's own, entered later.
  INSERT INTO purchase_orders (
    quotation_id, company_client_id, contact_id,
    po_date, status, created_by, updated_by
  ) VALUES (
    p_quotation_id, v_company_id, v_contact_id,
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
$function$
-- +goose StatementEnd

-- +goose StatementBegin
-- Snapshots a delivered PO's items into a draft invoice. Line tax figures are
-- rounded per line; the header tax figures are the SUM of those per-line values
-- so the invoice matches what is filed with DJP per line via e-faktur.
-- gross_unit_price and total_discount are snapshotted so the printed totals
-- block satisfies TotalProduk - Diskon = DPP without reading the quotation.
CREATE OR REPLACE FUNCTION public.fn_create_invoice(p_po_id bigint, p_user_id bigint)
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_inv_id        BIGINT;
  v_inv_no        TEXT;
  v_quotation_id  BIGINT;
  v_company_id    BIGINT;
  v_dpp           NUMERIC(15,2);
  v_replaces_id   BIGINT;
BEGIN
  -- A cancelled invoice is void, so only a live one makes this a no-op.
  SELECT id INTO v_inv_id FROM invoices
  WHERE po_id = p_po_id AND status <> 'cancelled';
  IF v_inv_id IS NOT NULL THEN
    RETURN v_inv_id;
  END IF;

  SELECT quotation_id, company_client_id INTO v_quotation_id, v_company_id
  FROM purchase_orders WHERE id = p_po_id;

  IF v_quotation_id IS NULL THEN
    RAISE EXCEPTION 'PO tidak ditemukan. Muat ulang halaman.'
      USING ERRCODE = 'P0011';
  END IF;

  -- The newest cancelled invoice nothing replaces yet is the one corrected.
  SELECT c.id INTO v_replaces_id
  FROM invoices c
  WHERE c.po_id = p_po_id
    AND c.status = 'cancelled'
    AND NOT EXISTS (SELECT 1 FROM invoices r WHERE r.replaces_invoice_id = c.id)
  ORDER BY c.id DESC
  LIMIT 1;

  SELECT COALESCE(SUM(subtotal), 0) INTO v_dpp
  FROM purchase_order_items WHERE po_id = p_po_id;

  v_inv_no := fn_next_doc_no('INV');

  -- The buyer is stored as the client is now.
  INSERT INTO invoices (
    invoice_no, quotation_id, po_id, company_client_id,
    buyer_name, buyer_npwp, buyer_address,
    invoice_date, due_date, subtotal, dpp,
    status, faktur_type, replaces_invoice_id, created_by, updated_by
  )
  SELECT
    v_inv_no, v_quotation_id, p_po_id, v_company_id,
    cc.name, cc.npwp, cc.address,
    CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days',
    v_dpp, v_dpp,
    'draft',
    CASE WHEN v_replaces_id IS NULL THEN 'Normal' ELSE 'Pengganti' END,
    v_replaces_id,
    p_user_id, p_user_id
  FROM company_client cc
  WHERE cc.id = v_company_id
  RETURNING id INTO v_inv_id;

  INSERT INTO invoice_items (
    invoice_id, quotation_item_id, line_type, line_number,
    item_name, item_code, offered_item_id, unit_id, unit_code,
    qty, unit_price, gross_unit_price, cost_price, ship_destination, goods_or_service,
    dpp, dpp_nilai_lain, ppn_rate, ppn_amount,
    created_by, updated_by
  )
  SELECT
    v_inv_id, pi.quotation_item_id, pi.item_type, pi.line_number,
    COALESCE(pi.item_name, ''), pi.item_code, pi.offered_item_id, pi.unit_id, u.code,
    pi.qty,
    CASE
      WHEN pi.item_type = 'product' THEN pi.selling_price * (1 - pi.discount_pct / 100)
      ELSE pi.selling_price
    END,
    pi.selling_price,
    pi.cost_price,
    pi.ship_destination,
    CASE pi.item_type WHEN 'shipping' THEN 'J' ELSE 'B' END,
    pi.subtotal,
    ROUND(pi.subtotal * 11.0 / 12.0, 2),
    12.00,
    ROUND(ROUND(pi.subtotal * 11.0 / 12.0, 2) * 0.12, 2),
    p_user_id, p_user_id
  FROM purchase_order_items pi
  LEFT JOIN units u ON u.id = pi.unit_id
  WHERE pi.po_id = p_po_id
  ORDER BY pi.line_number;

  -- Header totals are the sum of the per-line rounded values.
  UPDATE invoices inv SET
    dpp_nilai_lain = li.sum_dnl,
    ppn_amount     = li.sum_ppn,
    total          = inv.dpp + li.sum_ppn
  FROM (
    SELECT COALESCE(SUM(dpp_nilai_lain), 0) AS sum_dnl,
           COALESCE(SUM(ppn_amount), 0)     AS sum_ppn
    FROM invoice_items WHERE invoice_id = v_inv_id
  ) li
  WHERE inv.id = v_inv_id;

  -- Realised discount = gross line amounts minus the net subtotals that make
  -- up dpp. Read from purchase_order_items: invoice_items.unit_price is
  -- already net, so the same difference there would be zero. Gross is rounded
  -- per line, matching both the generated subtotal column and the per-line
  -- Amount printed on the PDF, so shipping lines contribute exactly 0.
  UPDATE invoices SET total_discount = (
    SELECT COALESCE(SUM(ROUND(pi.qty * pi.selling_price, 2)) - SUM(pi.subtotal), 0)
    FROM purchase_order_items pi
    WHERE pi.po_id = p_po_id
  )
  WHERE id = v_inv_id;

  RETURN v_inv_id;
END;
$function$
-- +goose StatementEnd

CREATE OR REPLACE VIEW v_po_totals AS
SELECT po_id,
       sum(subtotal) AS po_subtotal,
       sum(total_selling) FILTER (WHERE item_type::text = 'product'::text) AS po_total_produk,
       sum(subtotal - total_cost) FILTER (WHERE item_type::text = 'product'::text) AS po_total_profit,
       sum(round(subtotal * 11.0 / 12.0, 2)) AS po_dpp_nilai_lain,
       sum(round(round(subtotal * 11.0 / 12.0, 2) * 0.12, 2)) AS po_ppn_amount,
       sum(subtotal) + sum(round(round(subtotal * 11.0 / 12.0, 2) * 0.12, 2)) AS po_grand_total,
       sum(round(qty * selling_price, 2)) - sum(subtotal) AS po_total_discount
FROM purchase_order_items poi
GROUP BY po_id;

ALTER TABLE invoices DROP COLUMN ppn_enabled;
ALTER TABLE purchase_orders DROP COLUMN ppn_enabled;
ALTER TABLE quotations DROP COLUMN ppn_enabled;
