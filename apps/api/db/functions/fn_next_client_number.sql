-- Canonical current body of fn_next_client_number (deployed by migration 00056).
CREATE OR REPLACE FUNCTION public.fn_next_client_number()
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_number TEXT;
BEGIN
  -- One full cycle visits every number once.
  FOR i IN 1..9999 LOOP
    v_number := LPAD(nextval('company_client_number_seq')::TEXT, 4, '0');
    IF NOT EXISTS (SELECT 1 FROM company_client WHERE number = v_number) THEN
      RETURN v_number;
    END IF;
  END LOOP;
  RAISE EXCEPTION 'Semua nomor klien 4 digit sudah terpakai.'
    USING ERRCODE = 'P0014';
END;
$function$
