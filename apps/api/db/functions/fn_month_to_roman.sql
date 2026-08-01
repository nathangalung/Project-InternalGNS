-- Canonical current body of fn_month_to_roman (deployed by migration 00007).
CREATE OR REPLACE FUNCTION public.fn_month_to_roman(p_month integer)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE p_month
    WHEN 1  THEN 'I'    WHEN 2  THEN 'II'   WHEN 3  THEN 'III'
    WHEN 4  THEN 'IV'   WHEN 5  THEN 'V'    WHEN 6  THEN 'VI'
    WHEN 7  THEN 'VII'  WHEN 8  THEN 'VIII' WHEN 9  THEN 'IX'
    WHEN 10 THEN 'X'    WHEN 11 THEN 'XI'   WHEN 12 THEN 'XII'
  END;
$function$
