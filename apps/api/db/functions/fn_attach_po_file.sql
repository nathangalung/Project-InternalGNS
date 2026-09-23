-- Canonical current body of fn_attach_po_file (deployed by migration 00061).
CREATE OR REPLACE FUNCTION public.fn_attach_po_file(p_po_id bigint, p_file_name text, p_file_size bigint, p_file_url text, p_user_id bigint)
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
$function$
