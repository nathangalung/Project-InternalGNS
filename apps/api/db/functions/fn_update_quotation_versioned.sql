-- Canonical current body of fn_update_quotation_versioned (deployed by migration 00029).
CREATE OR REPLACE FUNCTION public.fn_update_quotation_versioned(p_id bigint, p_if_match integer, p_client_ref_no text, p_vessel_name text, p_payment_terms text, p_validity_days integer, p_discount_pct numeric, p_shipping_address text, p_shipping_days integer, p_shipping_cost numeric, p_items jsonb, p_user_id bigint, p_notes text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_current INT;
  v_new     INT;
BEGIN
  SELECT row_version INTO v_current
  FROM quotations
  WHERE id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'quotation % not found', p_id USING ERRCODE = 'P0011';
  END IF;

  IF v_current <> p_if_match THEN
    RAISE EXCEPTION 'row_version mismatch (expected %, got %)', v_current, p_if_match
      USING ERRCODE = 'P0010';
  END IF;

  PERFORM fn_update_quotation(
    p_id, p_client_ref_no, p_vessel_name, p_payment_terms,
    p_validity_days, p_discount_pct, p_shipping_address,
    p_shipping_days, p_shipping_cost, p_items, p_user_id, p_notes
  );

  SELECT row_version INTO v_new FROM quotations WHERE id = p_id;
  RETURN v_new;
END;
$function$
