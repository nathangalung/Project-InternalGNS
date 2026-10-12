-- Canonical current body of trg_fn_items_impa (deployed by migration 00113).
CREATE OR REPLACE FUNCTION public.trg_fn_items_impa()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  s record;
BEGIN
  -- A code is unique among active products, so a trigger never moves one
  -- out of a name: a bulk load could give it to the wrong row first. The
  -- API and the import move it after checking who holds it.
  s := fn_impa_split(NEW.name, NEW.impa_code, false);
  NEW.name := s.name;
  NEW.impa_code := s.code;
  RETURN NEW;
END;
$function$
