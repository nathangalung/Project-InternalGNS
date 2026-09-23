-- +goose Up

-- Invoice payment and status timeline.
--
-- 1. paid_at stamps when an invoice was marked paid, and payment_proof_key
--    holds the optional object key of the transfer receipt. Invoices already
--    paid keep paid_at NULL: their payment date was never recorded, and
--    inventing one would restate a filed invoice.
-- 2. invoice_status_history records every transition with its reason, proof
--    key and actor, as quotation_status_history does for quotations. A
--    no-op save writes nothing.
-- 3. fn_change_invoice_status takes the reason and the proof key. Its
--    transition table is mirrored by invoices.Transitions in Go:
--      draft          -> sent, cancelled
--      sent, overdue  -> paid, cancelled
--    Terlambat is derived from the due date, so sent -> overdue is no longer
--    a stored move; a legacy stored overdue still reaches paid or cancelled.
--    A cancel needs a reason and a PO, since a cancelled invoice is only a
--    correction when its Pengganti can be issued for that PO.

ALTER TABLE invoices
  ADD COLUMN paid_at           TIMESTAMPTZ,
  ADD COLUMN payment_proof_key TEXT;

CREATE TABLE invoice_status_history (
  id                BIGSERIAL PRIMARY KEY,
  invoice_id        BIGINT NOT NULL REFERENCES invoices(id) ON DELETE CASCADE,
  from_status       VARCHAR(20) NOT NULL,
  to_status         VARCHAR(20) NOT NULL,
  note              TEXT,
  payment_proof_key TEXT,
  changed_by        BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  changed_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_invoice_status_history_invoice
  ON invoice_status_history (invoice_id, changed_at);

-- A new argument list is a new function, so drop the old one first rather
-- than leave an overload the 3-argument call would still resolve to.
DROP FUNCTION IF EXISTS fn_change_invoice_status(bigint, text, bigint);

-- +goose StatementBegin
CREATE FUNCTION fn_change_invoice_status(
  p_invoice_id bigint,
  p_target     text,
  p_user_id    bigint,
  p_note       text DEFAULT NULL,
  p_proof_key  text DEFAULT NULL
)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_current VARCHAR(20);
  v_po_id   BIGINT;
  v_note    TEXT := NULLIF(btrim(p_note), '');
  v_proof   TEXT := NULLIF(btrim(p_proof_key), '');
  v_allowed BOOLEAN := FALSE;
BEGIN
  SELECT status, po_id INTO v_current, v_po_id
  FROM invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice % not found', p_invoice_id
      USING ERRCODE = 'P0011';
  END IF;

  IF p_target NOT IN ('draft','sent','paid','overdue','cancelled') THEN
    RAISE EXCEPTION 'Status invoice tidak dikenal.'
      USING ERRCODE = 'P0014';
  END IF;

  IF v_current = p_target THEN
    RETURN;
  END IF;

  -- Mirrored by invoices.Transitions.
  IF v_current = 'draft' AND p_target IN ('sent','cancelled') THEN
    v_allowed := TRUE;
  END IF;
  IF v_current IN ('sent','overdue') AND p_target IN ('paid','cancelled') THEN
    v_allowed := TRUE;
  END IF;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Perubahan status invoice ini tidak diizinkan.'
      USING ERRCODE = 'P0012';
  END IF;

  IF p_target = 'cancelled' AND v_note IS NULL THEN
    RAISE EXCEPTION 'Alasan pembatalan invoice wajib diisi.'
      USING ERRCODE = 'P0014';
  END IF;

  IF p_target = 'cancelled' AND v_po_id IS NULL THEN
    RAISE EXCEPTION 'Invoice tanpa PO tidak dapat dibatalkan karena invoice penggantinya tidak dapat diterbitkan.'
      USING ERRCODE = 'P0012';
  END IF;

  IF v_proof IS NOT NULL AND p_target <> 'paid' THEN
    RAISE EXCEPTION 'Bukti pembayaran hanya dapat dilampirkan saat invoice ditandai Dibayar.'
      USING ERRCODE = 'P0014';
  END IF;

  UPDATE invoices
  SET status            = p_target,
      paid_at           = CASE WHEN p_target = 'paid' THEN NOW() ELSE paid_at END,
      payment_proof_key = CASE WHEN p_target = 'paid' THEN v_proof ELSE payment_proof_key END,
      updated_by        = p_user_id
  WHERE id = p_invoice_id;

  INSERT INTO invoice_status_history
    (invoice_id, from_status, to_status, note, payment_proof_key, changed_by)
  VALUES
    (p_invoice_id, v_current, p_target, v_note, v_proof, p_user_id);
END;
$function$;
-- +goose StatementEnd

-- +goose Down
DROP FUNCTION IF EXISTS fn_change_invoice_status(bigint, text, bigint, text, text);

-- +goose StatementBegin
CREATE FUNCTION fn_change_invoice_status(p_invoice_id bigint, p_target text, p_user_id bigint)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_current VARCHAR(20);
  v_allowed BOOLEAN := FALSE;
BEGIN
  SELECT status INTO v_current
  FROM invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF v_current IS NULL THEN
    RAISE EXCEPTION 'Invoice % not found', p_invoice_id
      USING ERRCODE = 'P0011';
  END IF;

  IF p_target NOT IN ('draft','sent','paid','overdue','cancelled') THEN
    RAISE EXCEPTION 'invalid invoice status: %', p_target
      USING ERRCODE = 'P0014';
  END IF;

  IF v_current = p_target THEN
    RETURN;
  END IF;

  IF v_current = 'draft'    AND p_target IN ('sent','cancelled')          THEN v_allowed := TRUE; END IF;
  IF v_current = 'sent'     AND p_target IN ('paid','overdue','cancelled') THEN v_allowed := TRUE; END IF;
  IF v_current = 'overdue'  AND p_target IN ('paid','cancelled')           THEN v_allowed := TRUE; END IF;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'invalid transition % -> %', v_current, p_target
      USING ERRCODE = 'P0012';
  END IF;

  UPDATE invoices
  SET status     = p_target,
      updated_by = p_user_id
  WHERE id = p_invoice_id;
END;
$function$;
-- +goose StatementEnd

DROP TABLE IF EXISTS invoice_status_history;
ALTER TABLE invoices
  DROP COLUMN IF EXISTS payment_proof_key,
  DROP COLUMN IF EXISTS paid_at;
