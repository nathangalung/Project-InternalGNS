-- Canonical current body of fn_terms_days (deployed by migration 00110).
-- The day count payment terms name, 1 to 365, after an optional Net and
-- before day, days or hari, with any spacing and case. NULL for any other
-- terms, so fn_create_invoice keeps its 30 day due date.
CREATE OR REPLACE FUNCTION public.fn_terms_days(p_terms text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE WHEN m.n BETWEEN 1 AND 365 THEN m.n END
  FROM (
    SELECT substring(lower(btrim(p_terms)) FROM '^(?:net\s*)?(\d{1,3})\s*(?:days?|hari)$')::int AS n
  ) m
$function$
