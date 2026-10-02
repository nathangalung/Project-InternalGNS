-- Canonical current body of trg_fn_quotation_tax_default (deployed by migration 00084).
CREATE OR REPLACE FUNCTION public.trg_fn_quotation_tax_default()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.dpp_nilai_lain IS NULL OR NEW.ppn_amount IS NULL OR NEW.grand_total IS NULL THEN
    NEW.dpp_nilai_lain := fn_line_dpp(NEW.total - NEW.total_discount);
    NEW.ppn_amount     := fn_line_ppn(NEW.total - NEW.total_discount);
    NEW.grand_total    := NEW.total - NEW.total_discount + NEW.ppn_amount;
  END IF;
  RETURN NEW;
END;
$function$
