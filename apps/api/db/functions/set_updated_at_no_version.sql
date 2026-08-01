-- Canonical current body of set_updated_at_no_version (deployed by migration 00001).
CREATE OR REPLACE FUNCTION public.set_updated_at_no_version()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$function$
