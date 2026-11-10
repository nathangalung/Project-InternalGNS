-- Canonical current body of fn_refuse_retired_unit (deployed by migration 00122).
CREATE OR REPLACE FUNCTION public.fn_refuse_retired_unit(p_unit smallint, p_kept smallint, p_column text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_code TEXT;
BEGIN
  -- No unit, or the one the row already has, is always fine.
  IF p_unit IS NULL OR p_unit IS NOT DISTINCT FROM p_kept THEN
    RETURN;
  END IF;
  SELECT code INTO v_code FROM units WHERE id = p_unit AND NOT is_active;
  IF FOUND THEN
    RAISE EXCEPTION 'Satuan % sudah tidak dipakai. Pilih satuan lain.', v_code
      USING ERRCODE = 'P0014', COLUMN = COALESCE(p_column, '');
  END IF;
END;
$function$
