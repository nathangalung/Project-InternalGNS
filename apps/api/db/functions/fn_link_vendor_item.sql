-- Canonical current body of fn_link_vendor_item (deployed by migration 00083).
CREATE OR REPLACE FUNCTION public.fn_link_vendor_item(p_vendor_id bigint, p_item_id bigint, p_cost numeric, p_user_id bigint)
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_link BIGINT;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM vendors WHERE id = p_vendor_id AND is_active) THEN
    RAISE EXCEPTION 'Vendor tidak ditemukan atau sudah nonaktif. Pilih vendor lain.'
      USING ERRCODE = 'P0014';
  END IF;
  INSERT INTO vendor_products (vendor_id, item_id, cost_price, last_quoted_at, created_by, updated_by)
  VALUES (p_vendor_id, p_item_id, COALESCE(p_cost, 0), NOW(), p_user_id, p_user_id)
  ON CONFLICT (vendor_id, item_id) DO UPDATE
     SET is_active  = TRUE,
         -- A link still at 0 takes its first real price.
         cost_price = CASE WHEN vendor_products.cost_price = 0
                           THEN EXCLUDED.cost_price
                           ELSE vendor_products.cost_price END,
         updated_by = EXCLUDED.updated_by,
         updated_at = NOW()
  RETURNING id INTO v_link;
  RETURN v_link;
END;
$function$
