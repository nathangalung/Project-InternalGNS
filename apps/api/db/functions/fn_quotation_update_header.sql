-- Canonical current body of fn_quotation_update_header (deployed by migration 00078).
CREATE OR REPLACE FUNCTION public.fn_quotation_update_header(p_quotation_id bigint, p_client_ref_no text, p_vessel_name text, p_payment_terms text, p_validity_days integer, p_discount_pct numeric, p_shipping_address text, p_shipping_days integer, p_shipping_cost numeric, p_notes text, p_user_id bigint)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_ship_id BIGINT;
  v_next    SMALLINT;
BEGIN
  PERFORM fn_quotation_lock_draft(p_quotation_id);
  PERFORM fn_quotation_part_held(p_quotation_id, 'header', p_user_id);
  IF p_discount_pct < 0 OR p_discount_pct > 100 THEN
    RAISE EXCEPTION 'Diskon harus antara 0 dan 100; nilai yang dikirim %.', p_discount_pct
      USING ERRCODE = 'P0014';
  END IF;

  -- The discount cascade trigger re-prices every line.
  UPDATE quotations
  SET client_ref_no = p_client_ref_no,
      vessel_name   = p_vessel_name,
      payment_terms = p_payment_terms,
      validity_days = p_validity_days,
      discount_pct  = p_discount_pct,
      notes         = p_notes,
      updated_by    = p_user_id
  WHERE id = p_quotation_id;

  SELECT id INTO v_ship_id FROM quotation_items
  WHERE quotation_id = p_quotation_id AND item_type = 'shipping';
  IF NULLIF(TRIM(p_shipping_address), '') IS NOT NULL OR COALESCE(p_shipping_cost, 0) > 0 THEN
    IF v_ship_id IS NULL THEN
      SELECT COALESCE(MAX(line_number), 0) + 1 INTO v_next
      FROM quotation_items WHERE quotation_id = p_quotation_id;
      INSERT INTO quotation_items (
        quotation_id, line_number, item_type, requested_name, qty, unit_id, selling_price,
        ship_destination, shipping_days, created_by, updated_by
      ) VALUES (
        p_quotation_id, v_next, 'shipping',
        'SHIPPING' || COALESCE(' — ' || p_shipping_address, ''), 1,
        (SELECT id FROM units WHERE code = 'UNIT' LIMIT 1),
        COALESCE(p_shipping_cost, 0), p_shipping_address, p_shipping_days,
        p_user_id, p_user_id
      );
    ELSE
      UPDATE quotation_items
      SET requested_name   = 'SHIPPING' || COALESCE(' — ' || p_shipping_address, ''),
          selling_price    = COALESCE(p_shipping_cost, 0),
          ship_destination = p_shipping_address,
          shipping_days    = p_shipping_days,
          updated_by       = p_user_id
      WHERE id = v_ship_id;
    END IF;
  ELSIF v_ship_id IS NOT NULL THEN
    DELETE FROM quotation_items WHERE id = v_ship_id;
  END IF;

  PERFORM fn_recompute_quotation_totals(p_quotation_id);
  PERFORM fn_quotation_notify(p_quotation_id, 'header', 'header', p_user_id);
END;
$function$
