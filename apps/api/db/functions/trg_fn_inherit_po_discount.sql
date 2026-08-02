-- Canonical current body of trg_fn_inherit_po_discount (deployed by migration 00004).
CREATE OR REPLACE FUNCTION public.trg_fn_inherit_po_discount()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.discount_pct IS NULL THEN
    SELECT discount_pct INTO NEW.discount_pct
    FROM purchase_orders WHERE id = NEW.po_id;
  END IF;
  RETURN NEW;
END;
$function$
