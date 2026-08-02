-- Canonical current body of fn_change_po_status (deployed by migration 00046).
CREATE OR REPLACE FUNCTION public.fn_change_po_status(p_po_id bigint, p_new_status text, p_user_id bigint)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
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

  IF p_new_status = 'DELIVERED' AND v_dn_current IS NULL THEN
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
$function$
