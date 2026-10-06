-- Canonical current body of fn_update_po_details (deployed by migration 00103).
CREATE OR REPLACE FUNCTION public.fn_update_po_details(p_po_id bigint, p_if_match integer, p_po_number text, p_po_date date, p_user_id bigint)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_current INT;
  v_status  TEXT;
  v_number  TEXT := NULLIF(BTRIM(p_po_number), '');
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

  IF EXISTS (
    SELECT 1 FROM invoices
    WHERE po_id = p_po_id AND status IN ('sent', 'paid', 'overdue')
  ) THEN
    RAISE EXCEPTION 'Nomor dan tanggal PO % tidak dapat diubah setelah invoice dikirim.', p_po_id
      USING ERRCODE = 'P0013';
  END IF;

  -- Work in progress keeps its number.
  IF v_number IS NULL AND v_status IN ('ON_PROGRESS', 'DELIVERED') THEN
    RAISE EXCEPTION 'No. PO klien wajib diisi untuk PO yang sudah Dalam Progres atau Dikirim.'
      USING ERRCODE = 'P0014';
  END IF;

  UPDATE purchase_orders
  SET po_number  = v_number,
      po_date    = p_po_date,
      updated_by = p_user_id
  WHERE id = p_po_id
  RETURNING row_version INTO v_new;

  RETURN v_new;
END;
$function$
