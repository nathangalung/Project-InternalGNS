-- Canonical current body of fn_quotation_update_line (deployed by migration 00078).
CREATE OR REPLACE FUNCTION public.fn_quotation_update_line(p_quotation_id bigint, p_line_id bigint, p_item jsonb, p_user_id bigint)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_item JSONB;
BEGIN
  PERFORM fn_quotation_lock_draft(p_quotation_id);
  PERFORM fn_quotation_line_of(p_quotation_id, p_line_id);
  PERFORM fn_quotation_part_held(p_quotation_id, 'line:' || p_line_id, p_user_id);
  v_item := fn_prepare_quotation_lines(jsonb_build_array(p_item), p_user_id) -> 0;

  UPDATE quotation_items SET
    requested_item_id   = NULLIF((v_item->>'requested_item_id'),'')::BIGINT,
    requested_impa      = v_item->>'requested_impa',
    requested_name      = v_item->>'requested_name',
    offered_item_id     = NULLIF((v_item->>'offered_item_id'),'')::BIGINT,
    vendor_product_id   = NULLIF((v_item->>'vendor_product_id'),'')::BIGINT,
    qty                 = (v_item->>'qty')::NUMERIC(12,2),
    unit_id             = (v_item->>'unit_id')::SMALLINT,
    selling_price       = (v_item->>'selling_price')::NUMERIC(15,2),
    cost_price          = NULLIF((v_item->>'cost_price'),'')::NUMERIC(15,2),
    is_available        = COALESCE((v_item->>'is_available')::BOOLEAN, TRUE),
    ship_destination    = v_item->>'ship_destination',
    due_date            = NULLIF((v_item->>'due_date'),'')::DATE,
    update_vendor_price = COALESCE((v_item->>'update_vendor_price')::BOOLEAN, FALSE),
    updated_by          = p_user_id
  WHERE id = p_line_id;

  PERFORM fn_recompute_quotation_totals(p_quotation_id);
  PERFORM fn_quotation_notify(p_quotation_id, 'line', 'line:' || p_line_id, p_user_id);
END;
$function$
