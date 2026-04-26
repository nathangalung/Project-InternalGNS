-- +goose Up
-- +goose StatementBegin

-- ============================================================
-- 00013 — STATUS CHECK CONSTRAINT + TRANSITION VALIDATION
-- ============================================================
-- Tightening dua aturan integritas:
--
--   1. Replace existing CHECK quotations.status (dari 00001) dengan
--      list yang updated:
--        SEBELUM: ('draft','sent','accepted','rejected','revised')
--        SESUDAH: ('draft','sent','accepted','rejected','revision','expired')
--      Plus rename 'revised' → 'revision' (lebih grammatically tepat
--      sebagai noun status). Plus tambah 'expired' untuk quotation
--      yang lewat validity_days.
--
--   2. fn_change_quotation_status sekarang validate state machine:
--      - draft     → sent | expired
--      - sent      → accepted | rejected | revision | expired
--      - revision  → sent | rejected
--      - accepted, rejected, expired = TERMINAL
--
-- FE pakai label Bahasa (Disetujui, Dikirim, dll). DB pakai canonical
-- English. FE wajib map bolak-balik di translation layer (bukan DB).
-- ============================================================


-- ─── 1. Migrate existing data: 'revised' → 'revision' ──
UPDATE quotations SET status = 'revision' WHERE status = 'revised';


-- ─── 2. DROP old CHECK + ADD new CHECK ──
ALTER TABLE quotations DROP CONSTRAINT quotations_status_check;

ALTER TABLE quotations
  ADD CONSTRAINT quotations_status_check
  CHECK (status IN ('draft','sent','accepted','rejected','revision','expired'));

COMMENT ON CONSTRAINT quotations_status_check ON quotations IS
  'Canonical status values. FE label Bahasa di-map di translation layer (FE), bukan di DB. expired = quotation lewat validity_days, di-set via job/cron.';

-- +goose StatementEnd


-- ─── 3. fn_change_quotation_status dengan transition validation ──
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

  -- Validate transition (state machine)
  v_valid := CASE
    WHEN v_old_status = 'draft'    AND p_new_status IN ('sent','expired') THEN TRUE
    WHEN v_old_status = 'sent'     AND p_new_status IN ('accepted','rejected','revision','expired') THEN TRUE
    WHEN v_old_status = 'revision' AND p_new_status IN ('sent','rejected') THEN TRUE
    ELSE FALSE
  END;

  IF NOT v_valid THEN
    RAISE EXCEPTION 'Invalid status transition: % -> % (terminal: accepted/rejected/expired tidak bisa keluar)',
      v_old_status, p_new_status;
  END IF;

  -- UPDATE header
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
  'Atomic status change dengan state machine validation. Transitions: draft -> sent|expired; sent -> accepted|rejected|revision|expired; revision -> sent|rejected. accepted/rejected/expired = terminal. Idempotent. Raise exception untuk invalid transition.';
-- +goose StatementEnd


-- +goose Down
-- +goose StatementBegin

-- Revert fn ke versi tanpa validation (dari 00012)
CREATE OR REPLACE FUNCTION fn_change_quotation_status(
  p_quotation_id BIGINT,
  p_new_status   TEXT,
  p_user_id      BIGINT,
  p_note         TEXT DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
  v_old_status VARCHAR(20);
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

  UPDATE quotations
  SET status     = p_new_status,
      updated_by = p_user_id
  WHERE id = p_quotation_id;

  INSERT INTO quotation_status_history
    (quotation_id, from_status, to_status, note, changed_by)
  VALUES
    (p_quotation_id, v_old_status, p_new_status, p_note, p_user_id);
END;
$$ LANGUAGE plpgsql;

-- Revert CHECK constraint ke versi 00001
ALTER TABLE quotations DROP CONSTRAINT quotations_status_check;

-- Revert data migration
UPDATE quotations SET status = 'revised' WHERE status = 'revision';

ALTER TABLE quotations
  ADD CONSTRAINT quotations_status_check
  CHECK (status IN ('draft','sent','accepted','rejected','revised'));

-- +goose StatementEnd
