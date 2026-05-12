-- +goose Up
-- +goose StatementBegin

-- Invoice state transition policy.
-- Allowed:
--   draft -> sent | cancelled
--   sent -> paid | overdue | cancelled
--   overdue -> paid | cancelled
--   paid -> (terminal)
--   cancelled -> (terminal)
-- Idempotent: same status returns silently.

CREATE OR REPLACE FUNCTION fn_change_invoice_status(
  p_invoice_id BIGINT,
  p_target     TEXT,
  p_user_id    BIGINT
) RETURNS VOID AS $$
DECLARE
  v_current VARCHAR(20);
  v_allowed BOOLEAN := FALSE;
BEGIN
  SELECT status INTO v_current
  FROM invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF v_current IS NULL THEN
    RAISE EXCEPTION 'Invoice % not found', p_invoice_id;
  END IF;

  IF p_target NOT IN ('draft','sent','paid','overdue','cancelled') THEN
    RAISE EXCEPTION 'invalid invoice status: %', p_target;
  END IF;

  IF v_current = p_target THEN
    RETURN;
  END IF;

  IF v_current = 'draft'    AND p_target IN ('sent','cancelled')          THEN v_allowed := TRUE; END IF;
  IF v_current = 'sent'     AND p_target IN ('paid','overdue','cancelled') THEN v_allowed := TRUE; END IF;
  IF v_current = 'overdue'  AND p_target IN ('paid','cancelled')           THEN v_allowed := TRUE; END IF;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'invalid transition % -> %', v_current, p_target;
  END IF;

  UPDATE invoices
  SET status     = p_target,
      updated_by = p_user_id
  WHERE id = p_invoice_id;
END;
$$ LANGUAGE plpgsql;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

DROP FUNCTION IF EXISTS fn_change_invoice_status(BIGINT, TEXT, BIGINT);

-- +goose StatementEnd
