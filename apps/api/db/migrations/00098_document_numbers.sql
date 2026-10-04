-- +goose Up
-- 00098 DOCUMENT NUMBERS
-- Quotation, invoice and delivery-note numbers become one running number
-- per document type that never resets, five digits wide and growing past
-- 99999, followed by the Roman month and year of the WIB issue date:
-- Q-00011/GNS/X/2026, INV-00007/GNS/X/2026, DN-00007/GNS/X/2026. One row
-- of doc_counters per type holds the last number; fn_next_doc_no takes it
-- under the row lock, so concurrent callers queue and a rollback leaves no
-- gap. doc_sequences, keyed by client and year, goes.
--
-- A purchase order's number is the client's own PO number. Accepting a
-- quotation leaves it NULL until a user enters it, ON_PROGRESS and
-- DELIVERED require it, and a PO in either state cannot clear it. Two
-- clients may share a PO number; one client may not reuse one
-- (uq_purchase_orders_client_po_number, which leaves NULLs distinct).
--
-- No number embeds the client number any more, so the client-number lock
-- from 00072 goes.

CREATE TABLE doc_counters (
  doc_type   VARCHAR(3)  PRIMARY KEY CHECK (doc_type IN ('Q', 'INV', 'DN')),
  last_seq   INTEGER     NOT NULL CHECK (last_seq >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE doc_counters IS
  'Last running number per document type (Q, INV, DN); fn_next_doc_no takes the next one under the row lock.';

-- Each counter starts at its highest number in the new format. A legacy
-- number carries YY, the four-digit client number and the sequence, so at
-- least seven digits; five or six digits are the new format.
INSERT INTO doc_counters (doc_type, last_seq)
SELECT t.doc_type,
       COALESCE(MAX(substring(n.no FROM '^' || t.doc_type || '-([0-9]{5,6})/GNS/[IVX]+/[0-9]{4}')::INTEGER), 0)
FROM (VALUES ('Q'), ('INV'), ('DN')) AS t (doc_type)
LEFT JOIN (
  SELECT 'Q' AS doc_type, quotation_no AS no FROM quotations
  UNION ALL SELECT 'INV', invoice_no FROM invoices
  UNION ALL SELECT 'DN', delivery_note_number FROM purchase_orders
) n ON n.doc_type = t.doc_type
GROUP BY t.doc_type;

DROP FUNCTION fn_next_doc_no(character varying, bigint);
DROP TABLE doc_sequences;

-- +goose StatementBegin
CREATE FUNCTION public.fn_next_doc_no(p_doc_type character varying)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_seq INTEGER;
BEGIN
  -- The row lock serialises callers; a rollback returns the number.
  UPDATE doc_counters
     SET last_seq   = last_seq + 1,
         updated_at = NOW()
   WHERE doc_type = p_doc_type
  RETURNING last_seq INTO v_seq;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown document type %', p_doc_type
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Pad to five digits; lpad alone would cut a sixth.
  RETURN p_doc_type || '-'
      || lpad(v_seq::TEXT, GREATEST(5, length(v_seq::TEXT)), '0')
      || '/GNS/' || fn_month_to_roman(EXTRACT(MONTH FROM CURRENT_DATE)::INTEGER)
      || '/' || EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER;
END;
$function$;
-- +goose StatementEnd

COMMENT ON FUNCTION fn_next_doc_no(character varying) IS
  'Next number for Q, INV or DN: {type}-{five or more digits}/GNS/{Roman month}/{YYYY} of the WIB date, from doc_counters.';

-- The PO number is the client's.
ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_po_number_key;
ALTER TABLE purchase_orders ALTER COLUMN po_number DROP NOT NULL;
UPDATE purchase_orders SET po_number = NULL WHERE BTRIM(po_number) = '';
ALTER TABLE purchase_orders
  ADD CONSTRAINT purchase_orders_po_number_not_blank
  CHECK (po_number IS NULL OR BTRIM(po_number) <> '');

DROP TRIGGER trg_company_client_number_lock ON company_client;
DROP FUNCTION trg_fn_lock_client_number();

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

  -- Number first, before any lock.
  -- The counter row is then the first lock this transaction takes, so the
  -- line preparation (fn_link_vendor_item, trg_fn_sync_vendor_cost) never
  -- holds a row another creator needs while it waits for the counter. A
  -- refused quotation rolls the number back with it.
  v_quotation_no := fn_next_doc_no('Q');

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

  v_inv_no := fn_next_doc_no('INV');

  -- The buyer is stored as the client is now.
  INSERT INTO invoices (
    invoice_no, quotation_id, po_id, company_client_id,
    buyer_name, buyer_npwp, buyer_address,
    invoice_date, due_date, subtotal, dpp,
    status, faktur_type, replaces_invoice_id, created_by, updated_by
  )
  SELECT
    v_inv_no, v_quotation_id, p_po_id, v_company_id,
    cc.name, cc.npwp, cc.address,
    CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days',
    v_dpp, v_dpp,
    'draft',
    CASE WHEN v_replaces_id IS NULL THEN 'Normal' ELSE 'Pengganti' END,
    v_replaces_id,
    p_user_id, p_user_id
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

  -- po_number is the client's own, entered later.
  INSERT INTO purchase_orders (
    quotation_id, company_client_id, contact_id,
    po_date, status, created_by, updated_by
  ) VALUES (
    p_quotation_id, v_company_id, v_contact_id,
    CURRENT_DATE, 'PENDING', p_user_id, p_user_id
  ) RETURNING id INTO v_po_id;

  INSERT INTO purchase_order_items (
    po_id, quotation_item_id, line_number, item_type,
    offered_item_id, vendor_product_id, qty, unit_id, selling_price, cost_price,
    item_name, item_code, ship_destination, shipping_days,
    is_available, created_by, updated_by
  )
  SELECT
    v_po_id, qi.id, qi.line_number, qi.item_type,
    qi.offered_item_id, vp.id, qi.qty, qi.unit_id, qi.selling_price, qi.cost_price,
    COALESCE(NULLIF(oi.name, ''), qi.requested_name, ''),
    CASE WHEN oi.id IS NOT NULL THEN NULLIF(oi.impa_code, '') ELSE qi.requested_impa END,
    qi.ship_destination, qi.shipping_days,
    qi.is_available, p_user_id, p_user_id
  FROM quotation_items qi
  LEFT JOIN items oi ON oi.id = qi.offered_item_id
  -- Only a link for the offered product is the line's supplier.
  LEFT JOIN vendor_products vp
    ON vp.id = qi.vendor_product_id AND vp.item_id = qi.offered_item_id
  WHERE qi.quotation_id = p_quotation_id
    -- A Tidak Ditawarkan request is never ordered.
    AND (qi.item_type <> 'product' OR qi.is_available)
  ORDER BY qi.line_number;

  RETURN v_po_id;
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
  v_po_number  TEXT;
  v_dn_current TEXT;
  v_file       TEXT;
  v_dn         TEXT;
  v_note       TEXT := NULLIF(BTRIM(p_note), '');
BEGIN
  SELECT status, po_number, delivery_note_number, file_url
    INTO v_old, v_po_number, v_dn_current, v_file
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

  -- Work needs the client's PO number.
  IF p_new_status IN ('ON_PROGRESS', 'DELIVERED') AND v_po_number IS NULL THEN
    RAISE EXCEPTION 'No. PO klien belum diisi. Isi No. PO terlebih dahulu.'
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

  -- One qty 0 line is allowed; an all-zero PO would bill Rp 0.
  IF p_new_status IN ('ON_PROGRESS', 'DELIVERED') AND NOT EXISTS (
    SELECT 1 FROM purchase_order_items
    WHERE po_id = p_po_id AND item_type = 'product' AND total_selling > 0
  ) THEN
    RAISE EXCEPTION 'Jumlah semua baris produk masih 0. Isi jumlah minimal satu baris produk melalui Ubah PO.'
      USING ERRCODE = 'P0012';
  END IF;

  IF p_new_status IN ('ON_PROGRESS', 'DELIVERED') AND v_dn_current IS NULL THEN
    v_dn := fn_next_doc_no('DN');
  END IF;

  UPDATE purchase_orders
  SET status               = p_new_status,
      delivery_note_number = COALESCE(v_dn, delivery_note_number),
      -- The note is dated the WIB day its number is issued.
      delivery_note_date   = CASE WHEN v_dn IS NOT NULL THEN CURRENT_DATE
                                  ELSE delivery_note_date END,
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
CREATE OR REPLACE FUNCTION public.fn_update_po_details(p_po_id bigint, p_if_match integer, p_po_number text, p_po_date date, p_user_id bigint)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_current INT;
  v_status  TEXT;
  v_number  TEXT := NULLIF(BTRIM(p_po_number), '');
  v_new     INT;
BEGIN
  SELECT row_version, status INTO v_current, v_status
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

  -- Work in progress keeps its number.
  IF v_number IS NULL AND v_status IN ('ON_PROGRESS', 'DELIVERED') THEN
    RAISE EXCEPTION 'No. PO klien wajib diisi untuk PO yang sudah Dalam Progres atau Dikirim.'
      USING ERRCODE = 'P0014';
  END IF;

  UPDATE purchase_orders
  SET po_number  = v_number,
      po_date    = p_po_date,
      updated_by = p_user_id
  WHERE id = p_po_id
  RETURNING row_version INTO v_new;

  RETURN v_new;
END;
$function$;
-- +goose StatementEnd

-- +goose Down

CREATE TABLE doc_sequences (
  doc_type    VARCHAR(10) NOT NULL CHECK (doc_type IN ('Q','PO','INV','DN')),
  company_id  BIGINT NOT NULL REFERENCES company_client(id) ON DELETE RESTRICT,
  year        INT    NOT NULL,
  last_seq    INT    NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (doc_type, company_id, year)
);

COMMENT ON TABLE doc_sequences IS
  'Running sequence per (doc_type, company, year). UPSERT atomic via fn_next_doc_no for race-safe number generation.';

-- Legacy counters resume after the legacy numbers on file.
INSERT INTO doc_sequences (doc_type, company_id, year, last_seq)
SELECT doc_type, company_id, m[2]::INT, MAX(m[1]::INT)
FROM (
  SELECT d.doc_type, d.company_id,
         regexp_match(d.no, '^' || d.doc_type || '-[0-9]{2}' || c.number || '([0-9]+)/GNS/[IVX]+/([0-9]{4})') AS m
  FROM (
    SELECT 'Q' AS doc_type, company_client_id AS company_id, quotation_no AS no FROM quotations
    UNION ALL SELECT 'PO', company_client_id, po_number FROM purchase_orders
    UNION ALL SELECT 'DN', company_client_id, delivery_note_number FROM purchase_orders
    UNION ALL SELECT 'INV', company_client_id, invoice_no FROM invoices
  ) d
  JOIN company_client c ON c.id = d.company_id
) x
WHERE m IS NOT NULL
GROUP BY doc_type, company_id, m[2];

DROP FUNCTION fn_next_doc_no(character varying);

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_next_doc_no(p_doc_type character varying, p_company_id bigint)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_seq            INT;
  v_company_no     VARCHAR(10);
  v_year           INT := EXTRACT(YEAR FROM NOW());
  v_yy             VARCHAR(2);
  v_month          INT := EXTRACT(MONTH FROM NOW());
BEGIN
  -- The share lock holds the number until this document commits.
  SELECT number INTO v_company_no
  FROM company_client WHERE id = p_company_id
  FOR SHARE;

  IF v_company_no IS NULL OR v_company_no = '' THEN
    RAISE EXCEPTION 'Klien belum memiliki nomor. Isi Nomor Klien lalu coba lagi.'
      USING ERRCODE = 'P0014';
  END IF;

  -- UPSERT atomic: increment seq or insert new row
  INSERT INTO doc_sequences (doc_type, company_id, year, last_seq, updated_at)
  VALUES (p_doc_type, p_company_id, v_year, 1, NOW())
  ON CONFLICT (doc_type, company_id, year)
  DO UPDATE SET
    last_seq   = doc_sequences.last_seq + 1,
    updated_at = NOW()
  RETURNING last_seq INTO v_seq;

  v_yy := TO_CHAR(NOW(), 'YY');

  RETURN p_doc_type || '-' || v_yy || v_company_no || v_seq::TEXT ||
         '/GNS/' || fn_month_to_roman(v_month) || '/' || v_year::TEXT;
END;
$function$;
-- +goose StatementEnd

COMMENT ON FUNCTION fn_next_doc_no(VARCHAR, BIGINT) IS
  'Atomic next doc number for Q/PO/INV/DN. Format: {prefix}-{YY}{company_no}{seq}/GNS/{Roman}/{YYYY}. Race-safe via UPSERT on doc_sequences.';

-- A numberless PO draws a legacy number again.
UPDATE purchase_orders
SET po_number = fn_next_doc_no('PO', company_client_id)
WHERE po_number IS NULL;

ALTER TABLE purchase_orders DROP CONSTRAINT purchase_orders_po_number_not_blank;
ALTER TABLE purchase_orders ALTER COLUMN po_number SET NOT NULL;

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

  -- The buyer is stored as the client is now.
  INSERT INTO invoices (
    invoice_no, quotation_id, po_id, company_client_id,
    buyer_name, buyer_npwp, buyer_address,
    invoice_date, due_date, subtotal, dpp,
    status, faktur_type, replaces_invoice_id, created_by, updated_by
  )
  SELECT
    v_inv_no, v_quotation_id, p_po_id, v_company_id,
    cc.name, cc.npwp, cc.address,
    CURRENT_DATE, CURRENT_DATE + INTERVAL '30 days',
    v_dpp, v_dpp,
    'draft',
    CASE WHEN v_replaces_id IS NULL THEN 'Normal' ELSE 'Pengganti' END,
    v_replaces_id,
    p_user_id, p_user_id
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
    offered_item_id, vendor_product_id, qty, unit_id, selling_price, cost_price,
    item_name, item_code, ship_destination, shipping_days,
    is_available, created_by, updated_by
  )
  SELECT
    v_po_id, qi.id, qi.line_number, qi.item_type,
    qi.offered_item_id, vp.id, qi.qty, qi.unit_id, qi.selling_price, qi.cost_price,
    COALESCE(NULLIF(oi.name, ''), qi.requested_name, ''),
    CASE WHEN oi.id IS NOT NULL THEN NULLIF(oi.impa_code, '') ELSE qi.requested_impa END,
    qi.ship_destination, qi.shipping_days,
    qi.is_available, p_user_id, p_user_id
  FROM quotation_items qi
  LEFT JOIN items oi ON oi.id = qi.offered_item_id
  -- Only a link for the offered product is the line's supplier.
  LEFT JOIN vendor_products vp
    ON vp.id = qi.vendor_product_id AND vp.item_id = qi.offered_item_id
  WHERE qi.quotation_id = p_quotation_id
    -- A Tidak Ditawarkan request is never ordered.
    AND (qi.item_type <> 'product' OR qi.is_available)
  ORDER BY qi.line_number;

  RETURN v_po_id;
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

  -- One qty 0 line is allowed; an all-zero PO would bill Rp 0.
  IF p_new_status IN ('ON_PROGRESS', 'DELIVERED') AND NOT EXISTS (
    SELECT 1 FROM purchase_order_items
    WHERE po_id = p_po_id AND item_type = 'product' AND total_selling > 0
  ) THEN
    RAISE EXCEPTION 'Jumlah semua baris produk masih 0. Isi jumlah minimal satu baris produk melalui Ubah PO.'
      USING ERRCODE = 'P0012';
  END IF;

  IF p_new_status IN ('ON_PROGRESS', 'DELIVERED') AND v_dn_current IS NULL THEN
    v_dn := fn_next_doc_no('DN', v_company_id);
  END IF;

  UPDATE purchase_orders
  SET status               = p_new_status,
      delivery_note_number = COALESCE(v_dn, delivery_note_number),
      -- The note is dated the WIB day its number is issued.
      delivery_note_date   = CASE WHEN v_dn IS NOT NULL THEN CURRENT_DATE
                                  ELSE delivery_note_date END,
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
CREATE OR REPLACE FUNCTION public.trg_fn_lock_client_number()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.number IS DISTINCT FROM OLD.number
     AND EXISTS (SELECT 1 FROM quotations WHERE company_client_id = OLD.id) THEN
    RAISE EXCEPTION 'Nomor klien tidak dapat diubah karena sudah dipakai pada penawaran.'
      USING ERRCODE = 'P0013';
  END IF;
  RETURN NEW;
END;
$function$;
-- +goose StatementEnd


CREATE TRIGGER trg_company_client_number_lock
  BEFORE UPDATE OF number ON company_client
  FOR EACH ROW EXECUTE FUNCTION trg_fn_lock_client_number();

DROP TABLE doc_counters;
