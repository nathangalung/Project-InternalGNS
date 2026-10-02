-- Canonical current body of fn_item_image_set_cover (deployed by migration 00079).
CREATE OR REPLACE FUNCTION public.fn_item_image_set_cover(p_item_id bigint, p_image_id bigint, p_user_id bigint)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_key TEXT;
BEGIN
  PERFORM fn_item_image_lock(p_item_id);
  SELECT object_key INTO v_key FROM item_images WHERE id = p_image_id AND item_id = p_item_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Foto tidak ditemukan.' USING ERRCODE = 'P0011';
  END IF;
  UPDATE items SET image_object_key = v_key, updated_by = p_user_id, updated_at = NOW()
  WHERE id = p_item_id;
END;
$function$
