-- Canonical current body of trg_fn_refresh_draft_invoice_buyer (deployed by migration 00095).
CREATE OR REPLACE FUNCTION public.trg_fn_refresh_draft_invoice_buyer()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE invoices
  SET buyer_name    = NEW.name,
      buyer_npwp    = NEW.npwp,
      buyer_address = NEW.address
  WHERE company_client_id = NEW.id
    AND status = 'draft'
    AND (buyer_name, buyer_npwp, buyer_address)
        IS DISTINCT FROM (NEW.name, NEW.npwp, NEW.address);
  RETURN NULL;
END;
$function$
