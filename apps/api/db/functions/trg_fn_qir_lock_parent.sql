-- Canonical current body of trg_fn_qir_lock_parent (deployed by migration 00046).
CREATE OR REPLACE FUNCTION public.trg_fn_qir_lock_parent()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
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
$function$
