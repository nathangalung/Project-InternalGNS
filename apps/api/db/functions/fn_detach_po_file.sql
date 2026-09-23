-- Canonical current body of fn_detach_po_file (deployed by migration 00061).
CREATE OR REPLACE FUNCTION public.fn_detach_po_file(p_po_id bigint, p_user_id bigint)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
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
$function$
