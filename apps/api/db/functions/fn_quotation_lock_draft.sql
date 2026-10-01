-- Canonical current body of fn_quotation_lock_draft (deployed by migration 00078).
CREATE OR REPLACE FUNCTION public.fn_quotation_lock_draft(p_quotation_id bigint)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_status VARCHAR(20);
BEGIN
  SELECT status INTO v_status FROM quotations WHERE id = p_quotation_id FOR UPDATE;
  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Quotation % tidak ditemukan.', p_quotation_id USING ERRCODE = 'P0011';
  END IF;
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'Hanya quotation berstatus Draf yang dapat diubah; status saat ini %.',
      fn_quotation_status_label(v_status)
      USING ERRCODE = 'P0013';
  END IF;
END;
$function$
