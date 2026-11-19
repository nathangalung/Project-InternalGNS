-- Canonical current body of fn_issue_delivery_note (deployed by migration 00124).
CREATE OR REPLACE FUNCTION public.fn_issue_delivery_note(p_po_id bigint, p_user_id bigint)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_status TEXT;
  v_dn     TEXT;
BEGIN
  SELECT status, delivery_note_number INTO v_status, v_dn
    FROM purchase_orders WHERE id = p_po_id FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'PO tidak ditemukan. Muat ulang halaman.'
      USING ERRCODE = 'P0011';
  END IF;

  IF v_status NOT IN ('ON_PROGRESS', 'DELIVERED') THEN
    RAISE EXCEPTION 'Surat jalan tersedia setelah status PO Dalam Progres.'
      USING ERRCODE = 'P0013';
  END IF;

  IF v_dn IS NOT NULL THEN
    RETURN v_dn;
  END IF;

  v_dn := fn_next_doc_no('DN');

  UPDATE purchase_orders
  SET delivery_note_number = v_dn,
      delivery_note_date   = CURRENT_DATE,
      updated_by           = p_user_id
  WHERE id = p_po_id;

  INSERT INTO po_status_history (po_id, from_status, to_status, note, changed_by)
  VALUES (p_po_id, v_status, v_status, 'Nomor Surat Jalan ' || v_dn || ' diterbitkan', p_user_id);

  RETURN v_dn;
END;
$function$
