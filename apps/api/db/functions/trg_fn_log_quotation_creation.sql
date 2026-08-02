-- Canonical current body of trg_fn_log_quotation_creation (deployed by migration 00012).
CREATE OR REPLACE FUNCTION public.trg_fn_log_quotation_creation()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  INSERT INTO quotation_status_history
    (quotation_id, from_status, to_status, note, changed_by)
  VALUES
    (NEW.id, NULL, NEW.status, 'Quotation dibuat', NEW.created_by);
  RETURN NEW;
END;
$function$
