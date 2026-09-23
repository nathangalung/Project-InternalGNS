-- +goose Up

-- 00061 PO CANCEL, HISTORY, DERIVED UPLOAD
-- * CANCELLED joins the status set, reachable from PENDING, UPLOADED and
--   ON_PROGRESS with a required reason. An accepted-by-mistake quotation
--   no longer leaves its PO stuck at PENDING.
-- * DELIVERED is terminal: the DELIVERED -> ON_PROGRESS branch could never
--   succeed because DELIVERED always creates the invoice.
-- * UPLOADED follows the PO file. fn_attach_po_file moves PENDING to
--   UPLOADED and fn_detach_po_file moves it back; fn_change_po_status
--   refuses both moves by hand. A CHECK keeps UPLOADED rows holding a file,
--   after rows that reached UPLOADED by hand without one return to PENDING.
-- * po_status_history records every move, backfilled for existing POs.
-- * fn_update_po_items also locks CANCELLED lines, with Indonesian prose.

ALTER TABLE purchase_orders DROP CONSTRAINT purchase_orders_status_check;
ALTER TABLE purchase_orders
  ADD CONSTRAINT purchase_orders_status_check
  CHECK (status IN ('PENDING','UPLOADED','ON_PROGRESS','DELIVERED','CANCELLED'));

