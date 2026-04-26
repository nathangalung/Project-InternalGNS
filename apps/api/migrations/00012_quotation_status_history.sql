-- +goose Up
-- +goose StatementBegin

-- ============================================================
-- 00012 — QUOTATION STATUS HISTORY + change/update functions
-- ============================================================
-- Untuk Detail page (timeline status) dan Edit page (atomic update).
--
-- Tabel:
--   * quotation_status_history (id, quotation_id, from→to, note, changed_by, changed_at)
--
-- Trigger:
--   * trg_log_quotation_creation — AFTER INSERT, log entry pertama
--     (from=NULL, to=initial_status). FE timeline punya entry "Created".
--
-- Functions:
--   * fn_change_quotation_status(id, new_status, user_id, note)
--       UPDATE quotations.status + INSERT history dalam 1 transaction.
--   * fn_update_quotation(id, payload..., user_id)
--       Atomic edit (DRAFT only): UPDATE header + DELETE items + INSERT items.
--       Mirror fn_create_quotation tapi UPDATE pattern. Trigger inherit
--       discount_pct + sync vendor cost tetap fire dari INSERT items.
--
-- Backfill: existing quotations dapat 1 entry awal (from=NULL) supaya
--           timeline FE tidak kosong untuk historical data.
-- ============================================================


-- ─── 1. TABEL quotation_status_history ──
CREATE TABLE quotation_status_history (
  id            BIGSERIAL PRIMARY KEY,
  quotation_id  BIGINT NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  from_status   VARCHAR(20),                       -- NULL = initial creation entry
  to_status     VARCHAR(20) NOT NULL,
  note          TEXT,
  changed_by    BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  changed_at    TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_quotation_status_history_quotation
  ON quotation_status_history(quotation_id, changed_at DESC);

COMMENT ON TABLE quotation_status_history IS
  'Timeline perubahan status quotation. Diisi oleh trigger trg_log_quotation_creation (initial) + fn_change_quotation_status (subsequent). Dipakai FE Detail page untuk render timeline.';

-- +goose StatementEnd


-- ─── 2. TRIGGER auto-log creation ──
-- +goose StatementBegin
CREATE FUNCTION trg_fn_log_quotation_creation() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO quotation_status_history
    (quotation_id, from_status, to_status, note, changed_by)
  VALUES
    (NEW.id, NULL, NEW.status, 'Quotation dibuat', NEW.created_by);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd


-- +goose StatementBegin
CREATE TRIGGER trg_log_quotation_creation
AFTER INSERT ON quotations
FOR EACH ROW
EXECUTE FUNCTION trg_fn_log_quotation_creation();
-- +goose StatementEnd


-- ─── 3. fn_change_quotation_status ──
-- +goose StatementBegin
CREATE FUNCTION fn_change_quotation_status(
  p_quotation_id BIGINT,
  p_new_status   TEXT,
  p_user_id      BIGINT,
  p_note         TEXT DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
  v_old_status VARCHAR(20);
BEGIN
  -- Lock row untuk hindari race condition
  SELECT status INTO v_old_status
  FROM quotations
  WHERE id = p_quotation_id
  FOR UPDATE;

  IF v_old_status IS NULL THEN
    RAISE EXCEPTION 'Quotation % not found', p_quotation_id;
  END IF;

  -- No-op kalau sama (idempotent)
  IF v_old_status = p_new_status THEN
    RETURN;
  END IF;

  -- UPDATE header (trigger set_updated_at + bump row_version fire)
  UPDATE quotations
  SET status     = p_new_status,
      updated_by = p_user_id
  WHERE id = p_quotation_id;

  -- INSERT history entry
  INSERT INTO quotation_status_history
    (quotation_id, from_status, to_status, note, changed_by)
  VALUES
    (p_quotation_id, v_old_status, p_new_status, p_note, p_user_id);
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd


-- +goose StatementBegin
COMMENT ON FUNCTION fn_change_quotation_status(BIGINT, TEXT, BIGINT, TEXT) IS
  'Atomic status change: UPDATE quotations.status + INSERT quotation_status_history dalam 1 transaction. Idempotent (no-op kalau status sama). Dipakai oleh PATCH /quotations/{id}/status.';
-- +goose StatementEnd


-- ─── 4. fn_update_quotation (DRAFT-ONLY edit) ──
-- +goose StatementBegin
CREATE FUNCTION fn_update_quotation(
  p_id                 BIGINT,
  p_client_ref_no      TEXT,
  p_vessel_name        TEXT,
  p_payment_terms      TEXT,
  p_validity_days      INT,
  p_discount_pct       NUMERIC(5,2),
  p_shipping_address   TEXT,
  p_shipping_days      INT,
  p_shipping_cost      NUMERIC(15,2),
  p_items              JSONB,
  p_user_id            BIGINT,
  p_notes              TEXT DEFAULT NULL
) RETURNS BIGINT AS $$
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
  --    PO/invoice yang reference items akan diset NULL via FK ON DELETE SET NULL.
  --    Tapi karena status='draft', biasanya belum ada PO/invoice — aman.
  DELETE FROM quotation_items WHERE quotation_id = p_id;

  -- 5. UPDATE header.
  --    discount_pct UPDATE bypass trg_protect_quotation_discount karena
  --    status='draft' (trigger hanya block kalau status != 'draft').
  --    trg_cascade_quotation_discount akan fire tapi affect 0 rows
  --    (items sudah di-DELETE).
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

  -- 6. INSERT product items (trigger inherit discount_pct fire BEFORE INSERT)
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

  -- 7. INSERT shipping line (kalau ada)
  IF p_shipping_cost IS NOT NULL AND p_shipping_cost > 0 THEN
    v_line_no := v_line_no + 1;
    INSERT INTO quotation_items (
      quotation_id, line_number, item_type,
      requested_name,
      qty, unit_id, selling_price,
      ship_destination,
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
      p_user_id, p_user_id
    );
  END IF;

  RETURN p_id;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd


-- +goose StatementBegin
COMMENT ON FUNCTION fn_update_quotation(
  BIGINT, TEXT, TEXT, TEXT, INT, NUMERIC(5,2),
  TEXT, INT, NUMERIC(15,2), JSONB, BIGINT, TEXT
) IS
  'Atomic edit quotation (DRAFT only): UPDATE header + DELETE items + INSERT new items + optional shipping. Block edit kalau status != draft. Dipakai oleh PUT /quotations/{id}.';
-- +goose StatementEnd


-- ─── 5. BACKFILL: tambahkan initial entry untuk quotations existing ──
-- +goose StatementBegin
INSERT INTO quotation_status_history (quotation_id, from_status, to_status, note, changed_by)
SELECT id, NULL, status, 'Backfilled (existed before history table)', created_by
FROM quotations
WHERE NOT EXISTS (
  SELECT 1 FROM quotation_status_history h WHERE h.quotation_id = quotations.id
);
-- +goose StatementEnd


-- +goose Down
-- +goose StatementBegin

DROP FUNCTION IF EXISTS fn_update_quotation(
  BIGINT, TEXT, TEXT, TEXT, INT, NUMERIC(5,2),
  TEXT, INT, NUMERIC(15,2), JSONB, BIGINT, TEXT
);

DROP FUNCTION IF EXISTS fn_change_quotation_status(BIGINT, TEXT, BIGINT, TEXT);

DROP TRIGGER  IF EXISTS trg_log_quotation_creation ON quotations;
DROP FUNCTION IF EXISTS trg_fn_log_quotation_creation();

DROP TABLE IF EXISTS quotation_status_history;

-- +goose StatementEnd
