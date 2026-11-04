-- +goose Up
-- 00120 INVOICE NUMBER FROM DN
-- An invoice carries the number of its PO's delivery note, with the note's
-- Roman month and year: DN-00071/GNS/X/2026 bills as INV-00071/GNS/X/2026,
-- whatever day the invoice is dated. A Pengganti keeps the number of the
-- invoice it replaces plus Rev.n, as a quotation revision does, so the PO,
-- its note and its invoice share one number. fn_create_invoice runs under
-- the PO row lock that both its callers take, and no longer draws from the
-- INV counter, which fn_next_doc_no now refuses; a note in an older format
-- draws from the DN counter, and a PO without a note is refused.
--
-- Every invoice of a PO whose note has the current format is renumbered the
-- same way, oldest first: the first takes the note's number, each later one
-- Rev.1, Rev.2. An invoice whose number changes and has no legacy_no keeps
-- its old number there, so it still shows as No. lama and is found by
-- search. A status note or a document note that copies a renumbered number
-- follows it. Invoices without a PO, or whose PO has an older format note,
-- keep their numbers, and a new number one of them already holds stops the
-- migration. Take a backup first: the Down restores both functions only.

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
  v_dn            TEXT;
  v_base          TEXT;
  v_prior         INTEGER;
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

  -- An invoice carries its delivery note's number, month and year, so
  -- DN-00071/GNS/X/2026 bills as INV-00071/GNS/X/2026. A Pengganti keeps
  -- the number it replaces plus Rev.n, n counting the invoices before it.
  IF v_replaces_id IS NOT NULL THEN
    SELECT regexp_replace(invoice_no, ' Rev\.[0-9]+$', '') INTO v_base
    FROM invoices WHERE id = v_replaces_id;
    SELECT count(*) INTO v_prior FROM invoices WHERE po_id = p_po_id;
    v_inv_no := v_base || ' Rev.' || v_prior;
  ELSE
    SELECT delivery_note_number INTO v_dn FROM purchase_orders WHERE id = p_po_id;
    -- Both callers stamp the note before billing.
    IF v_dn IS NULL THEN
      RAISE EXCEPTION 'PO ini belum memiliki nomor surat jalan, sehingga invoice tidak dapat diterbitkan.'
        USING ERRCODE = 'P0012';
    END IF;
    -- A note in an older format draws from the DN counter, so no
    -- later note can bill under the same number.
    IF v_dn !~ '^DN-[0-9]{5,}/GNS/[IVX]+/[0-9]{4}$' THEN
      v_dn := fn_next_doc_no('DN');
    END IF;
    v_inv_no := 'INV' || substr(v_dn, 3);
  END IF;

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

-- INV is no longer drawn.
-- Its counter rows stay as the record of what was issued.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_next_doc_no(p_doc_type character varying)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_year INTEGER := EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER;
  v_seq  INTEGER;
BEGIN
  IF p_doc_type IS NULL OR p_doc_type NOT IN ('Q', 'DN') THEN
    RAISE EXCEPTION 'unknown document type %', p_doc_type
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- The row lock serialises callers; a rollback returns the number.
  -- The year's first caller creates the row, and a concurrent second
  -- waits on that insert, then takes the next number or, after a
  -- rollback, the first.
  INSERT INTO doc_counters AS c (doc_type, year, last_seq)
  VALUES (p_doc_type, v_year, 1)
  ON CONFLICT (doc_type, year) DO UPDATE
    SET last_seq   = c.last_seq + 1,
        updated_at = NOW()
  RETURNING c.last_seq INTO v_seq;

  -- Pad to five digits; lpad alone would cut a sixth.
  RETURN p_doc_type || '-'
      || lpad(v_seq::TEXT, GREATEST(5, length(v_seq::TEXT)), '0')
      || '/GNS/' || fn_month_to_roman(EXTRACT(MONTH FROM CURRENT_DATE)::INTEGER)
      || '/' || v_year;
END;
$function$;
-- +goose StatementEnd

COMMENT ON FUNCTION fn_next_doc_no(character varying) IS
  'Next number for Q or DN: {type}-{five or more digits}/GNS/{Roman month}/{YYYY} of the WIB date, from the doc_counters row of that type and year. An invoice takes its delivery note''s number.';

-- Old number to new.
CREATE TEMP TABLE inv_renumber (
  id     BIGINT PRIMARY KEY,
  old_no TEXT NOT NULL UNIQUE,
  new_no TEXT NOT NULL UNIQUE
);

INSERT INTO inv_renumber (id, old_no, new_no)
SELECT i.id, i.invoice_no,
       'INV' || substr(p.delivery_note_number, 3)
       || CASE WHEN i.n > 0 THEN ' Rev.' || i.n ELSE '' END
FROM (
  SELECT id, po_id, invoice_no,
         row_number() OVER (PARTITION BY po_id ORDER BY id) - 1 AS n
  FROM invoices
  WHERE po_id IS NOT NULL
) i
JOIN purchase_orders p ON p.id = i.po_id
WHERE p.delivery_note_number ~ '^DN-[0-9]{5,}/GNS/[IVX]+/[0-9]{4}$';

DELETE FROM inv_renumber WHERE new_no = old_no;

-- A kept number blocks its new owner.
-- +goose StatementBegin
DO $$
DECLARE
  v_clash TEXT;
