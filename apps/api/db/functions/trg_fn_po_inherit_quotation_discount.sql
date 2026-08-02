-- Canonical current body of trg_fn_po_inherit_quotation_discount (deployed by migration 00004).
CREATE OR REPLACE FUNCTION public.trg_fn_po_inherit_quotation_discount()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.discount_pct IS NULL THEN
    SELECT discount_pct INTO NEW.discount_pct
    FROM quotations WHERE id = NEW.quotation_id;
  END IF;
  RETURN NEW;
END;
$function$
