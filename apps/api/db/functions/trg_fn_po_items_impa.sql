-- Canonical current body of trg_fn_po_items_impa (deployed by migration 00113).
CREATE OR REPLACE FUNCTION public.trg_fn_po_items_impa()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  s record;
BEGIN
  -- A PO line copies its quotation's offer.
  s := fn_impa_split(NEW.item_name, NEW.item_code, false);
  NEW.item_name := s.name;
  NEW.item_code := s.code;
  RETURN NEW;
END;
$function$
