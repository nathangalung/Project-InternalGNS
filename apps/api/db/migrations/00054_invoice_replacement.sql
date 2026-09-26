-- +goose NO TRANSACTION

-- +goose Up
-- A cancelled invoice may be replaced by a Pengganti invoice for the same PO.
--
-- 1. replaces_invoice_id links a replacement to the cancelled invoice it
--    corrects. It is unique, so a cancelled invoice is replaced at most once.
-- 2. uq_invoices_po_id narrows to live rows: one non-cancelled invoice per PO
--    stays a schema invariant, while a void one no longer blocks the PO.
--    The new index is built before the old one is dropped, so the invariant
--    holds throughout. idx_invoices_po serves the unfiltered po_id lookups
--    the old unique index used to serve.
-- 3. fn_create_invoice ignores cancelled rows in its idempotency check, and
--    an invoice it creates for a PO that has an unreplaced cancelled invoice
--    is the Pengganti of that invoice.
-- 4. fn_replace_invoice is the explicit correction: it refuses anything but
--    a cancelled, not yet replaced invoice and delegates to fn_create_invoice.
--
-- Filed invoices are not restated: existing rows keep their numbers, amounts
-- and faktur_type. Every statement is idempotent, so a retry after a partial
-- run is safe.

ALTER TABLE invoices
  ADD COLUMN IF NOT EXISTS replaces_invoice_id BIGINT REFERENCES invoices(id);

CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_invoices_replaces_invoice_id
  ON invoices (replaces_invoice_id) WHERE replaces_invoice_id IS NOT NULL;

DROP INDEX CONCURRENTLY IF EXISTS uq_invoices_po_id_live;
CREATE UNIQUE INDEX CONCURRENTLY uq_invoices_po_id_live
  ON invoices (po_id) WHERE po_id IS NOT NULL AND status <> 'cancelled';
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_po ON invoices (po_id);
DROP INDEX CONCURRENTLY IF EXISTS uq_invoices_po_id;

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION fn_create_invoice(p_po_id bigint, p_user_id bigint)
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_inv_id        BIGINT;
  v_inv_no        TEXT;
  v_quotation_id  BIGINT;
  v_company_id    BIGINT;
  v_dpp           NUMERIC(15,2);
  v_replaces_id   BIGINT;
BEGIN
  -- A cancelled invoice is void, so only a live one makes this a no-op.
  SELECT id INTO v_inv_id FROM invoices
  WHERE po_id = p_po_id AND status <> 'cancelled';
  IF v_inv_id IS NOT NULL THEN
    RETURN v_inv_id;
  END IF;

  SELECT quotation_id, company_client_id INTO v_quotation_id, v_company_id
  FROM purchase_orders WHERE id = p_po_id;

  IF v_quotation_id IS NULL THEN
    RAISE EXCEPTION 'Purchase order % not found', p_po_id;
  END IF;

  -- The newest cancelled invoice nothing replaces yet is the one corrected.
  SELECT c.id INTO v_replaces_id
  FROM invoices c
  WHERE c.po_id = p_po_id
    AND c.status = 'cancelled'
    AND NOT EXISTS (SELECT 1 FROM invoices r WHERE r.replaces_invoice_id = c.id)
  ORDER BY c.id DESC
  LIMIT 1;

  SELECT COALESCE(SUM(subtotal), 0) INTO v_dpp
  FROM purchase_order_items WHERE po_id = p_po_id;

  v_inv_no := fn_next_doc_no('INV', v_company_id);

  INSERT INTO invoices (
    invoice_no, quotation_id, po_id, company_client_id,
    invoice_date, due_date, subtotal, dpp,
    status, faktur_type, replaces_invoice_id, created_by, updated_by
  ) VALUES (
    v_inv_no, v_quotation_id, p_po_id, v_company_id,
    CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days',
    v_dpp, v_dpp,
    'draft',
    CASE WHEN v_replaces_id IS NULL THEN 'Normal' ELSE 'Pengganti' END,
    v_replaces_id,
    p_user_id, p_user_id
  ) RETURNING id INTO v_inv_id;

  INSERT INTO invoice_items (
    invoice_id, quotation_item_id, line_type, line_number,
    item_name, item_code, offered_item_id, unit_id, unit_code,
    qty, unit_price, gross_unit_price, cost_price, ship_destination, goods_or_service,
    dpp, dpp_nilai_lain, ppn_rate, ppn_amount,
    created_by, updated_by
  )
  SELECT
    v_inv_id, pi.quotation_item_id, pi.item_type, pi.line_number,
    COALESCE(pi.item_name, ''), pi.item_code, pi.offered_item_id, pi.unit_id, u.code,
    pi.qty,
    CASE
      WHEN pi.item_type = 'product' THEN pi.selling_price * (1 - pi.discount_pct / 100)
      ELSE pi.selling_price
    END,
    pi.selling_price,
    pi.cost_price,
    pi.ship_destination,
    CASE pi.item_type WHEN 'shipping' THEN 'J' ELSE 'B' END,
    pi.subtotal,
    ROUND(pi.subtotal * 11.0 / 12.0, 2),
    12.00,
    ROUND(ROUND(pi.subtotal * 11.0 / 12.0, 2) * 0.12, 2),
    p_user_id, p_user_id
  FROM purchase_order_items pi
  LEFT JOIN units u ON u.id = pi.unit_id
  WHERE pi.po_id = p_po_id
  ORDER BY pi.line_number;

  -- Header totals are the sum of the per-line rounded values.
  UPDATE invoices inv SET
    dpp_nilai_lain = li.sum_dnl,
    ppn_amount     = li.sum_ppn,
    total          = inv.dpp + li.sum_ppn
  FROM (
    SELECT COALESCE(SUM(dpp_nilai_lain), 0) AS sum_dnl,
           COALESCE(SUM(ppn_amount), 0)     AS sum_ppn
    FROM invoice_items WHERE invoice_id = v_inv_id
  ) li
  WHERE inv.id = v_inv_id;

  -- Realised discount = gross line amounts minus the net subtotals that make
  -- up dpp. Read from purchase_order_items: invoice_items.unit_price is
  -- already net, so the same difference there would be zero. Gross is rounded
  -- per line, matching both the generated subtotal column and the per-line
  -- Amount printed on the PDF, so shipping lines contribute exactly 0.
  UPDATE invoices SET total_discount = (
    SELECT COALESCE(SUM(ROUND(pi.qty * pi.selling_price, 2)) - SUM(pi.subtotal), 0)
    FROM purchase_order_items pi
    WHERE pi.po_id = p_po_id
  )
  WHERE id = v_inv_id;

  RETURN v_inv_id;
