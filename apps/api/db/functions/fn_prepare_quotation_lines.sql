-- Canonical current body of fn_prepare_quotation_lines (deployed by migration 00084).
CREATE OR REPLACE FUNCTION public.fn_prepare_quotation_lines(p_items jsonb, p_user_id bigint)
 RETURNS jsonb
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_out     JSONB := '[]'::JSONB;
  v_item    JSONB;
  v_vendor  BIGINT;
  v_offered BIGINT;
  v_link    BIGINT;
BEGIN
  -- Leave a missing list to the caller's own validation.
  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RETURN p_items;
  END IF;

  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_vendor := NULLIF(v_item->>'vendor_id', '')::BIGINT;
    IF (v_item->>'is_available') = 'false' THEN
      -- Tidak Ditawarkan: nothing is sold, so nothing is priced.
      v_item := (v_item - 'vendor_product_id' - 'cost_price' - 'update_vendor_price')
                || jsonb_build_object('selling_price', '0');
    ELSIF v_vendor IS NOT NULL AND NULLIF(v_item->>'vendor_product_id', '') IS NULL THEN
      v_offered := NULLIF(v_item->>'offered_item_id', '')::BIGINT;
      IF v_offered IS NULL THEN
        RAISE EXCEPTION 'Pilih produk yang ditawarkan sebelum memilih vendor.'
          USING ERRCODE = 'P0014';
      END IF;
      v_link := fn_link_vendor_item(
        v_vendor, v_offered, NULLIF(v_item->>'cost_price', '')::NUMERIC, p_user_id);
      v_item := jsonb_set(v_item, '{vendor_product_id}', to_jsonb(v_link));
    END IF;
    v_out := v_out || jsonb_build_array(v_item - 'vendor_id');
  END LOOP;
  RETURN v_out;
END;
$function$
