-- Canonical current body of fn_quotation_no_other_editors (deployed by migration 00078).
CREATE OR REPLACE FUNCTION public.fn_quotation_no_other_editors(p_quotation_id bigint, p_user_id bigint)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_holder TEXT;
BEGIN
  SELECT u.name INTO v_holder
  FROM quotation_edit_locks l
  JOIN users u ON u.id = l.user_id
  WHERE l.quotation_id = p_quotation_id AND l.user_id <> p_user_id AND l.expires_at > NOW()
  ORDER BY l.expires_at DESC
  LIMIT 1;
  IF FOUND THEN
    RAISE EXCEPTION 'Quotation sedang diubah oleh %. Tunggu sampai selesai.', v_holder
      USING ERRCODE = 'P0015';
  END IF;
END;
$function$
