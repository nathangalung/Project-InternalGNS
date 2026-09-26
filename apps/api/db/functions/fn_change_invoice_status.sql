-- Canonical current body of fn_change_invoice_status (deployed by migration 00065).
CREATE OR REPLACE FUNCTION public.fn_change_invoice_status(p_invoice_id bigint, p_target text, p_user_id bigint, p_note text DEFAULT NULL::text, p_proof_key text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_current VARCHAR(20);
  v_po_id   BIGINT;
  v_note    TEXT := NULLIF(btrim(p_note), '');
  v_proof   TEXT := NULLIF(btrim(p_proof_key), '');
  v_allowed BOOLEAN := FALSE;
BEGIN
  SELECT status, po_id INTO v_current, v_po_id
  FROM invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice % not found', p_invoice_id
      USING ERRCODE = 'P0011';
  END IF;

  IF p_target NOT IN ('draft','sent','paid','overdue','cancelled') THEN
    RAISE EXCEPTION 'Status invoice tidak dikenal.'
      USING ERRCODE = 'P0014';
  END IF;

  IF v_current = p_target THEN
    RETURN;
  END IF;

  -- Mirrored by invoices.Transitions.
  IF v_current = 'draft' AND p_target IN ('sent','cancelled') THEN
    v_allowed := TRUE;
  END IF;
  IF v_current IN ('sent','overdue') AND p_target IN ('paid','cancelled') THEN
    v_allowed := TRUE;
  END IF;

  IF NOT v_allowed THEN
    RAISE EXCEPTION 'Perubahan status invoice ini tidak diizinkan.'
      USING ERRCODE = 'P0012';
  END IF;

  IF p_target = 'cancelled' AND v_note IS NULL THEN
    RAISE EXCEPTION 'Alasan pembatalan invoice wajib diisi.'
      USING ERRCODE = 'P0014';
  END IF;

  IF p_target = 'cancelled' AND v_po_id IS NULL THEN
    RAISE EXCEPTION 'Invoice tanpa PO tidak dapat dibatalkan karena invoice penggantinya tidak dapat diterbitkan.'
      USING ERRCODE = 'P0012';
  END IF;

  IF v_proof IS NOT NULL AND p_target <> 'paid' THEN
    RAISE EXCEPTION 'Bukti pembayaran hanya dapat dilampirkan saat invoice ditandai Dibayar.'
      USING ERRCODE = 'P0014';
  END IF;

  -- The key must address this invoice's payment folder, never its
  -- attachment or another invoice's upload.
  IF v_proof IS NOT NULL
     AND NOT starts_with(v_proof, 'invoices/' || p_invoice_id || '/payment/') THEN
    RAISE EXCEPTION 'Berkas bukti pembayaran tidak dikenali. Unggah ulang berkasnya lalu simpan kembali.'
      USING ERRCODE = 'P0014';
  END IF;

  UPDATE invoices
  SET status            = p_target,
      paid_at           = CASE WHEN p_target = 'paid' THEN NOW() ELSE paid_at END,
      payment_proof_key = CASE WHEN p_target = 'paid' THEN v_proof ELSE payment_proof_key END,
      updated_by        = p_user_id
  WHERE id = p_invoice_id;

  INSERT INTO invoice_status_history
    (invoice_id, from_status, to_status, note, payment_proof_key, changed_by)
  VALUES
    (p_invoice_id, v_current, p_target, v_note, v_proof, p_user_id);
END;
$function$
