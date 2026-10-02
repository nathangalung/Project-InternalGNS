-- +goose Up

-- 00079 ITEM IMAGE GALLERY
-- A product keeps up to eight photos, shown as a slider on its page. Every
-- photo is a row of item_images, in upload order. items.image_object_key
-- stays and names the cover (Foto Utama): every list, search hit and
-- thumbnail already reads it, so they keep working unchanged. The functions
-- below are the only writers of both, and keep the cover pointing at one of
-- the item's photos, or NULL when it has none.

CREATE TABLE item_images (
  id         BIGSERIAL PRIMARY KEY,
  item_id    BIGINT NOT NULL REFERENCES items(id) ON DELETE CASCADE,
  object_key TEXT NOT NULL UNIQUE,
  created_by BIGINT REFERENCES users(id),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_item_images_item ON item_images (item_id, id);

-- Today's single photo becomes the first of each gallery.
INSERT INTO item_images (item_id, object_key, created_by, created_at)
SELECT id, image_object_key, updated_by, updated_at
FROM items
WHERE image_object_key IS NOT NULL
ORDER BY id;

-- +goose StatementBegin
-- The item, locked for one gallery change at a time.
CREATE OR REPLACE FUNCTION fn_item_image_lock(p_item_id BIGINT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_cover TEXT;
BEGIN
  SELECT image_object_key INTO v_cover FROM items WHERE id = p_item_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Produk tidak ditemukan.' USING ERRCODE = 'P0011';
  END IF;
  RETURN v_cover;
END;
$$;
-- +goose StatementEnd

-- +goose StatementBegin
-- Add a photo; the first becomes the cover.
-- Attaching a key already in this gallery is a retry and returns its row.
CREATE OR REPLACE FUNCTION fn_item_image_add(p_item_id BIGINT, p_key TEXT, p_user_id BIGINT)
RETURNS BIGINT
LANGUAGE plpgsql
AS $$
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
$$;
-- +goose StatementEnd

-- +goose StatementBegin
-- Remove a photo; a removed cover passes to the oldest left.
CREATE OR REPLACE FUNCTION fn_item_image_delete(p_item_id BIGINT, p_image_id BIGINT, p_user_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
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
$$;
-- +goose StatementEnd

-- +goose StatementBegin
-- Make a photo the cover.
CREATE OR REPLACE FUNCTION fn_item_image_set_cover(p_item_id BIGINT, p_image_id BIGINT, p_user_id BIGINT)
RETURNS VOID
LANGUAGE plpgsql
AS $$
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
$$;
-- +goose StatementEnd

-- +goose Down

-- The cover survives in items.image_object_key; the other photos' rows go,
-- while their objects stay in storage for cmd/orphan-blobs to judge.
DROP FUNCTION IF EXISTS fn_item_image_set_cover(BIGINT, BIGINT, BIGINT);
DROP FUNCTION IF EXISTS fn_item_image_delete(BIGINT, BIGINT, BIGINT);
DROP FUNCTION IF EXISTS fn_item_image_add(BIGINT, TEXT, BIGINT);
DROP FUNCTION IF EXISTS fn_item_image_lock(BIGINT);
DROP TABLE IF EXISTS item_images;
