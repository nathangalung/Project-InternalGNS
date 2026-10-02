-- Canonical current body of fn_item_image_add (deployed by migration 00079).
CREATE OR REPLACE FUNCTION public.fn_item_image_add(p_item_id bigint, p_key text, p_user_id bigint)
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_cover TEXT;
  v_id    BIGINT;
BEGIN
  v_cover := fn_item_image_lock(p_item_id);
  SELECT id INTO v_id FROM item_images WHERE item_id = p_item_id AND object_key = p_key;
  IF FOUND THEN
    RETURN v_id;
  END IF;
  IF (SELECT count(*) FROM item_images WHERE item_id = p_item_id) >= 8 THEN
    RAISE EXCEPTION 'Maksimal 8 foto per produk.' USING ERRCODE = 'P0014';
  END IF;
  INSERT INTO item_images (item_id, object_key, created_by)
  VALUES (p_item_id, p_key, p_user_id)
  RETURNING id INTO v_id;
  IF v_cover IS NULL THEN
    UPDATE items SET image_object_key = p_key, updated_by = p_user_id, updated_at = NOW()
    WHERE id = p_item_id;
  END IF;
  RETURN v_id;
END;
$function$
