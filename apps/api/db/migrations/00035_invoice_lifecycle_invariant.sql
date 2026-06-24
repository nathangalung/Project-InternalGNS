-- +goose Up

-- Backfill the lifecycle invariant: an existing invoice implies its PO is
-- DELIVERED and its quotation is accepted. Seed data inserted invoices
-- directly, bypassing the state machine, so some POs stayed PENDING.

-- Advance every PO that has an invoice to DELIVERED, stamping a delivery
-- note number the same way fn_change_po_status would. Idempotent.
UPDATE purchase_orders po
   SET status               = 'DELIVERED',
       delivery_note_number = COALESCE(
         po.delivery_note_number,
         fn_next_doc_no('DN', po.company_client_id)
       )
 WHERE po.status <> 'DELIVERED'
   AND EXISTS (SELECT 1 FROM invoices i WHERE i.po_id = po.id);

-- Accept every quotation that already has an invoice. Idempotent.
UPDATE quotations q
   SET status = 'accepted'
 WHERE q.status <> 'accepted'
   AND EXISTS (SELECT 1 FROM invoices i WHERE i.quotation_id = q.id);

-- Block reverting a DELIVERED PO once its invoice exists, which would
-- otherwise break the invariant at runtime.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION fn_change_po_status(
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
    RAISE EXCEPTION 'Purchase order % not found', p_po_id;
  END IF;

  IF v_old = p_new_status THEN
    RETURN;
  END IF;

  IF v_old = 'DELIVERED' AND p_new_status = 'ON_PROGRESS'
     AND EXISTS (SELECT 1 FROM invoices WHERE po_id = p_po_id) THEN
    RAISE EXCEPTION 'PO % has an invoice; cannot revert from DELIVERED', p_po_id;
  END IF;

  v_ok := CASE
    WHEN v_old = 'PENDING'     AND p_new_status IN ('UPLOADED')                        THEN TRUE
    WHEN v_old = 'UPLOADED'    AND p_new_status IN ('ON_PROGRESS','PENDING')           THEN TRUE
    WHEN v_old = 'ON_PROGRESS' AND p_new_status IN ('DELIVERED','UPLOADED')            THEN TRUE
    WHEN v_old = 'DELIVERED'   AND p_new_status IN ('ON_PROGRESS')                     THEN TRUE
    ELSE FALSE
  END;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'Invalid PO status transition: % -> %', v_old, p_new_status;
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
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- +goose Down

-- Restore the function without the invoice guard. Backfilled data is left
-- as is; reverting status would itself break the invariant.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION fn_change_po_status(
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
    RAISE EXCEPTION 'Purchase order % not found', p_po_id;
  END IF;

  IF v_old = p_new_status THEN
    RETURN;
  END IF;

  v_ok := CASE
    WHEN v_old = 'PENDING'     AND p_new_status IN ('UPLOADED')                        THEN TRUE
    WHEN v_old = 'UPLOADED'    AND p_new_status IN ('ON_PROGRESS','PENDING')           THEN TRUE
    WHEN v_old = 'ON_PROGRESS' AND p_new_status IN ('DELIVERED','UPLOADED')            THEN TRUE
    WHEN v_old = 'DELIVERED'   AND p_new_status IN ('ON_PROGRESS')                     THEN TRUE
    ELSE FALSE
  END;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'Invalid PO status transition: % -> %', v_old, p_new_status;
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
$$ LANGUAGE plpgsql;
-- +goose StatementEnd
