-- Canonical current body of trg_fn_protect_quotation_discount (deployed by migration 00004).
CREATE OR REPLACE FUNCTION public.trg_fn_protect_quotation_discount()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.discount_pct IS DISTINCT FROM OLD.discount_pct
     AND OLD.status != 'draft' THEN
    RAISE EXCEPTION
      'Cannot modify discount_pct on quotation % (status %). Create new version (revision) instead.',
      OLD.quotation_no, OLD.status;
  END IF;
  RETURN NEW;
END;
$function$
