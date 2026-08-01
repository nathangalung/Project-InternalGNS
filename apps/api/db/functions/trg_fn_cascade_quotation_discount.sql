-- Canonical current body of trg_fn_cascade_quotation_discount (deployed by migration 00004).
CREATE OR REPLACE FUNCTION public.trg_fn_cascade_quotation_discount()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE quotation_items
  SET discount_pct = NEW.discount_pct
  WHERE quotation_id = NEW.id;
  RETURN NEW;
END;
$function$
