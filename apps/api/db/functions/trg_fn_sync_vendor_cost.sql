-- Canonical current body of trg_fn_sync_vendor_cost (deployed by migration 00002).
CREATE OR REPLACE FUNCTION public.trg_fn_sync_vendor_cost()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.update_vendor_price = TRUE
     AND NEW.vendor_product_id IS NOT NULL
     AND NEW.cost_price IS NOT NULL THEN

    UPDATE vendor_products
    SET cost_price     = NEW.cost_price,
        last_quoted_at = NOW()
    WHERE id = NEW.vendor_product_id;

  END IF;
  RETURN NEW;
END;
$function$
