-- Canonical current body of fn_create_quotation (deployed by migration 00092).
CREATE OR REPLACE FUNCTION public.fn_create_quotation(p_company_client_id bigint, p_contact_id bigint, p_client_ref_no text, p_vessel_name text, p_payment_terms text, p_validity_days integer, p_discount_pct numeric, p_shipping_address text, p_shipping_days integer, p_shipping_cost numeric, p_items jsonb, p_created_by bigint, p_notes text DEFAULT NULL::text, p_status text DEFAULT 'draft'::text)
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_quotation_id        BIGINT;
  v_quotation_no        TEXT;
  v_company_name        VARCHAR;
  v_contact_name        VARCHAR;
  v_item                JSONB;
  v_line_no             SMALLINT := 0;
  v_total_produk        NUMERIC(15,2) := 0;
  v_total               NUMERIC(15,2) := 0;
  v_total_discount      NUMERIC(15,2) := 0;
  v_qty                 NUMERIC(12,2);
  v_selling_price       NUMERIC(15,2);
  v_pct                 NUMERIC(5,2);
  v_line                NUMERIC(15,2);
  v_dpp                 NUMERIC(15,2) := 0;
  v_ppn                 NUMERIC(15,2) := 0;
BEGIN
  -- 1. Validation
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Quotation harus memiliki minimal satu baris.'
      USING ERRCODE = 'P0014';
  END IF;

  IF p_discount_pct < 0 OR p_discount_pct > 100 THEN
    RAISE EXCEPTION 'Diskon harus antara 0 dan 100; nilai yang dikirim %.', p_discount_pct
      USING ERRCODE = 'P0014';
  END IF;

  -- The pct the lines inherit, at column scale.
  v_pct := p_discount_pct;

  -- 2. Snapshot company_client_name + contact_name
  SELECT name INTO v_company_name
  FROM company_client WHERE id = p_company_client_id AND is_active = TRUE;

  IF v_company_name IS NULL THEN
    RAISE EXCEPTION 'Klien tidak ditemukan atau sudah nonaktif. Pilih klien lain.'
      USING ERRCODE = 'P0014';
  END IF;

  IF p_contact_id IS NOT NULL THEN
    SELECT name INTO v_contact_name
    FROM company_contacts
    WHERE id = p_contact_id AND company_id = p_company_client_id AND is_active = TRUE;

    IF v_contact_name IS NULL THEN
      RAISE EXCEPTION 'Narahubung tidak ditemukan, sudah nonaktif, atau bukan milik klien ini.'
        USING ERRCODE = 'P0014';
    END IF;
  END IF;

  -- Lines are prepared after the client checks, as fn_update_quotation
  -- prepares them after its row lock and status checks.
  p_items := fn_prepare_quotation_lines(p_items, p_created_by);

  -- 3. Pre-calculate totals. The discount is gross minus net per line, as
  -- quotation_items.subtotal and v_po_totals round them, so the header
  -- subtotal is the sum of the line subtotals. DPP and PPN are rounded per
  -- line and summed, as v_po_totals and fn_create_invoice do.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_item->>'qty')::NUMERIC(12,2);
    v_selling_price := (v_item->>'selling_price')::NUMERIC(15,2);
    v_line := ROUND(v_qty * v_selling_price * (1 - v_pct / 100), 2);

    v_total          := v_total + (v_qty * v_selling_price);
    v_total_produk   := v_total_produk + (v_qty * v_selling_price);
    v_total_discount := v_total_discount
                        + ROUND(v_qty * v_selling_price, 2)
                        - v_line;
    v_dpp            := v_dpp + fn_line_dpp(v_line);
    v_ppn            := v_ppn + fn_line_ppn(v_line);
  END LOOP;

  IF p_shipping_cost IS NOT NULL AND p_shipping_cost > 0 THEN
    v_total := v_total + p_shipping_cost;
    v_dpp   := v_dpp + fn_line_dpp(p_shipping_cost);
    v_ppn   := v_ppn + fn_line_ppn(p_shipping_cost);
  END IF;

  -- 4. Generate quotation_no
  v_quotation_no := fn_next_doc_no('Q', p_company_client_id);

  -- 5. INSERT header
  INSERT INTO quotations (
    quotation_no, version, company_client_id, company_client_name,
    contact_id, contact_name,
    client_ref_no, vessel_name, status,
    payment_terms, validity_days, discount_pct,
    total_produk, total, total_discount,
    dpp_nilai_lain, ppn_amount, grand_total,
    notes, created_by, updated_by
  ) VALUES (
    v_quotation_no, 1, p_company_client_id, v_company_name,
    p_contact_id, v_contact_name,
    p_client_ref_no, p_vessel_name, p_status,
    p_payment_terms, p_validity_days, p_discount_pct,
    v_total_produk, v_total, v_total_discount,
    v_dpp, v_ppn, v_total - v_total_discount + v_ppn,
    p_notes, p_created_by, p_created_by
  ) RETURNING id INTO v_quotation_id;

  -- 6. INSERT product items
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_line_no := v_line_no + 1;
    INSERT INTO quotation_items (
      quotation_id, line_number, item_type,
      requested_item_id, requested_impa, requested_name,
      offered_item_id, vendor_product_id,
      qty, unit_id, selling_price, cost_price,
      is_available, ship_destination, due_date,
      update_vendor_price, created_by, updated_by
    ) VALUES (
      v_quotation_id,
      v_line_no,
      'product',
      NULLIF((v_item->>'requested_item_id'),'')::BIGINT,
      v_item->>'requested_impa',
      v_item->>'requested_name',
      NULLIF((v_item->>'offered_item_id'),'')::BIGINT,
      NULLIF((v_item->>'vendor_product_id'),'')::BIGINT,
      (v_item->>'qty')::NUMERIC(12,2),
      (v_item->>'unit_id')::SMALLINT,
      (v_item->>'selling_price')::NUMERIC(15,2),
      NULLIF((v_item->>'cost_price'),'')::NUMERIC(15,2),
      COALESCE((v_item->>'is_available')::BOOLEAN, TRUE),
      v_item->>'ship_destination',
      NULLIF((v_item->>'due_date'),'')::DATE,
      COALESCE((v_item->>'update_vendor_price')::BOOLEAN, FALSE),
      p_created_by, p_created_by
    );
  END LOOP;

  -- 7. INSERT shipping line
  IF NULLIF(TRIM(p_shipping_address), '') IS NOT NULL OR COALESCE(p_shipping_cost, 0) > 0
     OR p_shipping_days IS NOT NULL THEN
    v_line_no := v_line_no + 1;
    INSERT INTO quotation_items (
      quotation_id, line_number, item_type,
      requested_name,
      qty, unit_id, selling_price,
      ship_destination, shipping_days,
      created_by, updated_by
    ) VALUES (
      v_quotation_id,
      v_line_no,
      'shipping',
      'SHIPPING' || COALESCE(' — ' || p_shipping_address, ''),
      1,
      (SELECT id FROM units WHERE code = 'UNIT' LIMIT 1),
      COALESCE(p_shipping_cost, 0),
      p_shipping_address,
      p_shipping_days,
      p_created_by, p_created_by
    );
  END IF;

  RETURN v_quotation_id;
END;
$function$
