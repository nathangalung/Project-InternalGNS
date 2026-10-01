-- Canonical current body of fn_quotation_set_line_offer (deployed by migration 00078).
CREATE OR REPLACE FUNCTION public.fn_quotation_set_line_offer(p_quotation_id bigint, p_line_id bigint, p_available boolean, p_user_id bigint)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  PERFORM fn_quotation_lock_draft(p_quotation_id);
  PERFORM fn_quotation_line_of(p_quotation_id, p_line_id);
  PERFORM fn_quotation_part_free(p_quotation_id, 'line:' || p_line_id, p_user_id);

  IF p_available THEN
    -- Back on offer: the line is priced again by hand.
    UPDATE quotation_items SET is_available = TRUE, updated_by = p_user_id WHERE id = p_line_id;
  ELSE
    -- Tidak Ditawarkan, as fn_prepare_quotation_lines stores it.
    UPDATE quotation_items
    SET is_available = FALSE, selling_price = 0, cost_price = NULL,
        vendor_product_id = NULL, update_vendor_price = FALSE, updated_by = p_user_id
    WHERE id = p_line_id;
  END IF;

  PERFORM fn_recompute_quotation_totals(p_quotation_id);
  PERFORM fn_quotation_notify(p_quotation_id, 'line', 'line:' || p_line_id, p_user_id);
END;
$function$
