-- Canonical current body of fn_quotation_part_held (deployed by migration 00078).
CREATE OR REPLACE FUNCTION public.fn_quotation_part_held(p_quotation_id bigint, p_part text, p_user_id bigint)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  PERFORM fn_quotation_part_free(p_quotation_id, p_part, p_user_id);
  IF NOT EXISTS (
    SELECT 1 FROM quotation_edit_locks
    WHERE quotation_id = p_quotation_id AND part = p_part
      AND user_id = p_user_id AND expires_at > NOW()
  ) THEN
    RAISE EXCEPTION 'Waktu mengubah bagian ini sudah habis. Buka lagi lalu simpan kembali.'
      USING ERRCODE = 'P0015';
  END IF;
END;
$function$
