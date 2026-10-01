-- +goose Up

-- 00078 LIVE QUOTATION EDITING
-- Several users edit one draft together, each on different parts: a part is
-- one product line ('line:<quotation_items.id>') or the header ('header':
-- reference, vessel, payment terms, validity, discount, shipping, notes).
--
-- quotation_edit_locks holds who edits which part until when. A lock is
-- taken when an editor opens a part and renewed by heartbeat; an expired
-- lock counts as free. Losing the race raises P0015 naming the holder.
--
-- Every collaborative function first takes the quotation row FOR UPDATE, so
-- operations on one quotation run one at a time and a lock check and the
-- write it guards cannot interleave with another user's.
--
-- Line functions keep line ids stable, unlike fn_update_quotation, which
-- rewrites every line. Saving a whole line or the header needs its lock;
-- adding a line, deleting one or marking it Tidak Ditawarkan needs the part
-- to be free of anyone else's lock. Totals are recomputed the way
-- fn_create_quotation accumulates them.
--
-- Each change is announced with pg_notify('quotation_events', json) so every
-- open editor reloads. fn_update_quotation (the whole save) and
-- fn_change_quotation_status refuse while another user holds a lock.
--
-- Two AFTER UPDATE triggers give line edits the side effects line inserts
-- already have: learning a changed request match and syncing a changed cost
-- to the vendor link when update_vendor_price is set.

CREATE TABLE quotation_edit_locks (
  quotation_id BIGINT      NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  part         TEXT        NOT NULL CHECK (part = 'header' OR part ~ '^line:[1-9][0-9]*$'),
  user_id      BIGINT      NOT NULL REFERENCES users(id),
  expires_at   TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (quotation_id, part)
);

CREATE TRIGGER trg_learn_match_on_update
  AFTER UPDATE OF requested_item_id, requested_name ON quotation_items
  FOR EACH ROW
  WHEN (OLD.requested_item_id IS DISTINCT FROM NEW.requested_item_id
        OR LOWER(TRIM(OLD.requested_name)) IS DISTINCT FROM LOWER(TRIM(NEW.requested_name)))
  EXECUTE FUNCTION trg_fn_learn_match();

