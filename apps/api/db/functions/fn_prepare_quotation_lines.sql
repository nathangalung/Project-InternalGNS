-- Canonical current body of fn_prepare_quotation_lines (deployed by migration 00077).
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
      IF NOT EXISTS (SELECT 1 FROM vendors WHERE id = v_vendor AND is_active) THEN
        RAISE EXCEPTION 'Vendor tidak ditemukan atau sudah nonaktif. Pilih vendor lain.'
          USING ERRCODE = 'P0014';
      END IF;
      INSERT INTO vendor_products (vendor_id, item_id, cost_price, last_quoted_at, created_by, updated_by)
      VALUES (v_vendor, v_offered,
              COALESCE(NULLIF(v_item->>'cost_price', '')::NUMERIC, 0),
              NOW(), p_user_id, p_user_id)
      ON CONFLICT (vendor_id, item_id) DO UPDATE
         SET is_active  = TRUE,
             -- A link still at 0 takes its first real price.
             cost_price = CASE WHEN vendor_products.cost_price = 0
                               THEN EXCLUDED.cost_price
                               ELSE vendor_products.cost_price END,
             updated_by = EXCLUDED.updated_by,
             updated_at = NOW()
      RETURNING id INTO v_link;
      v_item := jsonb_set(v_item, '{vendor_product_id}', to_jsonb(v_link));
    END IF;
    v_out := v_out || jsonb_build_array(v_item - 'vendor_id');
  END LOOP;
  RETURN v_out;
END;
$function$
