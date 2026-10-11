-- Canonical current body of fn_freeze_quotation_offer (deployed by migration 00112).
CREATE OR REPLACE FUNCTION public.fn_freeze_quotation_offer(p_quotation_id bigint)
 RETURNS void
 LANGUAGE sql
AS $function$
  UPDATE quotation_items qi
     SET offered_name = oi.name,
         offered_impa = oi.impa_code
    FROM items oi
   WHERE qi.quotation_id = p_quotation_id
     AND oi.id = qi.offered_item_id
     AND qi.offered_name IS NULL
$function$
