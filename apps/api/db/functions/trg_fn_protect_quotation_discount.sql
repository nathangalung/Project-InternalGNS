-- Canonical current body of trg_fn_protect_quotation_discount (deployed by migration 00103).
CREATE OR REPLACE FUNCTION public.trg_fn_protect_quotation_discount()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.discount_pct IS DISTINCT FROM OLD.discount_pct
     AND OLD.status != 'draft' THEN
    RAISE EXCEPTION
      'Diskon quotation % hanya dapat diubah saat berstatus Draf. Status saat ini %. Buat revisi untuk mengubahnya.',
      OLD.quotation_no, fn_quotation_status_label(OLD.status)
      USING ERRCODE = 'P0013';
  END IF;
  RETURN NEW;
END;
$function$
