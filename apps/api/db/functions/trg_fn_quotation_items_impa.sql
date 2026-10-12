-- Canonical current body of trg_fn_quotation_items_impa (deployed by migration 00113).
CREATE OR REPLACE FUNCTION public.trg_fn_quotation_items_impa()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  s record;
BEGIN
  s := fn_impa_split(NEW.requested_name, NEW.requested_impa);
  NEW.requested_name := s.name;
  NEW.requested_impa := s.code;
  -- The offer copies the catalog, so it never takes a code from its name.
  s := fn_impa_split(NEW.offered_name, NEW.offered_impa, false);
  NEW.offered_name := s.name;
  NEW.offered_impa := s.code;
  RETURN NEW;
END;
$function$
