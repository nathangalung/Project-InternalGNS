-- Canonical current body of trg_fn_qir_impa (deployed by migration 00113).
CREATE OR REPLACE FUNCTION public.trg_fn_qir_impa()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  s record;
BEGIN
  s := fn_impa_split(NEW.request_text, NEW.request_impa);
  NEW.request_text := s.name;
  NEW.request_impa := s.code;
  RETURN NEW;
END;
$function$
