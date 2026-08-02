-- Canonical current body of fn_change_invoice_status (deployed by migration 00046).
CREATE OR REPLACE FUNCTION public.fn_change_invoice_status(p_invoice_id bigint, p_target text, p_user_id bigint)
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
$function$
