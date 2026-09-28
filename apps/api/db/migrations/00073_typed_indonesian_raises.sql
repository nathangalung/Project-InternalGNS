-- +goose Up

-- 00073 TYPED INDONESIAN RAISES
-- httperr maps a raise's SQLSTATE to a status and passes its message into
-- the problem detail, and the untyped raise (P0001) is passed through as it
-- is. Several functions still raised in English, some without a code, so a
-- user could read "discount_pct must be between 0 and 100" or
-- "company_client_id 12 not found or inactive". Every raise now carries a
-- typed code and Indonesian text:
--   P0011 a missing row (the repos map it to their own 404),
--   P0010 a stale version (mapped to the 409 version conflict),
--   P0013 a state that forbids the change,
--   P0014 rejected input (422).
-- The inactive client and the foreign contact on create move from P0001 to
-- P0014, and a missing quotation or PO inside the document chain from P0001
-- to P0011. Status codes the API returns are unchanged. The
-- db/functions raise lint keeps new raises typed and Indonesian.

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_attach_po_file(p_po_id bigint, p_file_name text, p_file_size bigint, p_file_url text, p_user_id bigint)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_old TEXT;
BEGIN
  SELECT status INTO v_old
    FROM purchase_orders WHERE id = p_po_id FOR UPDATE;

  IF v_old IS NULL THEN
    RAISE EXCEPTION 'PO % tidak ditemukan.', p_po_id
      USING ERRCODE = 'P0011';
  END IF;

  IF v_old IN ('DELIVERED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Berkas PO tidak dapat diubah setelah PO dikirim atau dibatalkan.'
      USING ERRCODE = 'P0013';
  END IF;

  UPDATE purchase_orders
  SET file_name   = p_file_name,
      file_size   = p_file_size,
      file_url    = p_file_url,
      uploaded_at = NOW(),
      updated_by  = p_user_id,
      status      = CASE WHEN v_old = 'PENDING' THEN 'UPLOADED' ELSE status END
  WHERE id = p_po_id;

  IF v_old = 'PENDING' THEN
    INSERT INTO po_status_history (po_id, from_status, to_status, note, changed_by)
    VALUES (p_po_id, 'PENDING', 'UPLOADED', 'Berkas PO diunggah', p_user_id);
  END IF;
END;
$function$;
-- +goose StatementEnd

-- +goose StatementBegin
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
    RAISE EXCEPTION 'Invoice % tidak ditemukan.', p_invoice_id
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
$function$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_change_po_status(p_po_id bigint, p_new_status text, p_user_id bigint, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_old        TEXT;
  v_ok         BOOLEAN;
  v_company_id BIGINT;
  v_dn_current TEXT;
  v_file       TEXT;
  v_dn         TEXT;
  v_note       TEXT := NULLIF(BTRIM(p_note), '');
BEGIN
  SELECT status, company_client_id, delivery_note_number, file_url
    INTO v_old, v_company_id, v_dn_current, v_file
    FROM purchase_orders WHERE id = p_po_id FOR UPDATE;

  IF v_old IS NULL THEN
    RAISE EXCEPTION 'PO % tidak ditemukan.', p_po_id
      USING ERRCODE = 'P0011';
  END IF;

  IF v_old = p_new_status THEN
    RETURN;
  END IF;

  IF v_old IN ('DELIVERED', 'CANCELLED') THEN
    RAISE EXCEPTION 'PO yang sudah dikirim atau dibatalkan tidak dapat diubah statusnya.'
      USING ERRCODE = 'P0012';
  END IF;

  -- PENDING and UPLOADED follow the file.
  IF (v_old = 'PENDING' AND p_new_status = 'UPLOADED')
     OR (v_old = 'UPLOADED' AND p_new_status = 'PENDING') THEN
    RAISE EXCEPTION 'Status ini mengikuti berkas PO. Unggah atau hapus berkas PO untuk mengubahnya.'
      USING ERRCODE = 'P0012';
  END IF;

  v_ok := CASE
    WHEN v_old = 'PENDING'     AND p_new_status IN ('CANCELLED')                        THEN TRUE
    WHEN v_old = 'UPLOADED'    AND p_new_status IN ('ON_PROGRESS','CANCELLED')          THEN TRUE
    WHEN v_old = 'ON_PROGRESS' AND p_new_status IN ('DELIVERED','UPLOADED','CANCELLED') THEN TRUE
    ELSE FALSE
  END;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'Perubahan status PO ini tidak diizinkan.'
      USING ERRCODE = 'P0012';
  END IF;

  IF p_new_status = 'CANCELLED' AND v_note IS NULL THEN
    RAISE EXCEPTION 'Alasan pembatalan wajib diisi.'
      USING ERRCODE = 'P0014';
  END IF;

  IF p_new_status = 'UPLOADED' AND v_file IS NULL THEN
    RAISE EXCEPTION 'PO belum memiliki berkas. Unggah berkas PO terlebih dahulu.'
      USING ERRCODE = 'P0012';
  END IF;

  -- Work needs a priced product.
  IF p_new_status IN ('ON_PROGRESS', 'DELIVERED') AND (
    NOT EXISTS (
      SELECT 1 FROM purchase_order_items
      WHERE po_id = p_po_id AND item_type = 'product'
    )
    OR EXISTS (
      SELECT 1 FROM purchase_order_items
      WHERE po_id = p_po_id AND item_type = 'product'
        AND (selling_price IS NULL OR selling_price <= 0)
    )
  ) THEN
    RAISE EXCEPTION 'PO harus memiliki minimal satu baris produk dan setiap baris produk harus memiliki harga jual. Lengkapi melalui Ubah PO.'
      USING ERRCODE = 'P0012';
  END IF;

  IF p_new_status IN ('ON_PROGRESS', 'DELIVERED') AND v_dn_current IS NULL THEN
    v_dn := fn_next_doc_no('DN', v_company_id);
  END IF;

  UPDATE purchase_orders
  SET status               = p_new_status,
      delivery_note_number = COALESCE(v_dn, delivery_note_number),
      updated_by           = p_user_id
  WHERE id = p_po_id;

  INSERT INTO po_status_history (po_id, from_status, to_status, note, changed_by)
  VALUES (p_po_id, v_old, p_new_status, v_note, p_user_id);

  IF p_new_status = 'DELIVERED' THEN
    PERFORM fn_create_invoice(p_po_id, p_user_id);
  END IF;
END;
$function$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_change_quotation_status(p_quotation_id bigint, p_new_status text, p_user_id bigint, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_old_status VARCHAR(20);
  v_valid      BOOLEAN;
BEGIN
  SELECT status INTO v_old_status
  FROM quotations
  WHERE id = p_quotation_id
  FOR UPDATE;

  IF v_old_status IS NULL THEN
    RAISE EXCEPTION 'Quotation % tidak ditemukan.', p_quotation_id
      USING ERRCODE = 'P0011';
  END IF;

  IF v_old_status = p_new_status THEN
    RETURN;
  END IF;

  -- Mirrored by quotations.Transitions in Go.
  v_valid := CASE
    WHEN v_old_status = 'draft'    AND p_new_status IN ('sent','cancelled') THEN TRUE
    WHEN v_old_status = 'sent'     AND p_new_status IN ('accepted','rejected','cancelled') THEN TRUE
    WHEN v_old_status = 'revision' AND p_new_status IN ('rejected','cancelled') THEN TRUE
    ELSE FALSE
  END;

  IF NOT v_valid THEN
    IF p_new_status = 'revision' AND v_old_status = 'sent' THEN
      RAISE EXCEPTION 'Gunakan tombol Buat Revisi untuk merevisi quotation yang sudah dikirim.'
        USING ERRCODE = 'P0012';
    END IF;
    IF p_new_status = 'expired' THEN
      RAISE EXCEPTION 'Status Kedaluwarsa diberikan otomatis setelah masa berlaku quotation habis.'
        USING ERRCODE = 'P0012';
    END IF;
    RAISE EXCEPTION 'Status quotation tidak dapat diubah dari % ke %.',
      fn_quotation_status_label(v_old_status), fn_quotation_status_label(p_new_status)
      USING ERRCODE = 'P0012';
  END IF;

  IF p_new_status IN ('rejected','cancelled') AND NULLIF(BTRIM(p_note), '') IS NULL THEN
    RAISE EXCEPTION 'Alasan wajib diisi untuk mengubah status menjadi %.',
      fn_quotation_status_label(p_new_status)
      USING ERRCODE = 'P0014';
  END IF;

  IF p_new_status IN ('sent','accepted') THEN
    IF EXISTS (
      SELECT 1 FROM quotation_items
      WHERE quotation_id = p_quotation_id
        AND item_type = 'product'
        AND (selling_price IS NULL OR selling_price <= 0)
    ) THEN
      RAISE EXCEPTION 'Quotation % masih memiliki baris produk tanpa harga jual.', p_quotation_id
        USING ERRCODE = 'P0100';
    END IF;
  END IF;

  UPDATE quotations
  SET status     = p_new_status,
      updated_by = p_user_id
  WHERE id = p_quotation_id;

  INSERT INTO quotation_status_history
    (quotation_id, from_status, to_status, note, changed_by)
  VALUES
    (p_quotation_id, v_old_status, p_new_status, p_note, p_user_id);

  IF p_new_status = 'accepted' THEN
    PERFORM fn_create_purchase_order(p_quotation_id, p_user_id);
  END IF;
END;
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
    RAISE EXCEPTION 'PO % tidak ditemukan.', p_po_id
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
CREATE OR REPLACE FUNCTION public.fn_create_purchase_order(p_quotation_id bigint, p_user_id bigint)
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_po_id        BIGINT;
  v_po_no        TEXT;
  v_company_id   BIGINT;
  v_contact_id   BIGINT;
BEGIN
  SELECT id INTO v_po_id FROM purchase_orders WHERE quotation_id = p_quotation_id;
  IF v_po_id IS NOT NULL THEN
    RETURN v_po_id;
  END IF;

  SELECT company_client_id, contact_id
  INTO v_company_id, v_contact_id
  FROM quotations WHERE id = p_quotation_id;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Quotation % tidak ditemukan.', p_quotation_id
      USING ERRCODE = 'P0011';
  END IF;

  v_po_no := fn_next_doc_no('PO', v_company_id);

  INSERT INTO purchase_orders (
    po_number, quotation_id, company_client_id, contact_id,
    po_date, status, created_by, updated_by
  ) VALUES (
    v_po_no, p_quotation_id, v_company_id, v_contact_id,
    CURRENT_DATE, 'PENDING', p_user_id, p_user_id
  ) RETURNING id INTO v_po_id;

  INSERT INTO purchase_order_items (
    po_id, quotation_item_id, line_number, item_type,
    offered_item_id, qty, unit_id, selling_price, cost_price,
    item_name, item_code, ship_destination, shipping_days,
    is_available, created_by, updated_by
  )
  SELECT
    v_po_id, qi.id, qi.line_number, qi.item_type,
    qi.offered_item_id, qi.qty, qi.unit_id, qi.selling_price, qi.cost_price,
    COALESCE(NULLIF(oi.name, ''), qi.requested_name, ''),
    CASE WHEN oi.id IS NOT NULL THEN NULLIF(oi.impa_code, '') ELSE qi.requested_impa END,
    qi.ship_destination, qi.shipping_days,
    qi.is_available, p_user_id, p_user_id
  FROM quotation_items qi
  LEFT JOIN items oi ON oi.id = qi.offered_item_id
  WHERE qi.quotation_id = p_quotation_id
  ORDER BY qi.line_number;

  RETURN v_po_id;
END;
$function$;
-- +goose StatementEnd

-- +goose StatementBegin
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

  -- 3. Pre-calculate totals. The discount is gross minus net per line, as
  -- quotation_items.subtotal and v_po_totals round them, so the header
  -- subtotal is the sum of the line subtotals.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_item->>'qty')::NUMERIC(12,2);
    v_selling_price := (v_item->>'selling_price')::NUMERIC(15,2);

    v_total          := v_total + (v_qty * v_selling_price);
    v_total_produk   := v_total_produk + (v_qty * v_selling_price);
    v_total_discount := v_total_discount
                        + ROUND(v_qty * v_selling_price, 2)
                        - ROUND(v_qty * v_selling_price * (1 - v_pct / 100), 2);
  END LOOP;

  IF p_shipping_cost IS NOT NULL AND p_shipping_cost > 0 THEN
    v_total := v_total + p_shipping_cost;
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
    notes, created_by, updated_by
  ) VALUES (
    v_quotation_no, 1, p_company_client_id, v_company_name,
    p_contact_id, v_contact_name,
    p_client_ref_no, p_vessel_name, p_status,
    p_payment_terms, p_validity_days, p_discount_pct,
    v_total_produk, v_total, v_total_discount,
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
  IF NULLIF(TRIM(p_shipping_address), '') IS NOT NULL OR COALESCE(p_shipping_cost, 0) > 0 THEN
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
$function$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_detach_po_file(p_po_id bigint, p_user_id bigint)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_old TEXT;
BEGIN
  SELECT status INTO v_old
    FROM purchase_orders WHERE id = p_po_id FOR UPDATE;

  IF v_old IS NULL THEN
    RAISE EXCEPTION 'PO % tidak ditemukan.', p_po_id
      USING ERRCODE = 'P0011';
  END IF;

  IF v_old NOT IN ('PENDING', 'UPLOADED') THEN
    RAISE EXCEPTION 'Berkas PO tidak dapat dihapus setelah PO diproses, dikirim, atau dibatalkan.'
      USING ERRCODE = 'P0013';
  END IF;

  UPDATE purchase_orders
  SET file_name   = NULL,
      file_size   = NULL,
      file_url    = NULL,
      uploaded_at = NULL,
      updated_by  = p_user_id,
      status      = 'PENDING'
  WHERE id = p_po_id;

  IF v_old = 'UPLOADED' THEN
    INSERT INTO po_status_history (po_id, from_status, to_status, note, changed_by)
    VALUES (p_po_id, 'UPLOADED', 'PENDING', 'Berkas PO dihapus', p_user_id);
  END IF;
END;
$function$;
-- +goose StatementEnd

-- +goose StatementBegin
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
    RAISE EXCEPTION 'Invoice % tidak ditemukan.', p_invoice_id
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

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_update_po_details(p_po_id bigint, p_if_match integer, p_po_number text, p_po_date date, p_user_id bigint)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_current INT;
  v_new     INT;
BEGIN
  SELECT row_version INTO v_current
  FROM purchase_orders
  WHERE id = p_po_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PO % tidak ditemukan.', p_po_id
      USING ERRCODE = 'P0011';
  END IF;

  IF p_if_match IS NOT NULL AND v_current <> p_if_match THEN
    RAISE EXCEPTION 'Data sudah diubah pengguna lain (versi %, dikirim %).', v_current, p_if_match
      USING ERRCODE = 'P0010';
  END IF;

  IF EXISTS (
    SELECT 1 FROM invoices
    WHERE po_id = p_po_id AND status IN ('sent', 'paid', 'overdue')
  ) THEN
    RAISE EXCEPTION 'Nomor dan tanggal PO % tidak dapat diubah setelah invoice dikirim.', p_po_id
      USING ERRCODE = 'P0013';
  END IF;

  UPDATE purchase_orders
  SET po_number  = p_po_number,
      po_date    = p_po_date,
      updated_by = p_user_id
  WHERE id = p_po_id
  RETURNING row_version INTO v_new;

  RETURN v_new;
END;
$function$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_update_po_items(p_po_id bigint, p_user_id bigint, p_discount_pct numeric, p_notes text, p_shipping_address text, p_shipping_days integer, p_shipping_cost numeric, p_items jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_status VARCHAR(20);
  v_line   INT := 0;
  it       JSONB;
BEGIN
  SELECT status INTO v_status
  FROM purchase_orders
  WHERE id = p_po_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'PO % tidak ditemukan.', p_po_id
      USING ERRCODE = 'P0011';
  END IF;

  IF v_status IN ('DELIVERED', 'CANCELLED') THEN
    RAISE EXCEPTION 'PO yang sudah dikirim atau dibatalkan tidak dapat diubah.'
      USING ERRCODE = 'P0013';
  END IF;

  IF p_discount_pct IS NULL OR p_discount_pct < 0 OR p_discount_pct > 100 THEN
    RAISE EXCEPTION 'Diskon harus antara 0 dan 100.'
      USING ERRCODE = 'P0014';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'Daftar baris PO tidak valid.'
      USING ERRCODE = 'P0014';
  END IF;

  -- Every element becomes a product line.
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'PO harus memiliki minimal satu baris produk.'
      USING ERRCODE = 'P0014';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) AS e
    WHERE COALESCE(NULLIF(e->>'sellingPrice', '')::NUMERIC, 0) <= 0
  ) THEN
    RAISE EXCEPTION 'Semua baris produk harus memiliki harga jual.'
      USING ERRCODE = 'P0014';
  END IF;

  UPDATE purchase_orders
  SET discount_pct = p_discount_pct,
      notes        = p_notes,
      updated_by   = p_user_id
  WHERE id = p_po_id;

  DELETE FROM purchase_order_items WHERE po_id = p_po_id;

  FOR it IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_line := v_line + 1;
    INSERT INTO purchase_order_items (
      po_id, quotation_item_id, line_number, item_type,
      offered_item_id, item_name, item_code,
      qty, unit_id, selling_price, cost_price,
      discount_pct, is_available, ship_destination,
      created_by, updated_by
    ) VALUES (
      p_po_id,
      NULLIF(it->>'quotationItemId','')::BIGINT,
      v_line,
      'product',
      NULLIF(it->>'offeredItemId','')::BIGINT,
      COALESCE(it->>'itemName',''),
      NULLIF(it->>'itemCode',''),
      COALESCE(NULLIF(it->>'qty','')::NUMERIC, 0),
      NULLIF(it->>'unitId','')::SMALLINT,
      COALESCE(NULLIF(it->>'sellingPrice','')::NUMERIC, 0),
      NULLIF(it->>'costPrice','')::NUMERIC,
      p_discount_pct,
      COALESCE((it->>'isAvailable')::BOOLEAN, TRUE),
      NULLIF(it->>'shipDestination',''),
      p_user_id,
      p_user_id
    );
  END LOOP;

  IF p_shipping_address IS NOT NULL AND TRIM(p_shipping_address) <> '' THEN
    v_line := v_line + 1;
    INSERT INTO purchase_order_items (
      po_id, line_number, item_type,
      item_name, qty, selling_price,
      discount_pct, is_available, ship_destination, shipping_days,
      created_by, updated_by
    ) VALUES (
      p_po_id,
      v_line,
      'shipping',
      'Pengiriman',
      1,
      COALESCE(p_shipping_cost, 0),
      0,
      TRUE,
      p_shipping_address,
      p_shipping_days,
      p_user_id,
      p_user_id
    );
  END IF;
END;
$function$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_update_po_items_versioned(p_po_id bigint, p_if_match integer, p_user_id bigint, p_discount_pct numeric, p_notes text, p_shipping_address text, p_shipping_days integer, p_shipping_cost numeric, p_items jsonb)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_current INT;
  v_new     INT;
BEGIN
  SELECT row_version INTO v_current
  FROM purchase_orders
  WHERE id = p_po_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PO % tidak ditemukan.', p_po_id USING ERRCODE = 'P0011';
  END IF;

  IF v_current <> p_if_match THEN
    RAISE EXCEPTION 'Data sudah diubah pengguna lain (versi %, dikirim %).', v_current, p_if_match
      USING ERRCODE = 'P0010';
  END IF;

  PERFORM fn_update_po_items(
    p_po_id, p_user_id, p_discount_pct, p_notes,
    p_shipping_address, p_shipping_days, p_shipping_cost, p_items
  );

  SELECT row_version INTO v_new FROM purchase_orders WHERE id = p_po_id;
  RETURN v_new;
END;
$function$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_update_po_notes(p_po_id bigint, p_if_match integer, p_notes text, p_user_id bigint)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_current INT;
  v_new     INT;
BEGIN
  SELECT row_version INTO v_current
  FROM purchase_orders
  WHERE id = p_po_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PO % tidak ditemukan.', p_po_id
      USING ERRCODE = 'P0011';
  END IF;

  IF p_if_match IS NOT NULL AND v_current <> p_if_match THEN
    RAISE EXCEPTION 'Data sudah diubah pengguna lain (versi %, dikirim %).', v_current, p_if_match
      USING ERRCODE = 'P0010';
  END IF;

  UPDATE purchase_orders
  SET notes      = p_notes,
      updated_by = p_user_id
  WHERE id = p_po_id
  RETURNING row_version INTO v_new;

  RETURN v_new;
END;
$function$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_update_quotation(p_id bigint, p_client_ref_no text, p_vessel_name text, p_payment_terms text, p_validity_days integer, p_discount_pct numeric, p_shipping_address text, p_shipping_days integer, p_shipping_cost numeric, p_items jsonb, p_user_id bigint, p_notes text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_status        VARCHAR(20);
  v_item          JSONB;
  v_line_no       SMALLINT := 0;
  v_total_produk  NUMERIC(15,2) := 0;
  v_total         NUMERIC(15,2) := 0;
  v_total_disc    NUMERIC(15,2) := 0;
  v_qty           NUMERIC(12,2);
  v_selling_price NUMERIC(15,2);
  v_learn         TEXT;
  v_known         JSONB;
  v_key           TEXT;
  v_left          INT;
  v_pct           NUMERIC(5,2);
BEGIN
  -- 1. Lock + verify status='draft'
  SELECT status INTO v_status
  FROM quotations
  WHERE id = p_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Quotation % tidak ditemukan.', p_id
      USING ERRCODE = 'P0011';
  END IF;

  IF v_status != 'draft' THEN
    RAISE EXCEPTION 'Hanya quotation berstatus Draf yang dapat diubah; status saat ini %.',
      fn_quotation_status_label(v_status)
      USING ERRCODE = 'P0013';
  END IF;

  -- 2. Validation
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Quotation harus memiliki minimal satu baris.'
      USING ERRCODE = 'P0014';
  END IF;

  IF p_discount_pct < 0 OR p_discount_pct > 100 THEN
    RAISE EXCEPTION 'Diskon harus antara 0 dan 100; nilai yang dikirim %.', p_discount_pct
      USING ERRCODE = 'P0014';
  END IF;

  -- 3. Pre-calculate totals. The discount is gross minus net per line at
  -- the pct the lines inherit, as quotation_items.subtotal and v_po_totals
  -- round them, so the header subtotal is the sum of the line subtotals.
  v_pct := p_discount_pct;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_item->>'qty')::NUMERIC(12,2);
    v_selling_price := (v_item->>'selling_price')::NUMERIC(15,2);
    v_total        := v_total + (v_qty * v_selling_price);
    v_total_produk := v_total_produk + (v_qty * v_selling_price);
    v_total_disc   := v_total_disc
                      + ROUND(v_qty * v_selling_price, 2)
                      - ROUND(v_qty * v_selling_price * (1 - v_pct / 100), 2);
  END LOOP;

  IF p_shipping_cost IS NOT NULL AND p_shipping_cost > 0 THEN
    v_total := v_total + p_shipping_cost;
  END IF;

  -- 4. Count the matches already learned, keyed like trg_learn_match
  -- (item id, then LOWER(TRIM(request text))), so a re-saved line is not
  -- counted again.
  SELECT COALESCE(jsonb_object_agg(k, n), '{}'::jsonb) INTO v_known
  FROM (
    SELECT requested_item_id::TEXT || ':' || LOWER(TRIM(requested_name)) AS k,
           COUNT(*) AS n
    FROM quotation_items
    WHERE quotation_id = p_id
      AND requested_item_id IS NOT NULL
      AND requested_name IS NOT NULL
      AND TRIM(requested_name) != ''
    GROUP BY 1
  ) s;

  -- 5. DELETE existing items.
  -- PO/invoice referencing items will be set NULL via FK ON DELETE SET NULL.
  -- Since status='draft', there are usually no PO/invoice yet — safe.
  DELETE FROM quotation_items WHERE quotation_id = p_id;

  -- 6. UPDATE header.
  -- discount_pct UPDATE bypasses trg_protect_quotation_discount because
  -- status='draft' (trigger only blocks when status != 'draft').
  -- trg_cascade_quotation_discount will fire but affect 0 rows
  -- (items already deleted).
  UPDATE quotations
  SET client_ref_no  = p_client_ref_no,
      vessel_name    = p_vessel_name,
      payment_terms  = p_payment_terms,
      validity_days  = p_validity_days,
      discount_pct   = p_discount_pct,
      total_produk   = v_total_produk,
      total          = v_total,
      total_discount = v_total_disc,
      notes          = p_notes,
      updated_by     = p_user_id
  WHERE id = p_id;

  -- 7. INSERT product items (trigger inherit discount_pct fires BEFORE INSERT).
  -- Each line whose match was already on the draft uses up one known
  -- occurrence and skips trg_learn_match; the rest learn as on create.
  v_learn := current_setting('gns.learn_match', true);
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_line_no := v_line_no + 1;
    v_key := (NULLIF((v_item->>'requested_item_id'),'')::BIGINT)::TEXT
             || ':' || LOWER(TRIM(v_item->>'requested_name'));
    v_left := COALESCE((v_known->>v_key)::INT, 0);
    IF v_left > 0 THEN
      v_known := jsonb_set(v_known, ARRAY[v_key], to_jsonb(v_left - 1));
      PERFORM set_config('gns.learn_match', 'off', true);
    ELSE
      PERFORM set_config('gns.learn_match', COALESCE(v_learn, ''), true);
    END IF;

    INSERT INTO quotation_items (
      quotation_id, line_number, item_type,
      requested_item_id, requested_impa, requested_name,
      offered_item_id, vendor_product_id,
      qty, unit_id, selling_price, cost_price,
      is_available, ship_destination, due_date,
      update_vendor_price, created_by, updated_by
    ) VALUES (
      p_id,
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
      p_user_id, p_user_id
    );
  END LOOP;
  PERFORM set_config('gns.learn_match', COALESCE(v_learn, ''), true);

  -- 8. INSERT shipping line (if present)
  IF NULLIF(TRIM(p_shipping_address), '') IS NOT NULL OR COALESCE(p_shipping_cost, 0) > 0 THEN
    v_line_no := v_line_no + 1;
    INSERT INTO quotation_items (
      quotation_id, line_number, item_type,
      requested_name,
      qty, unit_id, selling_price,
      ship_destination, shipping_days,
      created_by, updated_by
    ) VALUES (
      p_id,
      v_line_no,
      'shipping',
      'SHIPPING' || COALESCE(' — ' || p_shipping_address, ''),
      1,
      (SELECT id FROM units WHERE code = 'UNIT' LIMIT 1),
      COALESCE(p_shipping_cost, 0),
      p_shipping_address,
      p_shipping_days,
      p_user_id, p_user_id
    );
  END IF;

  RETURN p_id;
END;
$function$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_update_quotation_versioned(p_id bigint, p_if_match integer, p_client_ref_no text, p_vessel_name text, p_payment_terms text, p_validity_days integer, p_discount_pct numeric, p_shipping_address text, p_shipping_days integer, p_shipping_cost numeric, p_items jsonb, p_user_id bigint, p_notes text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_current INT;
  v_new     INT;
BEGIN
  SELECT row_version INTO v_current
  FROM quotations
  WHERE id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quotation % tidak ditemukan.', p_id USING ERRCODE = 'P0011';
  END IF;

  IF v_current <> p_if_match THEN
    RAISE EXCEPTION 'Data sudah diubah pengguna lain (versi %, dikirim %).', v_current, p_if_match
      USING ERRCODE = 'P0010';
  END IF;

  PERFORM fn_update_quotation(
    p_id, p_client_ref_no, p_vessel_name, p_payment_terms,
    p_validity_days, p_discount_pct, p_shipping_address,
    p_shipping_days, p_shipping_cost, p_items, p_user_id, p_notes
  );

  SELECT row_version INTO v_new FROM quotations WHERE id = p_id;
  RETURN v_new;
END;
$function$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.trg_fn_protect_quotation_discount()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.discount_pct IS DISTINCT FROM OLD.discount_pct
     AND OLD.status != 'draft' THEN
    RAISE EXCEPTION
      'Diskon quotation % hanya dapat diubah saat berstatus Draf; status saat ini %. Buat revisi untuk mengubahnya.',
      OLD.quotation_no, fn_quotation_status_label(OLD.status)
      USING ERRCODE = 'P0013';
  END IF;
  RETURN NEW;
END;
$function$;
-- +goose StatementEnd

-- +goose Down

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_attach_po_file(p_po_id bigint, p_file_name text, p_file_size bigint, p_file_url text, p_user_id bigint)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_old TEXT;
BEGIN
  SELECT status INTO v_old
    FROM purchase_orders WHERE id = p_po_id FOR UPDATE;

  IF v_old IS NULL THEN
    RAISE EXCEPTION 'Purchase order % not found', p_po_id
      USING ERRCODE = 'P0011';
  END IF;

  IF v_old IN ('DELIVERED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Berkas PO tidak dapat diubah setelah PO dikirim atau dibatalkan.'
      USING ERRCODE = 'P0013';
  END IF;

  UPDATE purchase_orders
  SET file_name   = p_file_name,
      file_size   = p_file_size,
      file_url    = p_file_url,
      uploaded_at = NOW(),
      updated_by  = p_user_id,
      status      = CASE WHEN v_old = 'PENDING' THEN 'UPLOADED' ELSE status END
  WHERE id = p_po_id;

  IF v_old = 'PENDING' THEN
    INSERT INTO po_status_history (po_id, from_status, to_status, note, changed_by)
    VALUES (p_po_id, 'PENDING', 'UPLOADED', 'Berkas PO diunggah', p_user_id);
  END IF;
END;
$function$;
-- +goose StatementEnd

-- +goose StatementBegin
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
$function$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_change_po_status(p_po_id bigint, p_new_status text, p_user_id bigint, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_old        TEXT;
  v_ok         BOOLEAN;
  v_company_id BIGINT;
  v_dn_current TEXT;
  v_file       TEXT;
  v_dn         TEXT;
  v_note       TEXT := NULLIF(BTRIM(p_note), '');
BEGIN
  SELECT status, company_client_id, delivery_note_number, file_url
    INTO v_old, v_company_id, v_dn_current, v_file
    FROM purchase_orders WHERE id = p_po_id FOR UPDATE;

  IF v_old IS NULL THEN
    RAISE EXCEPTION 'Purchase order % not found', p_po_id
      USING ERRCODE = 'P0011';
  END IF;

  IF v_old = p_new_status THEN
    RETURN;
  END IF;

  IF v_old IN ('DELIVERED', 'CANCELLED') THEN
    RAISE EXCEPTION 'PO yang sudah dikirim atau dibatalkan tidak dapat diubah statusnya.'
      USING ERRCODE = 'P0012';
  END IF;

  -- PENDING and UPLOADED follow the file.
  IF (v_old = 'PENDING' AND p_new_status = 'UPLOADED')
     OR (v_old = 'UPLOADED' AND p_new_status = 'PENDING') THEN
    RAISE EXCEPTION 'Status ini mengikuti berkas PO. Unggah atau hapus berkas PO untuk mengubahnya.'
      USING ERRCODE = 'P0012';
  END IF;

  v_ok := CASE
    WHEN v_old = 'PENDING'     AND p_new_status IN ('CANCELLED')                        THEN TRUE
    WHEN v_old = 'UPLOADED'    AND p_new_status IN ('ON_PROGRESS','CANCELLED')          THEN TRUE
    WHEN v_old = 'ON_PROGRESS' AND p_new_status IN ('DELIVERED','UPLOADED','CANCELLED') THEN TRUE
    ELSE FALSE
  END;

  IF NOT v_ok THEN
    RAISE EXCEPTION 'Perubahan status PO ini tidak diizinkan.'
      USING ERRCODE = 'P0012';
  END IF;

  IF p_new_status = 'CANCELLED' AND v_note IS NULL THEN
    RAISE EXCEPTION 'Alasan pembatalan wajib diisi.'
      USING ERRCODE = 'P0014';
  END IF;

  IF p_new_status = 'UPLOADED' AND v_file IS NULL THEN
    RAISE EXCEPTION 'PO belum memiliki berkas. Unggah berkas PO terlebih dahulu.'
      USING ERRCODE = 'P0012';
  END IF;

  -- Work needs a priced product.
  IF p_new_status IN ('ON_PROGRESS', 'DELIVERED') AND (
    NOT EXISTS (
      SELECT 1 FROM purchase_order_items
      WHERE po_id = p_po_id AND item_type = 'product'
    )
    OR EXISTS (
      SELECT 1 FROM purchase_order_items
      WHERE po_id = p_po_id AND item_type = 'product'
        AND (selling_price IS NULL OR selling_price <= 0)
    )
  ) THEN
    RAISE EXCEPTION 'PO harus memiliki minimal satu baris produk dan setiap baris produk harus memiliki harga jual. Lengkapi melalui Ubah PO.'
      USING ERRCODE = 'P0012';
  END IF;

  IF p_new_status IN ('ON_PROGRESS', 'DELIVERED') AND v_dn_current IS NULL THEN
    v_dn := fn_next_doc_no('DN', v_company_id);
  END IF;

  UPDATE purchase_orders
  SET status               = p_new_status,
      delivery_note_number = COALESCE(v_dn, delivery_note_number),
      updated_by           = p_user_id
  WHERE id = p_po_id;

  INSERT INTO po_status_history (po_id, from_status, to_status, note, changed_by)
  VALUES (p_po_id, v_old, p_new_status, v_note, p_user_id);

  IF p_new_status = 'DELIVERED' THEN
    PERFORM fn_create_invoice(p_po_id, p_user_id);
  END IF;
END;
$function$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_change_quotation_status(p_quotation_id bigint, p_new_status text, p_user_id bigint, p_note text DEFAULT NULL::text)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_old_status VARCHAR(20);
  v_valid      BOOLEAN;
BEGIN
  SELECT status INTO v_old_status
  FROM quotations
  WHERE id = p_quotation_id
  FOR UPDATE;

  IF v_old_status IS NULL THEN
    RAISE EXCEPTION 'Quotation % tidak ditemukan.', p_quotation_id
      USING ERRCODE = 'P0011';
  END IF;

  IF v_old_status = p_new_status THEN
    RETURN;
  END IF;

  -- Mirrored by quotations.Transitions in Go.
  v_valid := CASE
    WHEN v_old_status = 'draft'    AND p_new_status IN ('sent','cancelled') THEN TRUE
    WHEN v_old_status = 'sent'     AND p_new_status IN ('accepted','rejected','cancelled') THEN TRUE
    WHEN v_old_status = 'revision' AND p_new_status IN ('rejected','cancelled') THEN TRUE
    ELSE FALSE
  END;

  IF NOT v_valid THEN
    IF p_new_status = 'revision' AND v_old_status = 'sent' THEN
      RAISE EXCEPTION 'Gunakan tombol Buat Revisi untuk merevisi quotation yang sudah dikirim.'
        USING ERRCODE = 'P0012';
    END IF;
    IF p_new_status = 'expired' THEN
      RAISE EXCEPTION 'Status Kedaluwarsa diberikan otomatis setelah masa berlaku quotation habis.'
        USING ERRCODE = 'P0012';
    END IF;
    RAISE EXCEPTION 'Status quotation tidak dapat diubah dari % ke %.',
      fn_quotation_status_label(v_old_status), fn_quotation_status_label(p_new_status)
      USING ERRCODE = 'P0012';
  END IF;

  IF p_new_status IN ('rejected','cancelled') AND NULLIF(BTRIM(p_note), '') IS NULL THEN
    RAISE EXCEPTION 'Alasan wajib diisi untuk mengubah status menjadi %.',
      fn_quotation_status_label(p_new_status)
      USING ERRCODE = 'P0014';
  END IF;

  IF p_new_status IN ('sent','accepted') THEN
    IF EXISTS (
      SELECT 1 FROM quotation_items
      WHERE quotation_id = p_quotation_id
        AND item_type = 'product'
        AND (selling_price IS NULL OR selling_price <= 0)
    ) THEN
      RAISE EXCEPTION 'Quotation % has unpriced products', p_quotation_id
        USING ERRCODE = 'P0100';
    END IF;
  END IF;

  UPDATE quotations
  SET status     = p_new_status,
      updated_by = p_user_id
  WHERE id = p_quotation_id;

  INSERT INTO quotation_status_history
    (quotation_id, from_status, to_status, note, changed_by)
  VALUES
    (p_quotation_id, v_old_status, p_new_status, p_note, p_user_id);

  IF p_new_status = 'accepted' THEN
    PERFORM fn_create_purchase_order(p_quotation_id, p_user_id);
  END IF;
END;
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
CREATE OR REPLACE FUNCTION public.fn_create_purchase_order(p_quotation_id bigint, p_user_id bigint)
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_po_id        BIGINT;
  v_po_no        TEXT;
  v_company_id   BIGINT;
  v_contact_id   BIGINT;
BEGIN
  SELECT id INTO v_po_id FROM purchase_orders WHERE quotation_id = p_quotation_id;
  IF v_po_id IS NOT NULL THEN
    RETURN v_po_id;
  END IF;

  SELECT company_client_id, contact_id
  INTO v_company_id, v_contact_id
  FROM quotations WHERE id = p_quotation_id;

  IF v_company_id IS NULL THEN
    RAISE EXCEPTION 'Quotation % not found', p_quotation_id;
  END IF;

  v_po_no := fn_next_doc_no('PO', v_company_id);

  INSERT INTO purchase_orders (
    po_number, quotation_id, company_client_id, contact_id,
    po_date, status, created_by, updated_by
  ) VALUES (
    v_po_no, p_quotation_id, v_company_id, v_contact_id,
    CURRENT_DATE, 'PENDING', p_user_id, p_user_id
  ) RETURNING id INTO v_po_id;

  INSERT INTO purchase_order_items (
    po_id, quotation_item_id, line_number, item_type,
    offered_item_id, qty, unit_id, selling_price, cost_price,
    item_name, item_code, ship_destination, shipping_days,
    is_available, created_by, updated_by
  )
  SELECT
    v_po_id, qi.id, qi.line_number, qi.item_type,
    qi.offered_item_id, qi.qty, qi.unit_id, qi.selling_price, qi.cost_price,
    COALESCE(NULLIF(oi.name, ''), qi.requested_name, ''),
    CASE WHEN oi.id IS NOT NULL THEN NULLIF(oi.impa_code, '') ELSE qi.requested_impa END,
    qi.ship_destination, qi.shipping_days,
    qi.is_available, p_user_id, p_user_id
  FROM quotation_items qi
  LEFT JOIN items oi ON oi.id = qi.offered_item_id
  WHERE qi.quotation_id = p_quotation_id
  ORDER BY qi.line_number;

  RETURN v_po_id;
END;
$function$;
-- +goose StatementEnd

-- +goose StatementBegin
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
BEGIN
  -- 1. Validation
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Quotation must have at least 1 item';
  END IF;

  IF p_discount_pct < 0 OR p_discount_pct > 100 THEN
    RAISE EXCEPTION 'discount_pct must be 0..100, got %', p_discount_pct;
  END IF;

  -- The pct the lines inherit, at column scale.
  v_pct := p_discount_pct;

  -- 2. Snapshot company_client_name + contact_name
  SELECT name INTO v_company_name
  FROM company_client WHERE id = p_company_client_id AND is_active = TRUE;

  IF v_company_name IS NULL THEN
    RAISE EXCEPTION 'company_client_id % not found or inactive', p_company_client_id;
  END IF;

  IF p_contact_id IS NOT NULL THEN
    SELECT name INTO v_contact_name
    FROM company_contacts
    WHERE id = p_contact_id AND company_id = p_company_client_id AND is_active = TRUE;

    IF v_contact_name IS NULL THEN
      RAISE EXCEPTION 'contact_id % not found or not belong to company %', p_contact_id, p_company_client_id;
    END IF;
  END IF;

  -- 3. Pre-calculate totals. The discount is gross minus net per line, as
  -- quotation_items.subtotal and v_po_totals round them, so the header
  -- subtotal is the sum of the line subtotals.
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_item->>'qty')::NUMERIC(12,2);
    v_selling_price := (v_item->>'selling_price')::NUMERIC(15,2);

    v_total          := v_total + (v_qty * v_selling_price);
    v_total_produk   := v_total_produk + (v_qty * v_selling_price);
    v_total_discount := v_total_discount
                        + ROUND(v_qty * v_selling_price, 2)
                        - ROUND(v_qty * v_selling_price * (1 - v_pct / 100), 2);
  END LOOP;

  IF p_shipping_cost IS NOT NULL AND p_shipping_cost > 0 THEN
    v_total := v_total + p_shipping_cost;
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
    notes, created_by, updated_by
  ) VALUES (
    v_quotation_no, 1, p_company_client_id, v_company_name,
    p_contact_id, v_contact_name,
    p_client_ref_no, p_vessel_name, p_status,
    p_payment_terms, p_validity_days, p_discount_pct,
    v_total_produk, v_total, v_total_discount,
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
  IF NULLIF(TRIM(p_shipping_address), '') IS NOT NULL OR COALESCE(p_shipping_cost, 0) > 0 THEN
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
$function$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_detach_po_file(p_po_id bigint, p_user_id bigint)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_old TEXT;
BEGIN
  SELECT status INTO v_old
    FROM purchase_orders WHERE id = p_po_id FOR UPDATE;

  IF v_old IS NULL THEN
    RAISE EXCEPTION 'Purchase order % not found', p_po_id
      USING ERRCODE = 'P0011';
  END IF;

  IF v_old NOT IN ('PENDING', 'UPLOADED') THEN
    RAISE EXCEPTION 'Berkas PO tidak dapat dihapus setelah PO diproses, dikirim, atau dibatalkan.'
      USING ERRCODE = 'P0013';
  END IF;

  UPDATE purchase_orders
  SET file_name   = NULL,
      file_size   = NULL,
      file_url    = NULL,
      uploaded_at = NULL,
      updated_by  = p_user_id,
      status      = 'PENDING'
  WHERE id = p_po_id;

  IF v_old = 'UPLOADED' THEN
    INSERT INTO po_status_history (po_id, from_status, to_status, note, changed_by)
    VALUES (p_po_id, 'UPLOADED', 'PENDING', 'Berkas PO dihapus', p_user_id);
  END IF;
END;
$function$;
-- +goose StatementEnd

-- +goose StatementBegin
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
$function$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_update_po_details(p_po_id bigint, p_if_match integer, p_po_number text, p_po_date date, p_user_id bigint)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_current INT;
  v_new     INT;
BEGIN
  SELECT row_version INTO v_current
  FROM purchase_orders
  WHERE id = p_po_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order % not found', p_po_id
      USING ERRCODE = 'P0011';
  END IF;

  IF p_if_match IS NOT NULL AND v_current <> p_if_match THEN
    RAISE EXCEPTION 'row_version mismatch (expected %, got %)', v_current, p_if_match
      USING ERRCODE = 'P0010';
  END IF;

  IF EXISTS (
    SELECT 1 FROM invoices
    WHERE po_id = p_po_id AND status IN ('sent', 'paid', 'overdue')
  ) THEN
    RAISE EXCEPTION 'PO % has a filed invoice; po_number and po_date are read-only', p_po_id
      USING ERRCODE = 'P0013';
  END IF;

  UPDATE purchase_orders
  SET po_number  = p_po_number,
      po_date    = p_po_date,
      updated_by = p_user_id
  WHERE id = p_po_id
  RETURNING row_version INTO v_new;

  RETURN v_new;
END;
$function$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_update_po_items(p_po_id bigint, p_user_id bigint, p_discount_pct numeric, p_notes text, p_shipping_address text, p_shipping_days integer, p_shipping_cost numeric, p_items jsonb)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_status VARCHAR(20);
  v_line   INT := 0;
  it       JSONB;
BEGIN
  SELECT status INTO v_status
  FROM purchase_orders
  WHERE id = p_po_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Purchase order % not found', p_po_id
      USING ERRCODE = 'P0011';
  END IF;

  IF v_status IN ('DELIVERED', 'CANCELLED') THEN
    RAISE EXCEPTION 'PO yang sudah dikirim atau dibatalkan tidak dapat diubah.'
      USING ERRCODE = 'P0013';
  END IF;

  IF p_discount_pct IS NULL OR p_discount_pct < 0 OR p_discount_pct > 100 THEN
    RAISE EXCEPTION 'discount_pct must be between 0 and 100'
      USING ERRCODE = 'P0014';
  END IF;

  IF p_items IS NULL OR jsonb_typeof(p_items) <> 'array' THEN
    RAISE EXCEPTION 'items must be a JSON array'
      USING ERRCODE = 'P0014';
  END IF;

  -- Every element becomes a product line.
  IF jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'PO harus memiliki minimal satu baris produk.'
      USING ERRCODE = 'P0014';
  END IF;

  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_items) AS e
    WHERE COALESCE(NULLIF(e->>'sellingPrice', '')::NUMERIC, 0) <= 0
  ) THEN
    RAISE EXCEPTION 'Semua baris produk harus memiliki harga jual.'
      USING ERRCODE = 'P0014';
  END IF;

  UPDATE purchase_orders
  SET discount_pct = p_discount_pct,
      notes        = p_notes,
      updated_by   = p_user_id
  WHERE id = p_po_id;

  DELETE FROM purchase_order_items WHERE po_id = p_po_id;

  FOR it IN SELECT * FROM jsonb_array_elements(p_items)
  LOOP
    v_line := v_line + 1;
    INSERT INTO purchase_order_items (
      po_id, quotation_item_id, line_number, item_type,
      offered_item_id, item_name, item_code,
      qty, unit_id, selling_price, cost_price,
      discount_pct, is_available, ship_destination,
      created_by, updated_by
    ) VALUES (
      p_po_id,
      NULLIF(it->>'quotationItemId','')::BIGINT,
      v_line,
      'product',
      NULLIF(it->>'offeredItemId','')::BIGINT,
      COALESCE(it->>'itemName',''),
      NULLIF(it->>'itemCode',''),
      COALESCE(NULLIF(it->>'qty','')::NUMERIC, 0),
      NULLIF(it->>'unitId','')::SMALLINT,
      COALESCE(NULLIF(it->>'sellingPrice','')::NUMERIC, 0),
      NULLIF(it->>'costPrice','')::NUMERIC,
      p_discount_pct,
      COALESCE((it->>'isAvailable')::BOOLEAN, TRUE),
      NULLIF(it->>'shipDestination',''),
      p_user_id,
      p_user_id
    );
  END LOOP;

  IF p_shipping_address IS NOT NULL AND TRIM(p_shipping_address) <> '' THEN
    v_line := v_line + 1;
    INSERT INTO purchase_order_items (
      po_id, line_number, item_type,
      item_name, qty, selling_price,
      discount_pct, is_available, ship_destination, shipping_days,
      created_by, updated_by
    ) VALUES (
      p_po_id,
      v_line,
      'shipping',
      'Pengiriman',
      1,
      COALESCE(p_shipping_cost, 0),
      0,
      TRUE,
      p_shipping_address,
      p_shipping_days,
      p_user_id,
      p_user_id
    );
  END IF;
END;
$function$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_update_po_items_versioned(p_po_id bigint, p_if_match integer, p_user_id bigint, p_discount_pct numeric, p_notes text, p_shipping_address text, p_shipping_days integer, p_shipping_cost numeric, p_items jsonb)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_current INT;
  v_new     INT;
BEGIN
  SELECT row_version INTO v_current
  FROM purchase_orders
  WHERE id = p_po_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'purchase order % not found', p_po_id USING ERRCODE = 'P0011';
  END IF;

  IF v_current <> p_if_match THEN
    RAISE EXCEPTION 'row_version mismatch (expected %, got %)', v_current, p_if_match
      USING ERRCODE = 'P0010';
  END IF;

  PERFORM fn_update_po_items(
    p_po_id, p_user_id, p_discount_pct, p_notes,
    p_shipping_address, p_shipping_days, p_shipping_cost, p_items
  );

  SELECT row_version INTO v_new FROM purchase_orders WHERE id = p_po_id;
  RETURN v_new;
END;
$function$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_update_po_notes(p_po_id bigint, p_if_match integer, p_notes text, p_user_id bigint)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_current INT;
  v_new     INT;
BEGIN
  SELECT row_version INTO v_current
  FROM purchase_orders
  WHERE id = p_po_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order % not found', p_po_id
      USING ERRCODE = 'P0011';
  END IF;

  IF p_if_match IS NOT NULL AND v_current <> p_if_match THEN
    RAISE EXCEPTION 'row_version mismatch (expected %, got %)', v_current, p_if_match
      USING ERRCODE = 'P0010';
  END IF;

  UPDATE purchase_orders
  SET notes      = p_notes,
      updated_by = p_user_id
  WHERE id = p_po_id
  RETURNING row_version INTO v_new;

  RETURN v_new;
END;
$function$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_update_quotation(p_id bigint, p_client_ref_no text, p_vessel_name text, p_payment_terms text, p_validity_days integer, p_discount_pct numeric, p_shipping_address text, p_shipping_days integer, p_shipping_cost numeric, p_items jsonb, p_user_id bigint, p_notes text DEFAULT NULL::text)
 RETURNS bigint
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_status        VARCHAR(20);
  v_item          JSONB;
  v_line_no       SMALLINT := 0;
  v_total_produk  NUMERIC(15,2) := 0;
  v_total         NUMERIC(15,2) := 0;
  v_total_disc    NUMERIC(15,2) := 0;
  v_qty           NUMERIC(12,2);
  v_selling_price NUMERIC(15,2);
  v_learn         TEXT;
  v_known         JSONB;
  v_key           TEXT;
  v_left          INT;
  v_pct           NUMERIC(5,2);
BEGIN
  -- 1. Lock + verify status='draft'
  SELECT status INTO v_status
  FROM quotations
  WHERE id = p_id
  FOR UPDATE;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Quotation % tidak ditemukan.', p_id
      USING ERRCODE = 'P0011';
  END IF;

  IF v_status != 'draft' THEN
    RAISE EXCEPTION 'Hanya quotation berstatus Draf yang dapat diubah; status saat ini %.',
      fn_quotation_status_label(v_status)
      USING ERRCODE = 'P0013';
  END IF;

  -- 2. Validation
  IF p_items IS NULL OR jsonb_array_length(p_items) = 0 THEN
    RAISE EXCEPTION 'Quotation must have at least 1 item';
  END IF;

  IF p_discount_pct < 0 OR p_discount_pct > 100 THEN
    RAISE EXCEPTION 'Diskon harus antara 0 dan 100; nilai yang dikirim %.', p_discount_pct
      USING ERRCODE = 'P0014';
  END IF;

  -- 3. Pre-calculate totals. The discount is gross minus net per line at
  -- the pct the lines inherit, as quotation_items.subtotal and v_po_totals
  -- round them, so the header subtotal is the sum of the line subtotals.
  v_pct := p_discount_pct;
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_qty := (v_item->>'qty')::NUMERIC(12,2);
    v_selling_price := (v_item->>'selling_price')::NUMERIC(15,2);
    v_total        := v_total + (v_qty * v_selling_price);
    v_total_produk := v_total_produk + (v_qty * v_selling_price);
    v_total_disc   := v_total_disc
                      + ROUND(v_qty * v_selling_price, 2)
                      - ROUND(v_qty * v_selling_price * (1 - v_pct / 100), 2);
  END LOOP;

  IF p_shipping_cost IS NOT NULL AND p_shipping_cost > 0 THEN
    v_total := v_total + p_shipping_cost;
  END IF;

  -- 4. Count the matches already learned, keyed like trg_learn_match
  -- (item id, then LOWER(TRIM(request text))), so a re-saved line is not
  -- counted again.
  SELECT COALESCE(jsonb_object_agg(k, n), '{}'::jsonb) INTO v_known
  FROM (
    SELECT requested_item_id::TEXT || ':' || LOWER(TRIM(requested_name)) AS k,
           COUNT(*) AS n
    FROM quotation_items
    WHERE quotation_id = p_id
      AND requested_item_id IS NOT NULL
      AND requested_name IS NOT NULL
      AND TRIM(requested_name) != ''
    GROUP BY 1
  ) s;

  -- 5. DELETE existing items.
  -- PO/invoice referencing items will be set NULL via FK ON DELETE SET NULL.
  -- Since status='draft', there are usually no PO/invoice yet — safe.
  DELETE FROM quotation_items WHERE quotation_id = p_id;

  -- 6. UPDATE header.
  -- discount_pct UPDATE bypasses trg_protect_quotation_discount because
  -- status='draft' (trigger only blocks when status != 'draft').
  -- trg_cascade_quotation_discount will fire but affect 0 rows
  -- (items already deleted).
  UPDATE quotations
  SET client_ref_no  = p_client_ref_no,
      vessel_name    = p_vessel_name,
      payment_terms  = p_payment_terms,
      validity_days  = p_validity_days,
      discount_pct   = p_discount_pct,
      total_produk   = v_total_produk,
      total          = v_total,
      total_discount = v_total_disc,
      notes          = p_notes,
      updated_by     = p_user_id
  WHERE id = p_id;

  -- 7. INSERT product items (trigger inherit discount_pct fires BEFORE INSERT).
  -- Each line whose match was already on the draft uses up one known
  -- occurrence and skips trg_learn_match; the rest learn as on create.
  v_learn := current_setting('gns.learn_match', true);
  FOR v_item IN SELECT * FROM jsonb_array_elements(p_items) LOOP
    v_line_no := v_line_no + 1;
    v_key := (NULLIF((v_item->>'requested_item_id'),'')::BIGINT)::TEXT
             || ':' || LOWER(TRIM(v_item->>'requested_name'));
    v_left := COALESCE((v_known->>v_key)::INT, 0);
    IF v_left > 0 THEN
      v_known := jsonb_set(v_known, ARRAY[v_key], to_jsonb(v_left - 1));
      PERFORM set_config('gns.learn_match', 'off', true);
    ELSE
      PERFORM set_config('gns.learn_match', COALESCE(v_learn, ''), true);
    END IF;

    INSERT INTO quotation_items (
      quotation_id, line_number, item_type,
      requested_item_id, requested_impa, requested_name,
      offered_item_id, vendor_product_id,
      qty, unit_id, selling_price, cost_price,
      is_available, ship_destination, due_date,
      update_vendor_price, created_by, updated_by
    ) VALUES (
      p_id,
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
      p_user_id, p_user_id
    );
  END LOOP;
  PERFORM set_config('gns.learn_match', COALESCE(v_learn, ''), true);

  -- 8. INSERT shipping line (if present)
  IF NULLIF(TRIM(p_shipping_address), '') IS NOT NULL OR COALESCE(p_shipping_cost, 0) > 0 THEN
    v_line_no := v_line_no + 1;
    INSERT INTO quotation_items (
      quotation_id, line_number, item_type,
      requested_name,
      qty, unit_id, selling_price,
      ship_destination, shipping_days,
      created_by, updated_by
    ) VALUES (
      p_id,
      v_line_no,
      'shipping',
      'SHIPPING' || COALESCE(' — ' || p_shipping_address, ''),
      1,
      (SELECT id FROM units WHERE code = 'UNIT' LIMIT 1),
      COALESCE(p_shipping_cost, 0),
      p_shipping_address,
      p_shipping_days,
      p_user_id, p_user_id
    );
  END IF;

  RETURN p_id;
END;
$function$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_update_quotation_versioned(p_id bigint, p_if_match integer, p_client_ref_no text, p_vessel_name text, p_payment_terms text, p_validity_days integer, p_discount_pct numeric, p_shipping_address text, p_shipping_days integer, p_shipping_cost numeric, p_items jsonb, p_user_id bigint, p_notes text DEFAULT NULL::text)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_current INT;
  v_new     INT;
BEGIN
  SELECT row_version INTO v_current
  FROM quotations
  WHERE id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'quotation % not found', p_id USING ERRCODE = 'P0011';
  END IF;

  IF v_current <> p_if_match THEN
    RAISE EXCEPTION 'row_version mismatch (expected %, got %)', v_current, p_if_match
      USING ERRCODE = 'P0010';
  END IF;

  PERFORM fn_update_quotation(
    p_id, p_client_ref_no, p_vessel_name, p_payment_terms,
    p_validity_days, p_discount_pct, p_shipping_address,
    p_shipping_days, p_shipping_cost, p_items, p_user_id, p_notes
  );

  SELECT row_version INTO v_new FROM quotations WHERE id = p_id;
  RETURN v_new;
END;
$function$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.trg_fn_protect_quotation_discount()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.discount_pct IS DISTINCT FROM OLD.discount_pct
     AND OLD.status != 'draft' THEN
    RAISE EXCEPTION
      'Cannot modify discount_pct on quotation % (status %). Create new version (revision) instead.',
      OLD.quotation_no, OLD.status;
  END IF;
  RETURN NEW;
END;
$function$;
-- +goose StatementEnd
