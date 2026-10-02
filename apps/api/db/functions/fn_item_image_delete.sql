-- Canonical current body of fn_item_image_delete (deployed by migration 00079).
CREATE OR REPLACE FUNCTION public.fn_item_image_delete(p_item_id bigint, p_image_id bigint, p_user_id bigint)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_cover TEXT;
  v_key   TEXT;
BEGIN
  v_cover := fn_item_image_lock(p_item_id);
  DELETE FROM item_images WHERE id = p_image_id AND item_id = p_item_id
  RETURNING object_key INTO v_key;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Foto tidak ditemukan.' USING ERRCODE = 'P0011';
  END IF;
  IF v_cover = v_key THEN
    UPDATE items
    SET image_object_key = (SELECT object_key FROM item_images
                            WHERE item_id = p_item_id ORDER BY id LIMIT 1),
        updated_by = p_user_id, updated_at = NOW()
    WHERE id = p_item_id;
  END IF;
END;
$function$
