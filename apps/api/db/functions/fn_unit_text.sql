-- Canonical current body of fn_unit_text (deployed by migration 00109).
CREATE OR REPLACE FUNCTION public.fn_unit_text(p_text text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT NULLIF(btrim(regexp_replace(
           btrim(regexp_replace(upper(p_text), '\s+', ' ', 'g')),
           '\.+$', '')), '')
$function$
