-- Canonical current body of trg_fn_items_impa (deployed by migration 00113).
CREATE OR REPLACE FUNCTION public.trg_fn_items_impa()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_code text := fn_impa_code(NEW.impa_code);
  s      record;
BEGIN
  s := fn_impa_split(NEW.name, v_code);
  -- A code named in the text moves only to a code no other active
  -- product holds.
  IF v_code IS NULL AND s.code IS NOT NULL AND EXISTS (
       SELECT 1 FROM items i
        WHERE i.impa_code = s.code AND i.is_active AND i.id IS DISTINCT FROM NEW.id) THEN
    NEW.impa_code := NULL;
    RETURN NEW;
  END IF;
  NEW.name := s.name;
  NEW.impa_code := s.code;
  RETURN NEW;
END;
$function$
