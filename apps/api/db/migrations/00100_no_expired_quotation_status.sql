-- +goose Up
-- 00100 NO EXPIRED QUOTATION STATUS
-- The owner retired Kedaluwarsa: nothing expires on its own any more. A
-- sent quotation stays Dikirim until a user accepts, rejects, cancels or
-- revises it. Every expired quotation goes back to sent, and the sent ->
-- expired history rows go with it: the expiry job and the import wrote them,
-- never a user. validity_days stays required to send, since the PDF prints
-- the Validity. fn_expire_quotations is dropped with the status.

DELETE FROM quotation_status_history WHERE to_status = 'expired';

-- Without a row_version bump, so no open edit goes stale.
ALTER TABLE quotations DISABLE TRIGGER trg_quotations_updated_at;
UPDATE quotations SET status = 'sent' WHERE status = 'expired';
ALTER TABLE quotations ENABLE TRIGGER trg_quotations_updated_at;

ALTER TABLE quotations DROP CONSTRAINT quotations_status_check;
ALTER TABLE quotations
  ADD CONSTRAINT quotations_status_check
  CHECK (status IN ('draft','sent','accepted','rejected','revision','cancelled'));

COMMENT ON COLUMN quotation_status_history.changed_by IS 'Acting user.';

DROP FUNCTION fn_expire_quotations(date);

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_quotation_status_label(p_status text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE p_status
    WHEN 'draft'     THEN 'Draf'
    WHEN 'sent'      THEN 'Dikirim'
    WHEN 'revision'  THEN 'Revisi'
    WHEN 'accepted'  THEN 'Disetujui'
    WHEN 'rejected'  THEN 'Ditolak'
    WHEN 'cancelled' THEN 'Dibatalkan'
    ELSE p_status
  END
$function$
;
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
$function$
;
-- +goose StatementEnd

COMMENT ON FUNCTION fn_change_quotation_status(bigint, text, bigint, text) IS
  'Atomic status change, mirrored by quotations.Transitions: draft -> sent|cancelled; sent -> accepted|rejected|cancelled; revision -> rejected|cancelled. accepted, rejected and cancelled are terminal. Idempotent.';

-- +goose Down
-- Restores the schema only: the moved rows stay sent.

ALTER TABLE quotations DROP CONSTRAINT quotations_status_check;
ALTER TABLE quotations
  ADD CONSTRAINT quotations_status_check
  CHECK (status IN ('draft','sent','accepted','rejected','revision','expired','cancelled'));

COMMENT ON COLUMN quotation_status_history.changed_by IS
  'Acting user. NULL marks a system transition (fn_expire_quotations).';

COMMENT ON FUNCTION fn_change_quotation_status(bigint, text, bigint, text) IS
  'Atomic status change with state machine validation. Transitions: draft -> sent|expired; sent -> accepted|rejected|revision|expired; revision -> sent|rejected. accepted/rejected/expired = terminal. Idempotent. Raises exception for invalid transition.';

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_quotation_status_label(p_status text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
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
$function$
;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_expire_quotations(p_today date)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
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
$function$
;
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
