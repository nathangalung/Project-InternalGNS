-- Canonical current body of fn_quotation_delete_line (deployed by migration 00078).
CREATE OR REPLACE FUNCTION public.fn_quotation_delete_line(p_quotation_id bigint, p_line_id bigint, p_user_id bigint)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
BEGIN
  PERFORM fn_quotation_lock_draft(p_quotation_id);
  PERFORM fn_quotation_line_of(p_quotation_id, p_line_id);
  PERFORM fn_quotation_part_free(p_quotation_id, 'line:' || p_line_id, p_user_id);
  IF (SELECT count(*) FROM quotation_items
      WHERE quotation_id = p_quotation_id AND item_type = 'product') <= 1 THEN
    RAISE EXCEPTION 'Quotation harus memiliki minimal satu baris.' USING ERRCODE = 'P0014';
  END IF;

  DELETE FROM quotation_edit_locks WHERE quotation_id = p_quotation_id AND part = 'line:' || p_line_id;
  DELETE FROM quotation_items WHERE id = p_line_id;

  PERFORM fn_recompute_quotation_totals(p_quotation_id);
  PERFORM fn_quotation_notify(p_quotation_id, 'lines', 'line:' || p_line_id, p_user_id);
END;
$function$
