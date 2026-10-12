-- Canonical current body of fn_impa_code (deployed by migration 00113).
CREATE OR REPLACE FUNCTION public.fn_impa_code(p_code text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  v_raw  text := regexp_replace(p_code, '^\s+|\s+$', '', 'g');
  v_code text;
BEGIN
  -- Blank or the shown placeholder is no code.
  IF v_raw IS NULL OR translate(v_raw, '-' || chr(8211) || chr(8212), '') = '' THEN
    RETURN NULL;
  END IF;
  v_code := upper(v_raw);
  IF v_code ~ '^\(.*\)$' THEN
    v_code := regexp_replace(substr(v_code, 2, length(v_code) - 2), '^\s+|\s+$', '', 'g');
  END IF;
  v_code := regexp_replace(v_code, '^IMPA\s*[:.#]?\s*', '');
  IF v_code ~ '^[0-9][0-9 .-]*[0-9]$'
     AND length(regexp_replace(v_code, '[^0-9]', '', 'g')) = 6 THEN
    RETURN regexp_replace(v_code, '[^0-9]', '', 'g');
  END IF;
  -- Anything else is kept as typed, so a CHECK refuses it.
  RETURN v_raw;
END;
$function$
