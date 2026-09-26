-- Canonical current body of trg_fn_qir_lock_parent (deployed by migration 00059).
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
$function$