BEGIN
  SELECT string_agg(i.invoice_no, ', ' ORDER BY i.invoice_no) INTO v_clash
  FROM invoices i
  JOIN inv_renumber r ON r.new_no = i.invoice_no
  WHERE NOT EXISTS (SELECT 1 FROM inv_renumber k WHERE k.id = i.id);
  IF v_clash IS NOT NULL THEN
    RAISE EXCEPTION 'invoice numbers already held by invoices that keep theirs: %', v_clash;
  END IF;
END;
$$;
-- +goose StatementEnd

-- Copied numbers follow.
-- A token counts only as a whole renumbered invoice number.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION pg_temp.renumbered(p_text TEXT)
 RETURNS TEXT
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_re    CONSTANT TEXT := '(?<![A-Za-z0-9])INV-[0-9]+/GNS/[IVX]+/[0-9]{4}(?: Rev\.[0-9]+)?(?![0-9])';
  v_parts TEXT[];
  v_out   TEXT;
  v_tok   TEXT;
  v_new   TEXT;
  v_i     INTEGER := 1;
BEGIN
  IF p_text IS NULL OR p_text !~ v_re THEN
    RETURN p_text;
  END IF;
  v_parts := regexp_split_to_array(p_text, v_re);
  v_out := v_parts[1];
  FOR v_tok IN
    SELECT r.m[1] FROM regexp_matches(p_text, '(' || v_re || ')', 'g') WITH ORDINALITY AS r (m, n)
    ORDER BY r.n
  LOOP
    v_i := v_i + 1;
    SELECT new_no INTO v_new FROM inv_renumber WHERE old_no = v_tok;
    v_out := v_out || COALESCE(v_new, v_tok) || v_parts[v_i];
  END LOOP;
  RETURN v_out;
END;
$function$;
-- +goose StatementEnd

-- Keep row_version and updated_at.
-- No open edit goes stale.
ALTER TABLE invoices DISABLE TRIGGER trg_invoices_updated_at;
ALTER TABLE purchase_orders DISABLE TRIGGER trg_purchase_orders_updated_at;
ALTER TABLE quotations DISABLE TRIGGER trg_quotations_updated_at;

-- Two phases under the unique key.
UPDATE invoices i SET invoice_no = '#' || i.invoice_no,
                      legacy_no  = COALESCE(i.legacy_no, i.invoice_no)
FROM inv_renumber r
WHERE r.id = i.id;
UPDATE invoices i SET invoice_no = r.new_no
FROM inv_renumber r
WHERE r.id = i.id;

UPDATE quotations SET notes = pg_temp.renumbered(notes)
WHERE notes IS DISTINCT FROM pg_temp.renumbered(notes);
UPDATE purchase_orders SET notes = pg_temp.renumbered(notes)
WHERE notes IS DISTINCT FROM pg_temp.renumbered(notes);
UPDATE quotation_status_history SET note = pg_temp.renumbered(note)
WHERE note IS DISTINCT FROM pg_temp.renumbered(note);
UPDATE po_status_history SET note = pg_temp.renumbered(note)
WHERE note IS DISTINCT FROM pg_temp.renumbered(note);
UPDATE invoice_status_history SET note = pg_temp.renumbered(note)
WHERE note IS DISTINCT FROM pg_temp.renumbered(note);

ALTER TABLE invoices ENABLE TRIGGER trg_invoices_updated_at;
ALTER TABLE purchase_orders ENABLE TRIGGER trg_purchase_orders_updated_at;
ALTER TABLE quotations ENABLE TRIGGER trg_quotations_updated_at;

DROP FUNCTION pg_temp.renumbered(TEXT);
DROP TABLE inv_renumber;

-- +goose Down
-- The numbers stay as renumbered; the documented production rollback
-- restores a snapshot instead (docs/deploy_vps.md).

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

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_next_doc_no(p_doc_type character varying)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_year INTEGER := EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER;
  v_seq  INTEGER;
BEGIN
  IF p_doc_type IS NULL OR p_doc_type NOT IN ('Q', 'INV', 'DN') THEN
    RAISE EXCEPTION 'unknown document type %', p_doc_type
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- The row lock serialises callers; a rollback returns the number.
  -- The year's first caller creates the row, and a concurrent second
  -- waits on that insert, then takes the next number or, after a
  -- rollback, the first.
  INSERT INTO doc_counters AS c (doc_type, year, last_seq)
  VALUES (p_doc_type, v_year, 1)
  ON CONFLICT (doc_type, year) DO UPDATE
    SET last_seq   = c.last_seq + 1,
        updated_at = NOW()
  RETURNING c.last_seq INTO v_seq;

  -- Pad to five digits; lpad alone would cut a sixth.
  RETURN p_doc_type || '-'
      || lpad(v_seq::TEXT, GREATEST(5, length(v_seq::TEXT)), '0')
      || '/GNS/' || fn_month_to_roman(EXTRACT(MONTH FROM CURRENT_DATE)::INTEGER)
      || '/' || v_year;
END;
$function$;
-- +goose StatementEnd

COMMENT ON FUNCTION fn_next_doc_no(character varying) IS
  'Next number for Q, INV or DN: {type}-{five or more digits}/GNS/{Roman month}/{YYYY} of the WIB date, from the doc_counters row of that type and year.';
