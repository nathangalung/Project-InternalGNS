-- Canonical current body of fn_quotation_lock (deployed by migration 00078).
CREATE OR REPLACE FUNCTION public.fn_quotation_lock(p_quotation_id bigint, p_part text, p_user_id bigint, p_ttl_seconds integer)
 RETURNS timestamp with time zone
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_expires TIMESTAMPTZ;
  v_renewal BOOLEAN;
BEGIN
  PERFORM fn_quotation_lock_draft(p_quotation_id);
  IF p_part <> 'header' THEN
    IF p_part !~ '^line:[1-9][0-9]*$' THEN
      RAISE EXCEPTION 'Bagian quotation tidak dikenal.' USING ERRCODE = 'P0014';
    END IF;
    PERFORM fn_quotation_line_of(p_quotation_id, substring(p_part FROM 6)::BIGINT);
  END IF;
  PERFORM fn_quotation_part_free(p_quotation_id, p_part, p_user_id);

  SELECT TRUE INTO v_renewal FROM quotation_edit_locks
  WHERE quotation_id = p_quotation_id AND part = p_part
    AND user_id = p_user_id AND expires_at > NOW();

  INSERT INTO quotation_edit_locks (quotation_id, part, user_id, expires_at)
  VALUES (p_quotation_id, p_part, p_user_id, NOW() + make_interval(secs => p_ttl_seconds))
  ON CONFLICT (quotation_id, part) DO UPDATE
     SET user_id = EXCLUDED.user_id, expires_at = EXCLUDED.expires_at
  RETURNING expires_at INTO v_expires;

  -- A heartbeat changes nothing anyone sees.
  IF v_renewal IS NULL THEN
    PERFORM fn_quotation_notify(p_quotation_id, 'locked', p_part, p_user_id);
  END IF;
  RETURN v_expires;
END;
$function$
