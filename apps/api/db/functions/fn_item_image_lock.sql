-- Canonical current body of fn_item_image_lock (deployed by migration 00079).
CREATE OR REPLACE FUNCTION public.fn_item_image_lock(p_item_id bigint)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_cover TEXT;
BEGIN
  SELECT image_object_key INTO v_cover FROM items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produk tidak ditemukan.' USING ERRCODE = 'P0011';
  END IF;
  RETURN v_cover;
END;
$function$
