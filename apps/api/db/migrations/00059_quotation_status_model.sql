-- +goose Up

-- 00059 QUOTATION STATUS MODEL
-- Adds the terminal status cancelled (Dibatalkan), reachable from draft, sent
-- and revision. Rejected and cancelled both need a reason. Two moves leave the
-- manual table: sent -> revision now only happens through
-- fn_revise_quotation, which clones the next version as a draft in the same
-- transaction, and sent -> expired only through fn_expire_quotations, the
-- daily job. Expiry is written by no user, so the history column that names
-- the actor becomes nullable. A superseded original no longer accepts request
-- edits, because its requests now live on the clone. Refusals carry typed
-- SQLSTATEs with Indonesian text. The Go map quotations.Transitions mirrors
-- the table below and a test fails when they drift.

ALTER TABLE quotations DROP CONSTRAINT quotations_status_check;
ALTER TABLE quotations
  ADD CONSTRAINT quotations_status_check
  CHECK (status IN ('draft','sent','accepted','rejected','revision','expired','cancelled'));

ALTER TABLE quotation_status_history ALTER COLUMN changed_by DROP NOT NULL;
COMMENT ON COLUMN quotation_status_history.changed_by IS
  'Acting user. NULL marks a system transition (fn_expire_quotations).';

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION fn_quotation_status_label(p_status TEXT)
RETURNS TEXT
LANGUAGE sql
IMMUTABLE
AS $$
  SELECT CASE p_status
    WHEN 'draft'     THEN 'Draf'
    WHEN 'sent'      THEN 'Dikirim'
    WHEN 'revision'  THEN 'Revisi'
    WHEN 'accepted'  THEN 'Disetujui'
    WHEN 'rejected'  THEN 'Ditolak'
    WHEN 'cancelled' THEN 'Dibatalkan'
    WHEN 'expired'   THEN 'Kedaluwarsa'
    ELSE p_status
  END
$$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION fn_change_quotation_status(
  p_quotation_id BIGINT,
  p_new_status   TEXT,
  p_user_id      BIGINT,
  p_note         TEXT DEFAULT NULL
) RETURNS VOID AS $$
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

  IF p_new_status IN ('sent','accepted') THEN
    IF EXISTS (
      SELECT 1 FROM quotation_items
      WHERE quotation_id = p_quotation_id
        AND item_type = 'product'
        AND (selling_price IS NULL OR selling_price <= 0)
    ) THEN
      RAISE EXCEPTION 'Quotation % has unpriced products', p_quotation_id
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
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- Clone a sent quotation.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION fn_revise_quotation(
  p_quotation_id BIGINT,
  p_user_id      BIGINT,
  p_note         TEXT DEFAULT NULL
) RETURNS BIGINT AS $$
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
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- Expire sent quotations past validity.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION fn_expire_quotations(p_today DATE)
RETURNS INTEGER AS $$
DECLARE
  v_count INTEGER;
