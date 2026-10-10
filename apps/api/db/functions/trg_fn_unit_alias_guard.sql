-- Canonical current body of trg_fn_unit_alias_guard (deployed by migration 00109).
CREATE OR REPLACE FUNCTION public.trg_fn_unit_alias_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.alias := fn_unit_text(NEW.alias);
  IF NEW.alias IS NULL THEN
    RAISE EXCEPTION 'Alias satuan tidak boleh kosong.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM units WHERE fn_unit_text(code) = NEW.alias) THEN
    RAISE EXCEPTION 'Alias satuan % sudah dipakai sebagai kode satuan.', NEW.alias
      USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END;
$function$
