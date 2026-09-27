-- Canonical current body of trg_fn_lock_client_number (deployed by migration 00072).
CREATE OR REPLACE FUNCTION public.trg_fn_lock_client_number()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.number IS DISTINCT FROM OLD.number
     AND EXISTS (SELECT 1 FROM quotations WHERE company_client_id = OLD.id) THEN
    RAISE EXCEPTION 'Nomor klien tidak dapat diubah karena sudah dipakai pada penawaran.'
      USING ERRCODE = 'P0013';
  END IF;
  RETURN NEW;
END;
$function$