END;
$function$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION fn_replace_invoice(p_invoice_id bigint, p_user_id bigint)
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
$function$;
-- +goose StatementEnd

-- +goose Down
-- Restore one invoice per PO first, so a PO that holds a cancelled invoice
-- and its replacement fails the rollback before anything else changes.
-- Drop-then-create repairs an INVALID leftover from an earlier failed run;
-- after a failed rollback, drop uq_invoices_po_id before serving traffic, as
-- the leftover still enforces uniqueness on writes.
DROP INDEX CONCURRENTLY IF EXISTS uq_invoices_po_id;
CREATE UNIQUE INDEX CONCURRENTLY uq_invoices_po_id
  ON invoices (po_id) WHERE po_id IS NOT NULL;

DROP FUNCTION IF EXISTS fn_replace_invoice(bigint, bigint);

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION fn_create_invoice(p_po_id bigint, p_user_id bigint)
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_inv_id        BIGINT;
  v_inv_no        TEXT;
  v_quotation_id  BIGINT;
  v_company_id    BIGINT;
  v_dpp           NUMERIC(15,2);
BEGIN
  SELECT id INTO v_inv_id FROM invoices WHERE po_id = p_po_id;
  IF v_inv_id IS NOT NULL THEN
    RETURN v_inv_id;
  END IF;

  SELECT quotation_id, company_client_id INTO v_quotation_id, v_company_id
  FROM purchase_orders WHERE id = p_po_id;

  IF v_quotation_id IS NULL THEN
    RAISE EXCEPTION 'Purchase order % not found', p_po_id;
  END IF;

  SELECT COALESCE(SUM(subtotal), 0) INTO v_dpp
  FROM purchase_order_items WHERE po_id = p_po_id;

  v_inv_no := fn_next_doc_no('INV', v_company_id);

  INSERT INTO invoices (
    invoice_no, quotation_id, po_id, company_client_id,
    invoice_date, due_date, subtotal, dpp,
    status, created_by, updated_by
  ) VALUES (
    v_inv_no, v_quotation_id, p_po_id, v_company_id,
    CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days',
    v_dpp, v_dpp,
    'draft', p_user_id, p_user_id
  ) RETURNING id INTO v_inv_id;

  INSERT INTO invoice_items (
    invoice_id, quotation_item_id, line_type, line_number,
    item_name, item_code, offered_item_id, unit_id, unit_code,
    qty, unit_price, gross_unit_price, cost_price, ship_destination, goods_or_service,
    dpp, dpp_nilai_lain, ppn_rate, ppn_amount,
    created_by, updated_by
  )
  SELECT
    v_inv_id, pi.quotation_item_id, pi.item_type, pi.line_number,
    COALESCE(pi.item_name, ''), pi.item_code, pi.offered_item_id, pi.unit_id, u.code,
    pi.qty,
    CASE
      WHEN pi.item_type = 'product' THEN pi.selling_price * (1 - pi.discount_pct / 100)
      ELSE pi.selling_price
    END,
    pi.selling_price,
    pi.cost_price,
    pi.ship_destination,
    CASE pi.item_type WHEN 'shipping' THEN 'J' ELSE 'B' END,
    pi.subtotal,
    ROUND(pi.subtotal * 11.0 / 12.0, 2),
    12.00,
    ROUND(ROUND(pi.subtotal * 11.0 / 12.0, 2) * 0.12, 2),
    p_user_id, p_user_id
  FROM purchase_order_items pi
  LEFT JOIN units u ON u.id = pi.unit_id
  WHERE pi.po_id = p_po_id
  ORDER BY pi.line_number;

  UPDATE invoices inv SET
    dpp_nilai_lain = li.sum_dnl,
    ppn_amount     = li.sum_ppn,
    total          = inv.dpp + li.sum_ppn
  FROM (
    SELECT COALESCE(SUM(dpp_nilai_lain), 0) AS sum_dnl,
           COALESCE(SUM(ppn_amount), 0)     AS sum_ppn
    FROM invoice_items WHERE invoice_id = v_inv_id
  ) li
  WHERE inv.id = v_inv_id;

  UPDATE invoices SET total_discount = (
    SELECT COALESCE(SUM(ROUND(pi.qty * pi.selling_price, 2)) - SUM(pi.subtotal), 0)
    FROM purchase_order_items pi
    WHERE pi.po_id = p_po_id
  )
  WHERE id = v_inv_id;

  RETURN v_inv_id;
END;
$function$;
-- +goose StatementEnd

DROP INDEX CONCURRENTLY IF EXISTS idx_invoices_po;
DROP INDEX CONCURRENTLY IF EXISTS uq_invoices_po_id_live;
DROP INDEX CONCURRENTLY IF EXISTS uq_invoices_replaces_invoice_id;
ALTER TABLE invoices DROP COLUMN IF EXISTS replaces_invoice_id;
