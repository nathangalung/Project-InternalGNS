-- +goose Up

-- 00064 PO FILE TERMINAL LOCK
-- fn_attach_po_file refuses DELIVERED and CANCELLED POs with P0013, the
-- same lock fn_detach_po_file already applies. A delivered PO has produced
-- its invoice and a cancelled one is closed, so neither may swap the
-- document it was accepted or closed on. ON_PROGRESS may still replace it.

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION fn_attach_po_file(
  p_po_id     BIGINT,
  p_file_name TEXT,
  p_file_size BIGINT,
  p_file_url  TEXT,
  p_user_id   BIGINT
) RETURNS VOID AS $$
DECLARE
  v_old TEXT;
BEGIN
  SELECT status INTO v_old
    FROM purchase_orders WHERE id = p_po_id FOR UPDATE;

  IF v_old IS NULL THEN
    RAISE EXCEPTION 'Purchase order % not found', p_po_id
      USING ERRCODE = 'P0011';
  END IF;

  IF v_old IN ('DELIVERED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Berkas PO tidak dapat diubah setelah PO dikirim atau dibatalkan.'
      USING ERRCODE = 'P0013';
  END IF;

  UPDATE purchase_orders
  SET file_name   = p_file_name,
      file_size   = p_file_size,
      file_url    = p_file_url,
      uploaded_at = NOW(),
      updated_by  = p_user_id,
      status      = CASE WHEN v_old = 'PENDING' THEN 'UPLOADED' ELSE status END
  WHERE id = p_po_id;

  IF v_old = 'PENDING' THEN
    INSERT INTO po_status_history (po_id, from_status, to_status, note, changed_by)
    VALUES (p_po_id, 'PENDING', 'UPLOADED', 'Berkas PO diunggah', p_user_id);
  END IF;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- +goose Down

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION fn_attach_po_file(
  p_po_id     BIGINT,
  p_file_name TEXT,
  p_file_size BIGINT,
  p_file_url  TEXT,
  p_user_id   BIGINT
) RETURNS VOID AS $$
DECLARE
  v_old TEXT;
BEGIN
  SELECT status INTO v_old
    FROM purchase_orders WHERE id = p_po_id FOR UPDATE;

  IF v_old IS NULL THEN
    RAISE EXCEPTION 'Purchase order % not found', p_po_id
      USING ERRCODE = 'P0011';
  END IF;

  UPDATE purchase_orders
  SET file_name   = p_file_name,
      file_size   = p_file_size,
      file_url    = p_file_url,
      uploaded_at = NOW(),
      updated_by  = p_user_id,
      status      = CASE WHEN v_old = 'PENDING' THEN 'UPLOADED' ELSE status END
  WHERE id = p_po_id;

  IF v_old = 'PENDING' THEN
    INSERT INTO po_status_history (po_id, from_status, to_status, note, changed_by)
    VALUES (p_po_id, 'PENDING', 'UPLOADED', 'Berkas PO diunggah', p_user_id);
  END IF;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd
