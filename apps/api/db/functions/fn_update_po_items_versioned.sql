-- Canonical current body of fn_update_po_items_versioned (deployed by migration 00029).
CREATE OR REPLACE FUNCTION public.fn_update_po_items_versioned(p_po_id bigint, p_if_match integer, p_user_id bigint, p_discount_pct numeric, p_notes text, p_shipping_address text, p_shipping_days integer, p_shipping_cost numeric, p_items jsonb)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_current INT;
  v_new     INT;
BEGIN
  SELECT row_version INTO v_current
  FROM purchase_orders
  WHERE id = p_po_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'purchase order % not found', p_po_id USING ERRCODE = 'P0011';
  END IF;

  IF v_current <> p_if_match THEN
    RAISE EXCEPTION 'row_version mismatch (expected %, got %)', v_current, p_if_match
      USING ERRCODE = 'P0010';
  END IF;

  PERFORM fn_update_po_items(
    p_po_id, p_user_id, p_discount_pct, p_notes,
    p_shipping_address, p_shipping_days, p_shipping_cost, p_items
  );

  SELECT row_version INTO v_new FROM purchase_orders WHERE id = p_po_id;
  RETURN v_new;
END;
$function$
