-- Canonical current body of fn_line_ppn (deployed by migration 00086).
CREATE OR REPLACE FUNCTION public.fn_line_ppn(p_subtotal numeric)
 RETURNS numeric
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT ROUND(ROUND(p_subtotal * 11.0 / 12.0, 2) * 0.12, 2);
$function$