CREATE TABLE po_status_history (
  id           BIGSERIAL PRIMARY KEY,
  po_id        BIGINT NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
  from_status  VARCHAR(20),
  to_status    VARCHAR(20) NOT NULL,
  note         TEXT,
  changed_by   BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  changed_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_po_status_history_po
  ON po_status_history(po_id, changed_at, id);

COMMENT ON TABLE po_status_history IS
  'PO status timeline. from_status NULL marks creation. Written by trg_log_po_creation, fn_change_po_status, fn_attach_po_file and fn_detach_po_file.';

-- Backfill: creation, then the status found today.
INSERT INTO po_status_history (po_id, from_status, to_status, note, changed_by, changed_at)
SELECT id, NULL, 'PENDING', 'PO dibuat', created_by, created_at
  FROM purchase_orders;

INSERT INTO po_status_history (po_id, from_status, to_status, note, changed_by, changed_at)
SELECT id, 'PENDING', status, 'Status saat riwayat mulai dicatat',
       COALESCE(updated_by, created_by), updated_at
  FROM purchase_orders
 WHERE status <> 'PENDING';

-- UPLOADED set by hand without a file.
WITH moved AS (
  UPDATE purchase_orders
     SET status = 'PENDING'
   WHERE status = 'UPLOADED' AND file_url IS NULL
  RETURNING id, COALESCE(updated_by, created_by) AS actor
)
INSERT INTO po_status_history (po_id, from_status, to_status, note, changed_by)
SELECT id, 'UPLOADED', 'PENDING', 'Belum ada berkas PO; status mengikuti berkas', actor
  FROM moved;

ALTER TABLE purchase_orders
  ADD CONSTRAINT purchase_orders_uploaded_has_file
  CHECK (status <> 'UPLOADED' OR file_url IS NOT NULL);

-- +goose StatementBegin
CREATE FUNCTION trg_fn_log_po_creation() RETURNS TRIGGER AS $$
BEGIN
  INSERT INTO po_status_history (po_id, from_status, to_status, note, changed_by)
  VALUES (NEW.id, NULL, NEW.status, 'PO dibuat', NEW.created_by);
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

CREATE TRIGGER trg_log_po_creation
AFTER INSERT ON purchase_orders
FOR EACH ROW
EXECUTE FUNCTION trg_fn_log_po_creation();

-- The note argument changes the signature.
DROP FUNCTION fn_change_po_status(BIGINT, TEXT, BIGINT);

-- +goose StatementBegin
CREATE FUNCTION fn_change_po_status(
  p_po_id      BIGINT,
  p_new_status TEXT,
  p_user_id    BIGINT,
  p_note       TEXT DEFAULT NULL
) RETURNS VOID AS $$
DECLARE
  v_old        TEXT;
  v_ok         BOOLEAN;
  v_company_id BIGINT;
  v_dn_current TEXT;
  v_file       TEXT;
  v_dn         TEXT;
  v_note       TEXT := NULLIF(BTRIM(p_note), '');
BEGIN
  SELECT status, company_client_id, delivery_note_number, file_url
    INTO v_old, v_company_id, v_dn_current, v_file
    FROM purchase_orders WHERE id = p_po_id FOR UPDATE;

  IF v_old IS NULL THEN
    RAISE EXCEPTION 'Purchase order % not found', p_po_id
      USING ERRCODE = 'P0011';
  END IF;

  IF v_old = p_new_status THEN
    RETURN;
  END IF;

  IF v_old IN ('DELIVERED', 'CANCELLED') THEN
    RAISE EXCEPTION 'PO yang sudah dikirim atau dibatalkan tidak dapat diubah statusnya.'
      USING ERRCODE = 'P0012';
  END IF;

  -- PENDING and UPLOADED follow the file.
  IF (v_old = 'PENDING' AND p_new_status = 'UPLOADED')
     OR (v_old = 'UPLOADED' AND p_new_status = 'PENDING') THEN
    RAISE EXCEPTION 'Status ini mengikuti berkas PO. Unggah atau hapus berkas PO untuk mengubahnya.'
      USING ERRCODE = 'P0012';
  END IF;

  v_ok := CASE
    WHEN v_old = 'PENDING'     AND p_new_status IN ('CANCELLED')                        THEN TRUE
    WHEN v_old = 'UPLOADED'    AND p_new_status IN ('ON_PROGRESS','CANCELLED')          THEN TRUE
    WHEN v_old = 'ON_PROGRESS' AND p_new_status IN ('DELIVERED','UPLOADED','CANCELLED') THEN TRUE
    ELSE FALSE
  END;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'Perubahan status PO ini tidak diizinkan.'
      USING ERRCODE = 'P0012';
  END IF;

  IF p_new_status = 'CANCELLED' AND v_note IS NULL THEN
    RAISE EXCEPTION 'Alasan pembatalan wajib diisi.'
      USING ERRCODE = 'P0014';
  END IF;

  IF p_new_status = 'UPLOADED' AND v_file IS NULL THEN
    RAISE EXCEPTION 'PO belum memiliki berkas. Unggah berkas PO terlebih dahulu.'
      USING ERRCODE = 'P0012';
  END IF;

  IF p_new_status IN ('ON_PROGRESS', 'DELIVERED') AND v_dn_current IS NULL THEN
    v_dn := fn_next_doc_no('DN', v_company_id);
  END IF;

  UPDATE purchase_orders
  SET status               = p_new_status,
      delivery_note_number = COALESCE(v_dn, delivery_note_number),
      updated_by           = p_user_id
  WHERE id = p_po_id;

  INSERT INTO po_status_history (po_id, from_status, to_status, note, changed_by)
  VALUES (p_po_id, v_old, p_new_status, v_note, p_user_id);

  IF p_new_status = 'DELIVERED' THEN
    PERFORM fn_create_invoice(p_po_id, p_user_id);
  END IF;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE FUNCTION fn_attach_po_file(
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

-- +goose StatementBegin
CREATE FUNCTION fn_detach_po_file(
  p_po_id   BIGINT,
  p_user_id BIGINT
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

  IF v_old NOT IN ('PENDING', 'UPLOADED') THEN
    RAISE EXCEPTION 'Berkas PO tidak dapat dihapus setelah PO diproses, dikirim, atau dibatalkan.'
      USING ERRCODE = 'P0013';
  END IF;

  UPDATE purchase_orders
  SET file_name   = NULL,
      file_size   = NULL,
      file_url    = NULL,
      uploaded_at = NULL,
      updated_by  = p_user_id,
      status      = 'PENDING'
  WHERE id = p_po_id;

  IF v_old = 'UPLOADED' THEN
    INSERT INTO po_status_history (po_id, from_status, to_status, note, changed_by)
    VALUES (p_po_id, 'UPLOADED', 'PENDING', 'Berkas PO dihapus', p_user_id);
  END IF;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- Body of 00046; only the lock changes.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION fn_update_po_items(
  p_po_id            BIGINT,
  p_user_id          BIGINT,
  p_discount_pct     NUMERIC,
  p_notes            TEXT,
  p_shipping_address TEXT,
  p_shipping_days    INTEGER,
  p_shipping_cost    NUMERIC,
  p_items            JSONB
) RETURNS VOID AS $$
DECLARE
  v_status VARCHAR(20);
  v_line   INT := 0;
  it       JSONB;
BEGIN
  SELECT status INTO v_status
  FROM purchase_orders
  WHERE id = p_po_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Purchase order % not found', p_po_id
      USING ERRCODE = 'P0011';
  END IF;

  IF v_status IN ('DELIVERED', 'CANCELLED') THEN
    RAISE EXCEPTION 'PO yang sudah dikirim atau dibatalkan tidak dapat diubah.'
      USING ERRCODE = 'P0013';
  END IF;

  IF p_discount_pct IS NULL OR p_discount_pct < 0 OR p_discount_pct > 100 THEN
    RAISE EXCEPTION 'discount_pct must be between 0 and 100'
      USING ERRCODE = 'P0014';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'items must be a JSON array'
      USING ERRCODE = 'P0014';
  END IF;

  UPDATE purchase_orders
  SET discount_pct = p_discount_pct,
      notes        = p_notes,
      updated_by   = p_user_id
  WHERE id = p_po_id;

  DELETE FROM purchase_order_items WHERE po_id = p_po_id;

  FOR it IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_line := v_line + 1;
    INSERT INTO purchase_order_items (
      po_id, quotation_item_id, line_number, item_type,
      offered_item_id, item_name, item_code,
      qty, unit_id, selling_price, cost_price,
      discount_pct, is_available, ship_destination,
      created_by, updated_by
    ) VALUES (
      p_po_id,
      NULLIF(it->>'quotationItemId','')::BIGINT,
      v_line,
      'product',
      NULLIF(it->>'offeredItemId','')::BIGINT,
      COALESCE(it->>'itemName',''),
      NULLIF(it->>'itemCode',''),
      COALESCE(NULLIF(it->>'qty','')::NUMERIC, 0),
      NULLIF(it->>'unitId','')::SMALLINT,
      COALESCE(NULLIF(it->>'sellingPrice','')::NUMERIC, 0),
      NULLIF(it->>'costPrice','')::NUMERIC,
      p_discount_pct,
      COALESCE((it->>'isAvailable')::BOOLEAN, TRUE),
      NULLIF(it->>'shipDestination',''),
      p_user_id,
      p_user_id
    );
  END LOOP;

  IF p_shipping_address IS NOT NULL AND TRIM(p_shipping_address) <> '' THEN
    v_line := v_line + 1;
    INSERT INTO purchase_order_items (
      po_id, line_number, item_type,
      item_name, qty, selling_price,
      discount_pct, is_available, ship_destination, shipping_days,
      created_by, updated_by
    ) VALUES (
      p_po_id,
      v_line,
      'shipping',
      'Pengiriman',
      1,
      COALESCE(p_shipping_cost, 0),
      0,
      TRUE,
      p_shipping_address,
      p_shipping_days,
      p_user_id,
      p_user_id
    );
  END IF;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- +goose Down

-- Refuse while CANCELLED rows exist: the old CHECK has no place for them.
-- UPLOADED rows the Up returned to PENDING stay PENDING.
-- +goose StatementBegin
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM purchase_orders WHERE status = 'CANCELLED') THEN
    RAISE EXCEPTION 'Cannot roll back 00061: cancelled purchase orders exist';
  END IF;
END;
$$;
-- +goose StatementEnd

DROP TRIGGER trg_log_po_creation ON purchase_orders;
DROP FUNCTION trg_fn_log_po_creation();
DROP FUNCTION fn_attach_po_file(BIGINT, TEXT, BIGINT, TEXT, BIGINT);
DROP FUNCTION fn_detach_po_file(BIGINT, BIGINT);
DROP FUNCTION fn_change_po_status(BIGINT, TEXT, BIGINT, TEXT);

-- Body of 00053.
-- +goose StatementBegin
CREATE FUNCTION fn_change_po_status(
  p_po_id      BIGINT,
  p_new_status TEXT,
  p_user_id    BIGINT
) RETURNS VOID AS $$
DECLARE
  v_old        TEXT;
  v_ok         BOOLEAN;
  v_company_id BIGINT;
  v_dn_current TEXT;
  v_dn         TEXT;
BEGIN
  SELECT status, company_client_id, delivery_note_number
    INTO v_old, v_company_id, v_dn_current
    FROM purchase_orders WHERE id = p_po_id FOR UPDATE;

  IF v_old IS NULL THEN
    RAISE EXCEPTION 'Purchase order % not found', p_po_id
      USING ERRCODE = 'P0011';
  END IF;

  IF v_old = p_new_status THEN
    RETURN;
  END IF;

  IF v_old = 'DELIVERED' AND p_new_status = 'ON_PROGRESS'
     AND EXISTS (SELECT 1 FROM invoices WHERE po_id = p_po_id) THEN
    RAISE EXCEPTION 'PO % has an invoice; cannot revert from DELIVERED', p_po_id
      USING ERRCODE = 'P0013';
  END IF;

  v_ok := CASE
    WHEN v_old = 'PENDING'     AND p_new_status IN ('UPLOADED')                        THEN TRUE
    WHEN v_old = 'UPLOADED'    AND p_new_status IN ('ON_PROGRESS','PENDING')           THEN TRUE
    WHEN v_old = 'ON_PROGRESS' AND p_new_status IN ('DELIVERED','UPLOADED')            THEN TRUE
    WHEN v_old = 'DELIVERED'   AND p_new_status IN ('ON_PROGRESS')                     THEN TRUE
    ELSE FALSE
  END;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'Invalid PO status transition: % -> %', v_old, p_new_status
      USING ERRCODE = 'P0012';
  END IF;

  IF p_new_status IN ('ON_PROGRESS', 'DELIVERED') AND v_dn_current IS NULL THEN
    v_dn := fn_next_doc_no('DN', v_company_id);
  END IF;

  UPDATE purchase_orders
  SET status               = p_new_status,
      delivery_note_number = COALESCE(v_dn, delivery_note_number),
      updated_by           = p_user_id
  WHERE id = p_po_id;

  IF p_new_status = 'DELIVERED' THEN
    PERFORM fn_create_invoice(p_po_id, p_user_id);
  END IF;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- Body of 00046.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION fn_update_po_items(
  p_po_id            BIGINT,
  p_user_id          BIGINT,
  p_discount_pct     NUMERIC,
  p_notes            TEXT,
  p_shipping_address TEXT,
  p_shipping_days    INTEGER,
  p_shipping_cost    NUMERIC,
  p_items            JSONB
) RETURNS VOID AS $$
DECLARE
  v_status VARCHAR(20);
  v_line   INT := 0;
  it       JSONB;
BEGIN
  SELECT status INTO v_status
  FROM purchase_orders
  WHERE id = p_po_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Purchase order % not found', p_po_id
      USING ERRCODE = 'P0011';
  END IF;

  IF v_status = 'DELIVERED' THEN
    RAISE EXCEPTION 'Cannot edit PO in DELIVERED state'
      USING ERRCODE = 'P0013';
  END IF;

  IF p_discount_pct IS NULL OR p_discount_pct < 0 OR p_discount_pct > 100 THEN
    RAISE EXCEPTION 'discount_pct must be between 0 and 100'
      USING ERRCODE = 'P0014';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'items must be a JSON array'
      USING ERRCODE = 'P0014';
  END IF;

  UPDATE purchase_orders
  SET discount_pct = p_discount_pct,
      notes        = p_notes,
      updated_by   = p_user_id
  WHERE id = p_po_id;

  DELETE FROM purchase_order_items WHERE po_id = p_po_id;

  FOR it IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_line := v_line + 1;
    INSERT INTO purchase_order_items (
      po_id, quotation_item_id, line_number, item_type,
      offered_item_id, item_name, item_code,
      qty, unit_id, selling_price, cost_price,
      discount_pct, is_available, ship_destination,
      created_by, updated_by
    ) VALUES (
      p_po_id,
      NULLIF(it->>'quotationItemId','')::BIGINT,
      v_line,
      'product',
      NULLIF(it->>'offeredItemId','')::BIGINT,
      COALESCE(it->>'itemName',''),
      NULLIF(it->>'itemCode',''),
      COALESCE(NULLIF(it->>'qty','')::NUMERIC, 0),
      NULLIF(it->>'unitId','')::SMALLINT,
      COALESCE(NULLIF(it->>'sellingPrice','')::NUMERIC, 0),
      NULLIF(it->>'costPrice','')::NUMERIC,
      p_discount_pct,
      COALESCE((it->>'isAvailable')::BOOLEAN, TRUE),
      NULLIF(it->>'shipDestination',''),
      p_user_id,
      p_user_id
    );
  END LOOP;

  IF p_shipping_address IS NOT NULL AND TRIM(p_shipping_address) <> '' THEN
    v_line := v_line + 1;
    INSERT INTO purchase_order_items (
      po_id, line_number, item_type,
      item_name, qty, selling_price,
      discount_pct, is_available, ship_destination, shipping_days,
      created_by, updated_by
    ) VALUES (
      p_po_id,
      v_line,
      'shipping',
      'Pengiriman',
      1,
      COALESCE(p_shipping_cost, 0),
      0,
      TRUE,
      p_shipping_address,
      p_shipping_days,
      p_user_id,
      p_user_id
    );
  END IF;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

ALTER TABLE purchase_orders DROP CONSTRAINT purchase_orders_uploaded_has_file;
DROP TABLE po_status_history;

ALTER TABLE purchase_orders DROP CONSTRAINT purchase_orders_status_check;
ALTER TABLE purchase_orders
  ADD CONSTRAINT purchase_orders_status_check
  CHECK (status IN ('PENDING','UPLOADED','ON_PROGRESS','DELIVERED'));
