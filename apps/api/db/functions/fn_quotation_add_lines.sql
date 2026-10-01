-- Canonical current body of fn_quotation_add_lines (deployed by migration 00078).
CREATE OR REPLACE FUNCTION public.fn_quotation_add_lines(p_quotation_id bigint, p_items jsonb, p_user_id bigint)
 RETURNS bigint[]
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_items JSONB;
  v_item  JSONB;
  v_next  SMALLINT;
  v_id    BIGINT;
  v_ids   BIGINT[] := '{}';
BEGIN
  PERFORM fn_quotation_lock_draft(p_quotation_id);
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Tambahkan minimal satu baris produk.' USING ERRCODE = 'P0014';
  END IF;
  v_items := fn_prepare_quotation_lines(p_items, p_user_id);

  SELECT COALESCE(MAX(line_number), 0) INTO v_next
  FROM quotation_items WHERE quotation_id = p_quotation_id AND item_type = 'product';
  -- The shipping line stays last.
  UPDATE quotation_items
  SET line_number = v_next + jsonb_array_length(v_items) + 1
  WHERE quotation_id = p_quotation_id AND item_type = 'shipping';

  FOR v_item IN SELECT * FROM jsonb_array_elements(v_items) LOOP
    v_next := v_next + 1;
    INSERT INTO quotation_items (
      quotation_id, line_number, item_type,
      requested_item_id, requested_impa, requested_name,
      offered_item_id, vendor_product_id,
      qty, unit_id, selling_price, cost_price,
      is_available, ship_destination, due_date,
      update_vendor_price, created_by, updated_by
    ) VALUES (
      p_quotation_id, v_next, 'product',
      NULLIF((v_item->>'requested_item_id'),'')::BIGINT,
      v_item->>'requested_impa',
      v_item->>'requested_name',
      NULLIF((v_item->>'offered_item_id'),'')::BIGINT,
      NULLIF((v_item->>'vendor_product_id'),'')::BIGINT,
      (v_item->>'qty')::NUMERIC(12,2),
      (v_item->>'unit_id')::SMALLINT,
      (v_item->>'selling_price')::NUMERIC(15,2),
      NULLIF((v_item->>'cost_price'),'')::NUMERIC(15,2),
      COALESCE((v_item->>'is_available')::BOOLEAN, TRUE),
      v_item->>'ship_destination',
      NULLIF((v_item->>'due_date'),'')::DATE,
      COALESCE((v_item->>'update_vendor_price')::BOOLEAN, FALSE),
      p_user_id, p_user_id
    ) RETURNING id INTO v_id;
    v_ids := v_ids || v_id;
  END LOOP;

  PERFORM fn_recompute_quotation_totals(p_quotation_id);
  PERFORM fn_quotation_notify(p_quotation_id, 'lines', NULL, p_user_id);
  RETURN v_ids;
END;
$function$
