-- Canonical current body of trg_fn_log_po_creation (deployed by migration 00061).
CREATE OR REPLACE FUNCTION public.trg_fn_log_po_creation()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  INSERT INTO po_status_history (po_id, from_status, to_status, note, changed_by)
  VALUES (NEW.id, NULL, NEW.status, 'PO dibuat', NEW.created_by);
  RETURN NEW;
END;
$function$
