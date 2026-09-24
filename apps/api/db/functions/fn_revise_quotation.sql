-- Canonical current body of fn_revise_quotation (deployed by migration 00063).
CREATE OR REPLACE FUNCTION public.fn_revise_quotation(p_quotation_id bigint, p_user_id bigint, p_note text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_orig   quotations%ROWTYPE;
  v_new_id BIGINT;
  v_new_no TEXT;
  v_learn  TEXT;
BEGIN
  SELECT * INTO v_orig
  FROM quotations
  WHERE id = p_quotation_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quotation % tidak ditemukan.', p_quotation_id
      USING ERRCODE = 'P0011';
  END IF;

  IF v_orig.status <> 'sent' THEN
    RAISE EXCEPTION 'Hanya quotation berstatus Dikirim yang dapat direvisi; status saat ini %.',
      fn_quotation_status_label(v_orig.status)
      USING ERRCODE = 'P0012';
  END IF;

  -- Version n+1 prints as Rev.n on the base number.
  v_new_no := regexp_replace(v_orig.quotation_no, ' Rev\.[0-9]+$', '')
              || ' Rev.' || v_orig.version;

  INSERT INTO quotations (
    quotation_no, version, parent_id,
    company_client_id, company_client_name, contact_id, contact_name,
    client_ref_no, vessel_name, status, notes,
    payment_terms, validity_days, discount_pct,
    total_produk, total, total_discount,
    created_by, updated_by
  ) VALUES (
    v_new_no, v_orig.version + 1, v_orig.id,
    v_orig.company_client_id, v_orig.company_client_name, v_orig.contact_id, v_orig.contact_name,
    v_orig.client_ref_no, v_orig.vessel_name, 'draft', v_orig.notes,
    v_orig.payment_terms, v_orig.validity_days, v_orig.discount_pct,
    v_orig.total_produk, v_orig.total, v_orig.total_discount,
    p_user_id, p_user_id
  ) RETURNING id INTO v_new_id;

  UPDATE quotation_status_history
  SET note = 'Revisi dari ' || v_orig.quotation_no
  WHERE quotation_id = v_new_id;

  INSERT INTO quotation_item_requests (
    quotation_id, line_no, request_text, request_impa,
    requested_qty, requested_uom, matched_item_id, match_status,
    source_type, source_ref, notes, reviewed_by, reviewed_at,
    created_by, updated_by
  )
  SELECT v_new_id, r.line_no, r.request_text, r.request_impa,
         r.requested_qty, r.requested_uom, r.matched_item_id, r.match_status,
         r.source_type, r.source_ref, r.notes, r.reviewed_by, r.reviewed_at,
         p_user_id, p_user_id
  FROM quotation_item_requests r
  WHERE r.quotation_id = v_orig.id;

  -- The copy teaches trg_learn_match nothing.
  v_learn := current_setting('gns.learn_match', true);
  PERFORM set_config('gns.learn_match', 'off', true);

  -- Vendor cost sync stays off: the copy quotes no new price.
  INSERT INTO quotation_items (
    quotation_id, line_number, item_type,
    requested_item_id, requested_impa, requested_name,
    offered_item_id, vendor_product_id,
    qty, unit_id, selling_price, cost_price, discount_pct,
    is_available, ship_destination, due_date, shipping_days,
    update_vendor_price, request_id, created_by, updated_by
  )
  SELECT v_new_id, qi.line_number, qi.item_type,
         qi.requested_item_id, qi.requested_impa, qi.requested_name,
         qi.offered_item_id, qi.vendor_product_id,
         qi.qty, qi.unit_id, qi.selling_price, qi.cost_price, qi.discount_pct,
         qi.is_available, qi.ship_destination, qi.due_date, qi.shipping_days,
         FALSE, nr.id, p_user_id, p_user_id
  FROM quotation_items qi
  LEFT JOIN quotation_item_requests orr ON orr.id = qi.request_id
  LEFT JOIN quotation_item_requests nr
         ON nr.quotation_id = v_new_id AND nr.line_no = orr.line_no
  WHERE qi.quotation_id = v_orig.id
  ORDER BY qi.line_number;

  PERFORM set_config('gns.learn_match', COALESCE(v_learn, ''), true);

  UPDATE quotations
  SET status     = 'revision',
      updated_by = p_user_id
  WHERE id = v_orig.id;

  INSERT INTO quotation_status_history
    (quotation_id, from_status, to_status, note, changed_by)
  VALUES
    (v_orig.id, 'sent', 'revision',
     COALESCE(NULLIF(BTRIM(p_note), ''), 'Direvisi menjadi ' || v_new_no),
     p_user_id);

  RETURN v_new_id;
END;
$function$
