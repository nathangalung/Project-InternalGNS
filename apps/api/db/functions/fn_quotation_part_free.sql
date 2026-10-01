-- Canonical current body of fn_quotation_part_free (deployed by migration 00078).
CREATE OR REPLACE FUNCTION public.fn_quotation_part_free(p_quotation_id bigint, p_part text, p_user_id bigint)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_holder TEXT;
BEGIN
  SELECT u.name INTO v_holder
  FROM quotation_edit_locks l
  JOIN users u ON u.id = l.user_id
  WHERE l.quotation_id = p_quotation_id AND l.part = p_part
    AND l.user_id <> p_user_id AND l.expires_at > NOW();
  IF FOUND THEN
    RAISE EXCEPTION 'Sedang diubah oleh %.', v_holder USING ERRCODE = 'P0015';
  END IF;
END;
$function$
