-- +goose Up

-- The invoice header PPN/DPP were generated columns derived from the summed
-- base (ROUND(SUM(dpp) * 11/12 ...)), while DJP e-faktur files the sum of the
-- per-line rounded values (SUM(ROUND(line))). The two disagree by up to 0.01
-- per line, so the printed invoice and the tax filing drift apart. Convert the
-- three header columns to plain columns populated from the per-line sums.
ALTER TABLE invoices ALTER COLUMN dpp_nilai_lain DROP EXPRESSION;
ALTER TABLE invoices ALTER COLUMN ppn_amount     DROP EXPRESSION;
ALTER TABLE invoices ALTER COLUMN total          DROP EXPRESSION;

-- Backfill every existing invoice to the sum of its line values. DJP reports
-- are filed per year; this restates historical headers to match what was filed
-- per line. Single-line invoices are unchanged. Invoices with no line items are
-- not matched by this join and retain their prior header values; that is
-- expected, since fn_create_invoice always inserts lines and a line-less
-- invoice should not exist.
--
-- Before deploying to production, run the read-only diff below to size the
-- per-year restatement (the delta to hand to whoever signs off with DJP) and to
-- confirm no line-less invoices need a separate decision:
--   SELECT date_part('year', i.invoice_date) AS yr, count(*),
--          sum(i.ppn_amount) AS old_ppn, sum(li.sum_ppn) AS new_ppn,
--          sum(li.sum_ppn - i.ppn_amount) AS delta
--   FROM invoices i JOIN (SELECT invoice_id, SUM(ppn_amount) sum_ppn
--                         FROM invoice_items GROUP BY invoice_id) li
--     ON li.invoice_id = i.id
--   GROUP BY 1 ORDER BY 1;
--   SELECT count(*) FROM invoices i
--    WHERE NOT EXISTS (SELECT 1 FROM invoice_items WHERE invoice_id = i.id);
UPDATE invoices inv SET
  dpp_nilai_lain = li.sum_dnl,
  ppn_amount     = li.sum_ppn,
  total          = inv.dpp + li.sum_ppn
FROM (
  SELECT invoice_id,
         COALESCE(SUM(dpp_nilai_lain), 0) AS sum_dnl,
         COALESCE(SUM(ppn_amount), 0)     AS sum_ppn
  FROM invoice_items
  GROUP BY invoice_id
) li
WHERE inv.id = li.invoice_id;

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION fn_create_invoice(p_po_id BIGINT, p_user_id BIGINT)
RETURNS BIGINT AS $$
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
    qty, unit_price, cost_price, ship_destination, goods_or_service,
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
    pi.cost_price,
    pi.ship_destination,
    CASE pi.item_type WHEN 'shipping' THEN 'J' ELSE 'B' END,
    pi.subtotal,
    ROUND(pi.subtotal * 11.0 / 12.0, 2),
    12.00,
    ROUND(pi.subtotal * 11.0 / 12.0 * 0.12, 2),
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

  RETURN v_inv_id;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

-- +goose Down

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION fn_create_invoice(p_po_id BIGINT, p_user_id BIGINT)
RETURNS BIGINT AS $$
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
    qty, unit_price, cost_price, ship_destination, goods_or_service,
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
    pi.cost_price,
    pi.ship_destination,
    CASE pi.item_type WHEN 'shipping' THEN 'J' ELSE 'B' END,
    pi.subtotal,
    ROUND(pi.subtotal * 11.0 / 12.0, 2),
    12.00,
    ROUND(pi.subtotal * 11.0 / 12.0 * 0.12, 2),
    p_user_id, p_user_id
  FROM purchase_order_items pi
  LEFT JOIN units u ON u.id = pi.unit_id
  WHERE pi.po_id = p_po_id
  ORDER BY pi.line_number;

  RETURN v_inv_id;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd

ALTER TABLE invoices DROP COLUMN dpp_nilai_lain, DROP COLUMN ppn_amount, DROP COLUMN total;
ALTER TABLE invoices
  ADD COLUMN dpp_nilai_lain NUMERIC(15,2) GENERATED ALWAYS AS (dpp * 11.0 / 12.0) STORED,
  ADD COLUMN ppn_amount     NUMERIC(15,2) GENERATED ALWAYS AS (dpp * 11.0 / 12.0 * 0.12) STORED,
  ADD COLUMN total          NUMERIC(15,2) GENERATED ALWAYS AS (dpp * 1.11) STORED;
