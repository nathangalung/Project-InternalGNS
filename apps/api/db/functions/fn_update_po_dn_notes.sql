-- Canonical current body of fn_update_po_dn_notes (deployed by migration 00114).
CREATE OR REPLACE FUNCTION public.fn_update_po_dn_notes(p_po_id bigint, p_if_match integer, p_notes jsonb, p_user_id bigint)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_current INT;
  v_status  VARCHAR(20);
  v_new     INT;
BEGIN
  SELECT row_version, status INTO v_current, v_status
  FROM purchase_orders
  WHERE id = p_po_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PO tidak ditemukan. Muat ulang halaman.'
      USING ERRCODE = 'P0011';
  END IF;

  IF p_if_match IS NOT NULL AND v_current <> p_if_match THEN
    RAISE EXCEPTION 'Data ini baru saja diubah pengguna lain. Muat ulang lalu coba lagi.'
      USING ERRCODE = 'P0010';
  END IF;

  -- The note exists from ON_PROGRESS on.
  IF v_status NOT IN ('ON_PROGRESS', 'DELIVERED') THEN
    RAISE EXCEPTION 'Catatan surat jalan hanya bisa diubah saat PO Dalam Progres atau Dikirim.'
      USING ERRCODE = 'P0013';
  END IF;

  IF p_notes IS NULL OR jsonb_typeof(p_notes) <> 'array' OR jsonb_array_length(p_notes) = 0 THEN
    RAISE EXCEPTION 'Daftar catatan surat jalan kosong.'
      USING ERRCODE = 'P0014';
  END IF;

  -- Each note is for a product line of this PO.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_notes) AS e
    WHERE NOT EXISTS (
      SELECT 1 FROM purchase_order_items poi
      WHERE poi.id = (e->>'lineId')::BIGINT
        AND poi.po_id = p_po_id
        AND poi.item_type = 'product'
    )
  ) THEN
    RAISE EXCEPTION 'Baris ini bukan baris produk PO ini. Muat ulang halaman.'
      USING ERRCODE = 'P0014';
  END IF;

  UPDATE purchase_order_items poi
  SET dn_note    = COALESCE(e->>'note', ''),
      updated_by = p_user_id
  FROM jsonb_array_elements(p_notes) AS e
  WHERE poi.id = (e->>'lineId')::BIGINT
    AND poi.po_id = p_po_id;

  UPDATE purchase_orders
  SET updated_by = p_user_id
  WHERE id = p_po_id
  RETURNING row_version INTO v_new;

  RETURN v_new;
END;
$function$
