-- +goose Up
-- 00110 INVOICE PAYMENT TERMS
-- An invoice keeps the payment terms its quotation agreed with the client,
-- copied once when the invoice is made, like its buyer. When the terms are
-- a plain count of days ("30 days", "Net 45 days", "14 hari") the invoice
-- falls due that many days after its date; any other terms keep the 30 day
-- default. Invoices made before this keep no terms and their dates, so a
-- reprint prints what it printed before.
ALTER TABLE invoices ADD COLUMN payment_terms VARCHAR(100);

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_terms_days(p_terms text)
 RETURNS integer
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE WHEN m.n BETWEEN 1 AND 365 THEN m.n END
  FROM (
    SELECT substring(lower(btrim(p_terms)) FROM '^(?:net\s*)?(\d{1,3})\s*(?:days?|hari)$')::int AS n
  ) m
$function$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_create_invoice(p_po_id bigint, p_user_id bigint)
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
  v_ppn_on        BOOLEAN;
  v_terms         TEXT;
BEGIN
  -- A cancelled invoice is void, so only a live one makes this a no-op.
  SELECT id INTO v_inv_id FROM invoices
  WHERE po_id = p_po_id AND status <> 'cancelled';
  IF v_inv_id IS NOT NULL THEN
    RETURN v_inv_id;
  END IF;

  SELECT quotation_id, company_client_id, ppn_enabled INTO v_quotation_id, v_company_id, v_ppn_on
  FROM purchase_orders WHERE id = p_po_id;

  IF v_quotation_id IS NULL THEN
    RAISE EXCEPTION 'PO tidak ditemukan. Muat ulang halaman.'
      USING ERRCODE = 'P0011';
  END IF;

  -- The terms the client agreed on the quotation.
  SELECT NULLIF(btrim(payment_terms), '') INTO v_terms
  FROM quotations WHERE id = v_quotation_id;

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

  v_inv_no := fn_next_doc_no('INV');

  -- The buyer and the terms are stored as they are now.
  INSERT INTO invoices (
    invoice_no, quotation_id, po_id, company_client_id,
    buyer_name, buyer_npwp, buyer_address, payment_terms,
    invoice_date, due_date, subtotal, dpp,
    status, faktur_type, replaces_invoice_id, created_by, updated_by, ppn_enabled
  )
  SELECT
    v_inv_no, v_quotation_id, p_po_id, v_company_id,
    cc.name, cc.npwp, cc.address, v_terms,
    CURRENT_DATE, CURRENT_DATE + COALESCE(fn_terms_days(v_terms), 30),
    v_dpp, v_dpp,
    'draft',
    CASE WHEN v_replaces_id IS NULL THEN 'Normal' ELSE 'Pengganti' END,
    v_replaces_id,
    p_user_id, p_user_id, v_ppn_on
  FROM company_client cc
  WHERE cc.id = v_company_id
  RETURNING id INTO v_inv_id;

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
    -- Without PPN the line carries no tax base, rate or PPN.
    CASE WHEN v_ppn_on THEN ROUND(pi.subtotal * 11.0 / 12.0, 2) ELSE 0.00 END,
    CASE WHEN v_ppn_on THEN 12.00 ELSE 0.00 END,
    CASE WHEN v_ppn_on THEN ROUND(ROUND(pi.subtotal * 11.0 / 12.0, 2) * 0.12, 2) ELSE 0.00 END,
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

-- +goose Down
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_create_invoice(p_po_id bigint, p_user_id bigint)
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
  v_ppn_on        BOOLEAN;
BEGIN
  -- A cancelled invoice is void, so only a live one makes this a no-op.
  SELECT id INTO v_inv_id FROM invoices
  WHERE po_id = p_po_id AND status <> 'cancelled';
  IF v_inv_id IS NOT NULL THEN
    RETURN v_inv_id;
  END IF;

  SELECT quotation_id, company_client_id, ppn_enabled INTO v_quotation_id, v_company_id, v_ppn_on
  FROM purchase_orders WHERE id = p_po_id;

  IF v_quotation_id IS NULL THEN
    RAISE EXCEPTION 'PO tidak ditemukan. Muat ulang halaman.'
      USING ERRCODE = 'P0011';
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

  v_inv_no := fn_next_doc_no('INV');

  -- The buyer is stored as the client is now.
  INSERT INTO invoices (
    invoice_no, quotation_id, po_id, company_client_id,
    buyer_name, buyer_npwp, buyer_address,
    invoice_date, due_date, subtotal, dpp,
    status, faktur_type, replaces_invoice_id, created_by, updated_by, ppn_enabled
  )
  SELECT
    v_inv_no, v_quotation_id, p_po_id, v_company_id,
    cc.name, cc.npwp, cc.address,
    CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days',
    v_dpp, v_dpp,
    'draft',
    CASE WHEN v_replaces_id IS NULL THEN 'Normal' ELSE 'Pengganti' END,
    v_replaces_id,
    p_user_id, p_user_id, v_ppn_on
  FROM company_client cc
  WHERE cc.id = v_company_id
  RETURNING id INTO v_inv_id;

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
    -- Without PPN the line carries no tax base, rate or PPN.
    CASE WHEN v_ppn_on THEN ROUND(pi.subtotal * 11.0 / 12.0, 2) ELSE 0.00 END,
    CASE WHEN v_ppn_on THEN 12.00 ELSE 0.00 END,
    CASE WHEN v_ppn_on THEN ROUND(ROUND(pi.subtotal * 11.0 / 12.0, 2) * 0.12, 2) ELSE 0.00 END,
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

DROP FUNCTION IF EXISTS public.fn_terms_days(text);
ALTER TABLE invoices DROP COLUMN IF EXISTS payment_terms;
