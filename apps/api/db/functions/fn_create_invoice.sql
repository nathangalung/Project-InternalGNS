-- Canonical current body of fn_create_invoice (deployed by migration 00039).
-- Snapshots a delivered PO's items into a draft invoice. Line tax figures are
-- rounded per line; the header tax figures are the SUM of those per-line values
-- so the invoice matches what is filed with DJP per line via e-faktur.
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

  RETURN v_inv_id;
END;
$$ LANGUAGE plpgsql;
