-- Canonical current body of trg_fn_unit_code_guard (deployed by migration 00109).
CREATE OR REPLACE FUNCTION public.trg_fn_unit_code_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM unit_aliases WHERE alias = fn_unit_text(NEW.code)) THEN
    RAISE EXCEPTION 'Kode satuan % sudah dipakai sebagai alias satuan.', NEW.code
      USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END;
$function$
