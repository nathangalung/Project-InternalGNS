-- +goose Up
-- +goose StatementBegin

-- 00013 — STATUS CHECK CONSTRAINT + TRANSITION VALIDATION
-- Tightening two integrity rules:
-- 1. Replace existing CHECK quotations.status (from 00001) with
-- updated list:
-- BEFORE: ('draft','sent','accepted','rejected','revised')
-- AFTER:  ('draft','sent','accepted','rejected','revision','expired')
-- Rename 'revised' → 'revision' (correct noun form).
-- Add 'expired' for quotations past validity_days.
-- 2. fn_change_quotation_status now validates state machine:
-- - draft     → sent | expired
-- - sent      → accepted | rejected | revision | expired
-- - revision  → sent | rejected
-- - accepted, rejected, expired = TERMINAL
-- FE uses localized labels. DB uses canonical English.
-- FE maps labels in translation layer (not DB).


-- 1. Migrate existing data: 'revised' → 'revision'
UPDATE quotations SET status = 'revision' WHERE status = 'revised';


-- 2. DROP old CHECK + ADD new CHECK
ALTER TABLE quotations DROP CONSTRAINT quotations_status_check;

ALTER TABLE quotations
  ADD CONSTRAINT quotations_status_check
  CHECK (status IN ('draft','sent','accepted','rejected','revision','expired'));

COMMENT ON CONSTRAINT quotations_status_check ON quotations IS
  'Canonical status values. FE labels mapped in translation layer (FE), not in DB. expired = quotation past validity_days, set via job/cron.';

-- +goose StatementEnd


-- 3. fn_change_quotation_status with transition validation
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
  -- Lock row to prevent race condition
  SELECT status INTO v_old_status
  FROM quotations
  WHERE id = p_quotation_id
  FOR UPDATE;

  IF v_old_status IS NULL THEN
    RAISE EXCEPTION 'Quotation % not found', p_quotation_id;
  END IF;

  -- No-op if same status (idempotent)
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
    RAISE EXCEPTION 'Invalid status transition: % -> % (terminal: accepted/rejected/expired cannot exit)',
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
  'Atomic status change with state machine validation. Transitions: draft -> sent|expired; sent -> accepted|rejected|revision|expired; revision -> sent|rejected. accepted/rejected/expired = terminal. Idempotent. Raises exception for invalid transition.';
-- +goose StatementEnd


-- +goose Down
-- +goose StatementBegin

-- Revert fn to version without validation (from 00012)
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

-- Revert CHECK constraint to version 00001
ALTER TABLE quotations DROP CONSTRAINT quotations_status_check;

-- Revert data migration (revision → revised)
UPDATE quotations SET status = 'revised' WHERE status = 'revision';

ALTER TABLE quotations
  ADD CONSTRAINT quotations_status_check
  CHECK (status IN ('draft','sent','accepted','rejected','revised'));

-- +goose StatementEnd