CREATE TRIGGER trg_sync_vendor_cost_on_update
  AFTER UPDATE OF cost_price, vendor_product_id, update_vendor_price ON quotation_items
  FOR EACH ROW
  WHEN (NEW.update_vendor_price
        AND (OLD.cost_price IS DISTINCT FROM NEW.cost_price
             OR OLD.vendor_product_id IS DISTINCT FROM NEW.vendor_product_id
             OR NOT OLD.update_vendor_price))
  EXECUTE FUNCTION trg_fn_sync_vendor_cost();

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION fn_quotation_notify(p_quotation_id BIGINT, p_kind TEXT, p_part TEXT, p_user_id BIGINT)
RETURNS VOID
LANGUAGE sql
AS $$
  SELECT pg_notify('quotation_events', json_build_object(
    'quotationId', p_quotation_id, 'kind', p_kind, 'part', p_part, 'userId', p_user_id)::text);
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION fn_quotation_lock_draft(p_quotation_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_status VARCHAR(20);
BEGIN
  SELECT status INTO v_status FROM quotations WHERE id = p_quotation_id FOR UPDATE;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Quotation % tidak ditemukan.', p_quotation_id USING ERRCODE = 'P0011';
  END IF;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'Hanya quotation berstatus Draf yang dapat diubah; status saat ini %.',
      fn_quotation_status_label(v_status)
      USING ERRCODE = 'P0013';
  END IF;
END;
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION fn_quotation_line_of(p_quotation_id BIGINT, p_line_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM quotation_items
    WHERE id = p_line_id AND quotation_id = p_quotation_id AND item_type = 'product'
  ) THEN
    RAISE EXCEPTION 'Baris produk tidak ditemukan di quotation ini. Muat ulang halaman.'
      USING ERRCODE = 'P0011';
  END IF;
END;
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION fn_quotation_part_free(p_quotation_id BIGINT, p_part TEXT, p_user_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_holder TEXT;
BEGIN
  SELECT u.name INTO v_holder
  FROM quotation_edit_locks l
  JOIN users u ON u.id = l.user_id
  WHERE l.quotation_id = p_quotation_id AND l.part = p_part
    AND l.user_id <> p_user_id AND l.expires_at > NOW();
  IF FOUND THEN
    RAISE EXCEPTION 'Sedang diubah oleh %.', v_holder USING ERRCODE = 'P0015';
  END IF;
END;
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION fn_quotation_part_held(p_quotation_id BIGINT, p_part TEXT, p_user_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM fn_quotation_part_free(p_quotation_id, p_part, p_user_id);
  IF NOT EXISTS (
    SELECT 1 FROM quotation_edit_locks
    WHERE quotation_id = p_quotation_id AND part = p_part
      AND user_id = p_user_id AND expires_at > NOW()
  ) THEN
    RAISE EXCEPTION 'Waktu mengubah bagian ini sudah habis. Buka lagi lalu simpan kembali.'
      USING ERRCODE = 'P0015';
  END IF;
END;
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION fn_quotation_no_other_editors(p_quotation_id BIGINT, p_user_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_holder TEXT;
BEGIN
  SELECT u.name INTO v_holder
  FROM quotation_edit_locks l
  JOIN users u ON u.id = l.user_id
  WHERE l.quotation_id = p_quotation_id AND l.user_id <> p_user_id AND l.expires_at > NOW()
  ORDER BY l.expires_at DESC
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Quotation sedang diubah oleh %. Tunggu sampai selesai.', v_holder
      USING ERRCODE = 'P0015';
  END IF;
END;
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION fn_quotation_lock(p_quotation_id BIGINT, p_part TEXT, p_user_id BIGINT, p_ttl_seconds INT)
RETURNS TIMESTAMPTZ
LANGUAGE plpgsql
AS $$
DECLARE
  v_expires TIMESTAMPTZ;
  v_renewal BOOLEAN;
BEGIN
  PERFORM fn_quotation_lock_draft(p_quotation_id);
  IF p_part <> 'header' THEN
    IF p_part !~ '^line:[1-9][0-9]*$' THEN
      RAISE EXCEPTION 'Bagian quotation tidak dikenal.' USING ERRCODE = 'P0014';
    END IF;
    PERFORM fn_quotation_line_of(p_quotation_id, substring(p_part FROM 6)::BIGINT);
  END IF;
  PERFORM fn_quotation_part_free(p_quotation_id, p_part, p_user_id);

  SELECT TRUE INTO v_renewal FROM quotation_edit_locks
  WHERE quotation_id = p_quotation_id AND part = p_part
    AND user_id = p_user_id AND expires_at > NOW();

  INSERT INTO quotation_edit_locks (quotation_id, part, user_id, expires_at)
  VALUES (p_quotation_id, p_part, p_user_id, NOW() + make_interval(secs => p_ttl_seconds))
  ON CONFLICT (quotation_id, part) DO UPDATE
     SET user_id = EXCLUDED.user_id, expires_at = EXCLUDED.expires_at
  RETURNING expires_at INTO v_expires;

  -- A heartbeat changes nothing anyone sees.
  IF v_renewal IS NULL THEN
    PERFORM fn_quotation_notify(p_quotation_id, 'locked', p_part, p_user_id);
  END IF;
  RETURN v_expires;
END;
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION fn_quotation_unlock(p_quotation_id BIGINT, p_part TEXT, p_user_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  DELETE FROM quotation_edit_locks
  WHERE quotation_id = p_quotation_id AND part = p_part AND user_id = p_user_id;
  IF FOUND THEN
    PERFORM fn_quotation_notify(p_quotation_id, 'unlocked', p_part, p_user_id);
  END IF;
END;
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION fn_recompute_quotation_totals(p_quotation_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_pct          NUMERIC(5,2);
  v_line         RECORD;
  v_total_produk NUMERIC(15,2) := 0;
  v_total        NUMERIC(15,2) := 0;
  v_total_disc   NUMERIC(15,2) := 0;
BEGIN
  SELECT discount_pct INTO v_pct FROM quotations WHERE id = p_quotation_id;
  -- Same accumulation as fn_create_quotation, so the header matches it.
  FOR v_line IN
    SELECT item_type, qty, selling_price FROM quotation_items
    WHERE quotation_id = p_quotation_id ORDER BY line_number
  LOOP
    IF v_line.item_type = 'product' THEN
      v_total        := v_total + (v_line.qty * v_line.selling_price);
      v_total_produk := v_total_produk + (v_line.qty * v_line.selling_price);
      v_total_disc   := v_total_disc
                        + ROUND(v_line.qty * v_line.selling_price, 2)
                        - ROUND(v_line.qty * v_line.selling_price * (1 - v_pct / 100), 2);
    ELSIF v_line.selling_price > 0 THEN
      v_total := v_total + v_line.selling_price;
    END IF;
  END LOOP;

  UPDATE quotations
  SET total_produk = v_total_produk, total = v_total, total_discount = v_total_disc
  WHERE id = p_quotation_id;
END;
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION fn_quotation_add_lines(p_quotation_id BIGINT, p_items JSONB, p_user_id BIGINT)
RETURNS BIGINT[]
LANGUAGE plpgsql
AS $$
DECLARE
  v_items JSONB;
  v_item  JSONB;
  v_next  SMALLINT;
  v_id    BIGINT;
  v_ids   BIGINT[] := '{}';
BEGIN
  PERFORM fn_quotation_lock_draft(p_quotation_id);
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Tambahkan minimal satu baris produk.' USING ERRCODE = 'P0014';
  END IF;
  v_items := fn_prepare_quotation_lines(p_items, p_user_id);

  SELECT COALESCE(MAX(line_number), 0) INTO v_next
  FROM quotation_items WHERE quotation_id = p_quotation_id AND item_type = 'product';
  -- The shipping line stays last.
  UPDATE quotation_items
  SET line_number = v_next + jsonb_array_length(v_items) + 1
  WHERE quotation_id = p_quotation_id AND item_type = 'shipping';

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items) LOOP
    v_next := v_next + 1;
    INSERT INTO quotation_items (
      quotation_id, line_number, item_type,
      requested_item_id, requested_impa, requested_name,
      offered_item_id, vendor_product_id,
      qty, unit_id, selling_price, cost_price,
      is_available, ship_destination, due_date,
      update_vendor_price, created_by, updated_by
    ) VALUES (
      p_quotation_id, v_next, 'product',
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
    ) RETURNING id INTO v_id;
    v_ids := v_ids || v_id;
  END LOOP;

  PERFORM fn_recompute_quotation_totals(p_quotation_id);
  PERFORM fn_quotation_notify(p_quotation_id, 'lines', NULL, p_user_id);
  RETURN v_ids;
END;
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION fn_quotation_update_line(p_quotation_id BIGINT, p_line_id BIGINT, p_item JSONB, p_user_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_item JSONB;
BEGIN
  PERFORM fn_quotation_lock_draft(p_quotation_id);
  PERFORM fn_quotation_line_of(p_quotation_id, p_line_id);
  PERFORM fn_quotation_part_held(p_quotation_id, 'line:' || p_line_id, p_user_id);
  v_item := fn_prepare_quotation_lines(jsonb_build_array(p_item), p_user_id) -> 0;

  UPDATE quotation_items SET
    requested_item_id   = NULLIF((v_item->>'requested_item_id'),'')::BIGINT,
    requested_impa      = v_item->>'requested_impa',
    requested_name      = v_item->>'requested_name',
    offered_item_id     = NULLIF((v_item->>'offered_item_id'),'')::BIGINT,
    vendor_product_id   = NULLIF((v_item->>'vendor_product_id'),'')::BIGINT,
    qty                 = (v_item->>'qty')::NUMERIC(12,2),
    unit_id             = (v_item->>'unit_id')::SMALLINT,
    selling_price       = (v_item->>'selling_price')::NUMERIC(15,2),
    cost_price          = NULLIF((v_item->>'cost_price'),'')::NUMERIC(15,2),
    is_available        = COALESCE((v_item->>'is_available')::BOOLEAN, TRUE),
    ship_destination    = v_item->>'ship_destination',
    due_date            = NULLIF((v_item->>'due_date'),'')::DATE,
    update_vendor_price = COALESCE((v_item->>'update_vendor_price')::BOOLEAN, FALSE),
    updated_by          = p_user_id
  WHERE id = p_line_id;

  PERFORM fn_recompute_quotation_totals(p_quotation_id);
  PERFORM fn_quotation_notify(p_quotation_id, 'line', 'line:' || p_line_id, p_user_id);
END;
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION fn_quotation_set_line_offer(p_quotation_id BIGINT, p_line_id BIGINT, p_available BOOLEAN, p_user_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM fn_quotation_lock_draft(p_quotation_id);
  PERFORM fn_quotation_line_of(p_quotation_id, p_line_id);
  PERFORM fn_quotation_part_free(p_quotation_id, 'line:' || p_line_id, p_user_id);

  IF p_available THEN
    -- Back on offer: the line is priced again by hand.
    UPDATE quotation_items SET is_available = TRUE, updated_by = p_user_id WHERE id = p_line_id;
  ELSE
    -- Tidak Ditawarkan, as fn_prepare_quotation_lines stores it.
    UPDATE quotation_items
    SET is_available = FALSE, selling_price = 0, cost_price = NULL,
        vendor_product_id = NULL, update_vendor_price = FALSE, updated_by = p_user_id
    WHERE id = p_line_id;
  END IF;

  PERFORM fn_recompute_quotation_totals(p_quotation_id);
  PERFORM fn_quotation_notify(p_quotation_id, 'line', 'line:' || p_line_id, p_user_id);
END;
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION fn_quotation_delete_line(p_quotation_id BIGINT, p_line_id BIGINT, p_user_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
BEGIN
  PERFORM fn_quotation_lock_draft(p_quotation_id);
  PERFORM fn_quotation_line_of(p_quotation_id, p_line_id);
  PERFORM fn_quotation_part_free(p_quotation_id, 'line:' || p_line_id, p_user_id);
  IF (SELECT count(*) FROM quotation_items
      WHERE quotation_id = p_quotation_id AND item_type = 'product') <= 1 THEN
    RAISE EXCEPTION 'Quotation harus memiliki minimal satu baris.' USING ERRCODE = 'P0014';
  END IF;

  DELETE FROM quotation_edit_locks WHERE quotation_id = p_quotation_id AND part = 'line:' || p_line_id;
  DELETE FROM quotation_items WHERE id = p_line_id;

  PERFORM fn_recompute_quotation_totals(p_quotation_id);
  PERFORM fn_quotation_notify(p_quotation_id, 'lines', 'line:' || p_line_id, p_user_id);
END;
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION fn_quotation_update_header(
  p_quotation_id BIGINT, p_client_ref_no TEXT, p_vessel_name TEXT, p_payment_terms TEXT,
  p_validity_days INT, p_discount_pct NUMERIC, p_shipping_address TEXT, p_shipping_days INT,
  p_shipping_cost NUMERIC, p_notes TEXT, p_user_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE
  v_ship_id BIGINT;
  v_next    SMALLINT;
BEGIN
  PERFORM fn_quotation_lock_draft(p_quotation_id);
  PERFORM fn_quotation_part_held(p_quotation_id, 'header', p_user_id);
  IF p_discount_pct < 0 OR p_discount_pct > 100 THEN
    RAISE EXCEPTION 'Diskon harus antara 0 dan 100; nilai yang dikirim %.', p_discount_pct
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
  IF NULLIF(TRIM(p_shipping_address), '') IS NOT NULL OR COALESCE(p_shipping_cost, 0) > 0 THEN
    IF v_ship_id IS NULL THEN
      SELECT COALESCE(MAX(line_number), 0) + 1 INTO v_next
      FROM quotation_items WHERE quotation_id = p_quotation_id;
      INSERT INTO quotation_items (
        quotation_id, line_number, item_type, requested_name, qty, unit_id, selling_price,
        ship_destination, shipping_days, created_by, updated_by
      ) VALUES (
        p_quotation_id, v_next, 'shipping',
        'SHIPPING' || COALESCE(' — ' || p_shipping_address, ''), 1,
        (SELECT id FROM units WHERE code = 'UNIT' LIMIT 1),
        COALESCE(p_shipping_cost, 0), p_shipping_address, p_shipping_days,
        p_user_id, p_user_id
      );
    ELSE
      UPDATE quotation_items
      SET requested_name   = 'SHIPPING' || COALESCE(' — ' || p_shipping_address, ''),
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
$$;
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
  v_pct := p_discount_pct;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_item->>'qty')::NUMERIC(12,2);
    v_selling_price := (v_item->>'selling_price')::NUMERIC(15,2);
    v_total        := v_total + (v_qty * v_selling_price);
    v_total_produk := v_total_produk + (v_qty * v_selling_price);
    v_total_disc   := v_total_disc
                      + ROUND(v_qty * v_selling_price, 2)
                      - ROUND(v_qty * v_selling_price * (1 - v_pct / 100), 2);
  END LOOP;

  IF p_shipping_cost IS NOT NULL AND p_shipping_cost > 0 THEN
    v_total := v_total + p_shipping_cost;
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
  IF NULLIF(TRIM(p_shipping_address), '') IS NOT NULL OR COALESCE(p_shipping_cost, 0) > 0 THEN
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
$function$;
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
$function$;
-- +goose StatementEnd

-- +goose Down

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
  v_pct := p_discount_pct;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_item->>'qty')::NUMERIC(12,2);
    v_selling_price := (v_item->>'selling_price')::NUMERIC(15,2);
    v_total        := v_total + (v_qty * v_selling_price);
    v_total_produk := v_total_produk + (v_qty * v_selling_price);
    v_total_disc   := v_total_disc
                      + ROUND(v_qty * v_selling_price, 2)
                      - ROUND(v_qty * v_selling_price * (1 - v_pct / 100), 2);
  END LOOP;

  IF p_shipping_cost IS NOT NULL AND p_shipping_cost > 0 THEN
    v_total := v_total + p_shipping_cost;
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
  IF NULLIF(TRIM(p_shipping_address), '') IS NOT NULL OR COALESCE(p_shipping_cost, 0) > 0 THEN
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

  RETURN p_id;
END;
$function$;
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


DROP FUNCTION IF EXISTS fn_quotation_update_header(BIGINT, TEXT, TEXT, TEXT, INT, NUMERIC, TEXT, INT, NUMERIC, TEXT, BIGINT);
DROP FUNCTION IF EXISTS fn_quotation_delete_line(BIGINT, BIGINT, BIGINT);
DROP FUNCTION IF EXISTS fn_quotation_set_line_offer(BIGINT, BIGINT, BOOLEAN, BIGINT);
DROP FUNCTION IF EXISTS fn_quotation_update_line(BIGINT, BIGINT, JSONB, BIGINT);
DROP FUNCTION IF EXISTS fn_quotation_add_lines(BIGINT, JSONB, BIGINT);
DROP FUNCTION IF EXISTS fn_recompute_quotation_totals(BIGINT);
DROP FUNCTION IF EXISTS fn_quotation_unlock(BIGINT, TEXT, BIGINT);
DROP FUNCTION IF EXISTS fn_quotation_lock(BIGINT, TEXT, BIGINT, INT);
DROP FUNCTION IF EXISTS fn_quotation_no_other_editors(BIGINT, BIGINT);
DROP FUNCTION IF EXISTS fn_quotation_part_held(BIGINT, TEXT, BIGINT);
DROP FUNCTION IF EXISTS fn_quotation_part_free(BIGINT, TEXT, BIGINT);
DROP FUNCTION IF EXISTS fn_quotation_line_of(BIGINT, BIGINT);
DROP FUNCTION IF EXISTS fn_quotation_lock_draft(BIGINT);
DROP FUNCTION IF EXISTS fn_quotation_notify(BIGINT, TEXT, TEXT, BIGINT);
DROP TRIGGER IF EXISTS trg_sync_vendor_cost_on_update ON quotation_items;
DROP TRIGGER IF EXISTS trg_learn_match_on_update ON quotation_items;
DROP TABLE IF EXISTS quotation_edit_locks;
