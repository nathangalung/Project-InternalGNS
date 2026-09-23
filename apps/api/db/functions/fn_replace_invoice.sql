-- Canonical current body of fn_replace_invoice (deployed by migration 00054).
CREATE OR REPLACE FUNCTION public.fn_replace_invoice(p_invoice_id bigint, p_user_id bigint)
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_status TEXT;
  v_po_id  BIGINT;
  v_new_id BIGINT;
BEGIN
  SELECT status, po_id INTO v_status, v_po_id
  FROM invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice % not found', p_invoice_id
      USING ERRCODE = 'P0011';
  END IF;

  IF v_status <> 'cancelled' THEN
    RAISE EXCEPTION 'Hanya invoice yang dibatalkan yang dapat diganti.'
      USING ERRCODE = 'P0012';
  END IF;

  IF v_po_id IS NULL THEN
    RAISE EXCEPTION 'Invoice ini tidak terhubung ke PO, sehingga tidak dapat diganti.'
      USING ERRCODE = 'P0012';
  END IF;

  -- Serialise with fn_change_po_status, which also creates invoices.
  PERFORM 1 FROM purchase_orders WHERE id = v_po_id FOR UPDATE;

  IF EXISTS (SELECT 1 FROM invoices WHERE replaces_invoice_id = p_invoice_id) THEN
    RAISE EXCEPTION 'Invoice ini sudah memiliki invoice pengganti.'
      USING ERRCODE = 'P0013';
  END IF;

  IF EXISTS (SELECT 1 FROM invoices WHERE po_id = v_po_id AND status <> 'cancelled') THEN
    RAISE EXCEPTION 'PO ini sudah memiliki invoice yang aktif.'
      USING ERRCODE = 'P0013';
  END IF;

  v_new_id := fn_create_invoice(v_po_id, p_user_id);
  RETURN v_new_id;
END;
$function$