BEGIN
  -- One replica per run; the key is mirrored in the Go tests.
  IF NOT pg_try_advisory_xact_lock(7431590059) THEN
    RETURN 0;
  END IF;

  -- p_today is the caller's WIB date, so the job's clock can be injected.
  -- The send date follows the session zone, pinned to WIB by the app pool.
  -- The last send is the start; a row without one falls back to its last
  -- update.
  WITH due AS (
    SELECT q.id, q.validity_days,
           COALESCE(s.sent_at, q.updated_at)::date AS sent_on
    FROM quotations q
    LEFT JOIN LATERAL (
      SELECT MAX(h.changed_at) AS sent_at
      FROM quotation_status_history h
      WHERE h.quotation_id = q.id AND h.to_status = 'sent'
    ) s ON TRUE
    WHERE q.status = 'sent'
      AND q.validity_days IS NOT NULL
      AND COALESCE(s.sent_at, q.updated_at)::date + q.validity_days < p_today
    FOR UPDATE OF q SKIP LOCKED
  ),
  upd AS (
    UPDATE quotations q
    SET status = 'expired'
    FROM due
    WHERE q.id = due.id
    RETURNING q.id, due.validity_days, due.sent_on
  ),
  hist AS (
    INSERT INTO quotation_status_history
      (quotation_id, from_status, to_status, note, changed_by)
    SELECT id, 'sent', 'expired',
           format('Kedaluwarsa otomatis: masa berlaku %s hari sejak %s telah lewat.',
                  validity_days, to_char(sent_on, 'DD-MM-YYYY')),
           NULL
    FROM upd
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM hist;

  RETURN v_count;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION trg_fn_qir_lock_parent()
RETURNS TRIGGER AS $$
DECLARE
  v_qid       BIGINT;
  v_status    VARCHAR(20);
BEGIN
  v_qid := COALESCE(NEW.quotation_id, OLD.quotation_id);

  SELECT status INTO v_status
  FROM quotations
  WHERE id = v_qid
  FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Quotation % tidak ditemukan.', v_qid
      USING ERRCODE = 'P0011';
  END IF;

  -- A superseded original keeps its requests frozen.
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'Permintaan barang hanya dapat diubah saat quotation berstatus Draf; status saat ini %.',
      fn_quotation_status_label(v_status)
      USING ERRCODE = 'P0013';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- +goose Down

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION trg_fn_qir_lock_parent()
RETURNS TRIGGER AS $$
DECLARE
  v_qid       BIGINT;
  v_status    VARCHAR(20);
BEGIN
  v_qid := COALESCE(NEW.quotation_id, OLD.quotation_id);

  SELECT status INTO v_status
  FROM quotations
  WHERE id = v_qid
  FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Parent quotation % not found', v_qid
      USING ERRCODE = 'P0011';
  END IF;

  IF v_status NOT IN ('draft', 'revision') THEN
    RAISE EXCEPTION
      'Cannot modify quotation_item_requests: parent quotation % has status "%". Only draft/revision allow request edits.',
      v_qid, v_status
      USING ERRCODE = 'P0013';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION fn_change_quotation_status(
  p_quotation_id BIGINT,
  p_new_status   TEXT,
  p_user_id      BIGINT,
  p_note         TEXT DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
  v_old_status VARCHAR(20);
  v_valid      BOOLEAN;
BEGIN
  SELECT status INTO v_old_status
  FROM quotations
  WHERE id = p_quotation_id
  FOR UPDATE;

  IF v_old_status IS NULL THEN
    RAISE EXCEPTION 'Quotation % not found', p_quotation_id;
  END IF;

  IF v_old_status = p_new_status THEN
    RETURN;
  END IF;

  v_valid := CASE
    WHEN v_old_status = 'draft'    AND p_new_status IN ('sent','expired') THEN TRUE
    WHEN v_old_status = 'sent'     AND p_new_status IN ('accepted','rejected','revision','expired') THEN TRUE
    WHEN v_old_status = 'revision' AND p_new_status IN ('sent','rejected') THEN TRUE
    ELSE FALSE
  END;

  IF NOT v_valid THEN
    RAISE EXCEPTION 'Invalid status transition: % -> % (terminal: accepted/rejected/expired cannot exit)',
      v_old_status, p_new_status;
  END IF;

  IF p_new_status IN ('sent','accepted') THEN
    IF EXISTS (
      SELECT 1 FROM quotation_items
      WHERE quotation_id = p_quotation_id
        AND item_type = 'product'
        AND (selling_price IS NULL OR selling_price <= 0)
    ) THEN
      RAISE EXCEPTION 'Quotation % has unpriced products', p_quotation_id
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
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

DROP FUNCTION IF EXISTS fn_expire_quotations(DATE);
DROP FUNCTION IF EXISTS fn_revise_quotation(BIGINT, BIGINT, TEXT);
DROP FUNCTION IF EXISTS fn_quotation_status_label(TEXT);

-- Down loses the actor-less and cancelled distinctions.
UPDATE quotation_status_history h
SET changed_by = q.created_by
FROM quotations q
WHERE q.id = h.quotation_id AND h.changed_by IS NULL;
ALTER TABLE quotation_status_history ALTER COLUMN changed_by SET NOT NULL;

UPDATE quotations SET status = 'rejected' WHERE status = 'cancelled';
ALTER TABLE quotations DROP CONSTRAINT quotations_status_check;
ALTER TABLE quotations
  ADD CONSTRAINT quotations_status_check
  CHECK (status IN ('draft','sent','accepted','rejected','revision','expired'));
