-- Canonical current body of fn_quotation_unlock (deployed by migration 00078).
CREATE OR REPLACE FUNCTION public.fn_quotation_unlock(p_quotation_id bigint, p_part text, p_user_id bigint)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  DELETE FROM quotation_edit_locks
  WHERE quotation_id = p_quotation_id AND part = p_part AND user_id = p_user_id;
  IF FOUND THEN
    PERFORM fn_quotation_notify(p_quotation_id, 'unlocked', p_part, p_user_id);
  END IF;
END;
$function$
