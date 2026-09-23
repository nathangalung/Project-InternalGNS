-- name: invoices.list_base
SELECT inv.id,
       inv.invoice_no,
       inv.quotation_id,
       q.quotation_no,
       inv.po_id,
       inv.company_client_id,
       cc.name AS company_name,
       inv.invoice_date,
       inv.due_date,
       inv.subtotal,
       inv.total_discount,
       inv.dpp,
       inv.dpp_nilai_lain,
       inv.ppn_amount,
       inv.total,
       inv.status,
       inv.tax_transaction_code,
       inv.faktur_type,
       inv.row_version,
       inv.created_at,
       inv.updated_at,
       inv.attachment_object_key,
       inv.paid_at,
       inv.payment_proof_key
FROM invoices inv
JOIN quotations q ON q.id = inv.quotation_id
JOIN company_client cc ON cc.id = inv.company_client_id
WHERE 1=1;

-- name: invoices.list_count_base
SELECT COUNT(*)
FROM invoices inv
JOIN quotations q ON q.id = inv.quotation_id
JOIN company_client cc ON cc.id = inv.company_client_id
WHERE 1=1;

-- name: invoices.get_by_id
SELECT inv.id,
       inv.invoice_no,
       inv.quotation_id,
       q.quotation_no,
       inv.po_id,
       inv.company_client_id,
       cc.name AS company_name,
       inv.invoice_date,
       inv.due_date,
       inv.subtotal,
       inv.total_discount,
       inv.dpp,
       inv.dpp_nilai_lain,
       inv.ppn_amount,
       inv.total,
       inv.status,
       inv.tax_transaction_code,
       inv.faktur_type,
       inv.row_version,
       inv.created_at,
       inv.updated_at,
       inv.attachment_object_key,
       inv.paid_at,
       inv.payment_proof_key
FROM invoices inv
JOIN quotations q ON q.id = inv.quotation_id
JOIN company_client cc ON cc.id = inv.company_client_id
WHERE inv.id = $1;

-- name: invoices.get_by_quotation
SELECT inv.id,
       inv.invoice_no,
       inv.quotation_id,
       q.quotation_no,
       inv.po_id,
       inv.company_client_id,
       cc.name AS company_name,
       inv.invoice_date,
       inv.due_date,
       inv.subtotal,
       inv.total_discount,
       inv.dpp,
       inv.dpp_nilai_lain,
       inv.ppn_amount,
       inv.total,
       inv.status,
       inv.tax_transaction_code,
       inv.faktur_type,
       inv.row_version,
       inv.created_at,
       inv.updated_at,
       inv.attachment_object_key,
       inv.paid_at,
       inv.payment_proof_key
FROM invoices inv
JOIN quotations q ON q.id = inv.quotation_id
JOIN company_client cc ON cc.id = inv.company_client_id
WHERE inv.quotation_id = $1
ORDER BY inv.id DESC
LIMIT 1;

-- name: invoices.get_detail_by_id
-- Detail read model: carries the client, quotation and PO header fields the
-- invoice screen prints. Finance cannot call the quotation or purchase-order
-- endpoints, so the page must never need them.
SELECT inv.id,
       inv.invoice_no,
       inv.quotation_id,
       q.quotation_no,
       q.vessel_name,
       inv.po_id,
       po.po_number,
       po.po_date,
       inv.company_client_id,
       cc.name AS company_name,
       cc.npwp AS company_npwp,
       cc.address AS company_address,
       cc.email AS company_email,
       cc.country_code AS company_country_code,
       cc.tku_id AS company_tku_id,
       ct.name AS contact_name,
       ct.email AS contact_email,
       ct.phone AS contact_phone,
       inv.invoice_date,
       inv.due_date,
       inv.subtotal,
       inv.total_discount,
       inv.dpp,
       inv.dpp_nilai_lain,
       inv.ppn_amount,
       inv.total,
       inv.status,
       inv.tax_transaction_code,
       inv.faktur_type,
       inv.row_version,
       inv.created_at,
       inv.updated_at,
       inv.attachment_object_key,
       inv.paid_at,
       inv.payment_proof_key,
       inv.replaces_invoice_id,
       rp.invoice_no AS replaces_invoice_no,
       rb.id AS replaced_by_invoice_id
FROM invoices inv
JOIN quotations q ON q.id = inv.quotation_id
JOIN company_client cc ON cc.id = inv.company_client_id
LEFT JOIN purchase_orders po ON po.id = inv.po_id
LEFT JOIN invoices rp ON rp.id = inv.replaces_invoice_id
LEFT JOIN invoices rb ON rb.replaces_invoice_id = inv.id
LEFT JOIN LATERAL (
    SELECT co.name, co.email, co.phone
    FROM company_contacts co
    WHERE co.company_id = cc.id AND co.is_active = TRUE
    ORDER BY COALESCE(co.id = q.contact_id, FALSE) DESC, co.id ASC
    LIMIT 1
) ct ON TRUE
WHERE inv.id = $1;

-- name: invoices.get_detail_by_quotation
SELECT inv.id,
       inv.invoice_no,
       inv.quotation_id,
       q.quotation_no,
       q.vessel_name,
       inv.po_id,
       po.po_number,
       po.po_date,
       inv.company_client_id,
       cc.name AS company_name,
       cc.npwp AS company_npwp,
       cc.address AS company_address,
       cc.email AS company_email,
       cc.country_code AS company_country_code,
       cc.tku_id AS company_tku_id,
       ct.name AS contact_name,
       ct.email AS contact_email,
       ct.phone AS contact_phone,
       inv.invoice_date,
       inv.due_date,
       inv.subtotal,
       inv.total_discount,
       inv.dpp,
       inv.dpp_nilai_lain,
       inv.ppn_amount,
       inv.total,
       inv.status,
       inv.tax_transaction_code,
       inv.faktur_type,
       inv.row_version,
       inv.created_at,
       inv.updated_at,
       inv.attachment_object_key,
       inv.paid_at,
       inv.payment_proof_key,
       inv.replaces_invoice_id,
       rp.invoice_no AS replaces_invoice_no,
       rb.id AS replaced_by_invoice_id
FROM invoices inv
JOIN quotations q ON q.id = inv.quotation_id
JOIN company_client cc ON cc.id = inv.company_client_id
LEFT JOIN purchase_orders po ON po.id = inv.po_id
LEFT JOIN invoices rp ON rp.id = inv.replaces_invoice_id
LEFT JOIN invoices rb ON rb.replaces_invoice_id = inv.id
LEFT JOIN LATERAL (
    SELECT co.name, co.email, co.phone
    FROM company_contacts co
    WHERE co.company_id = cc.id AND co.is_active = TRUE
    ORDER BY COALESCE(co.id = q.contact_id, FALSE) DESC, co.id ASC
    LIMIT 1
) ct ON TRUE
WHERE inv.quotation_id = $1
ORDER BY inv.id DESC
LIMIT 1;

-- name: invoices.change_status
SELECT fn_change_invoice_status($1::bigint, $2::text, $3::bigint, $4::text, $5::text);

-- name: invoices.history
-- Status timeline, oldest first; $1=invoice id.
SELECT id, from_status, to_status, note, payment_proof_key, changed_by, changed_at
FROM invoice_status_history
WHERE invoice_id = $1
ORDER BY changed_at, id;

-- name: invoices.replace
-- Creates the Pengganti invoice for a cancelled one; returns its id.
SELECT fn_replace_invoice($1::bigint, $2::bigint);

-- name: invoices.update_dates
-- A paid or cancelled invoice is filed: moving its dates would move booked
-- revenue and the date already reported to Coretax.
UPDATE invoices
SET invoice_date = COALESCE($2, invoice_date),
    due_date     = COALESCE($3, due_date),
    updated_by   = $4
WHERE id = $1
  AND status NOT IN ('paid', 'cancelled')
  AND ($5::int IS NULL OR row_version = $5::int)
RETURNING row_version;

-- name: invoices.status_and_version
SELECT status, row_version FROM invoices WHERE id = $1;

-- name: invoices.is_overdue
-- Terlambat is derived from the due date, with the same predicate as
-- invoices.summary, so a stored draft or sent can already be overdue.
SELECT status = 'overdue'
       OR (status IN ('draft', 'sent') AND due_date IS NOT NULL AND due_date < CURRENT_DATE)
FROM invoices
WHERE id = $1;

-- name: invoices.update_attachment
UPDATE invoices
   SET attachment_object_key = $2,
       updated_by            = $3
 WHERE id = $1
RETURNING id;

-- name: invoices.list_items
-- Names come from the stored snapshot, never the live catalog: a rename
-- must not restate an invoice already sent or filed.
SELECT ii.id,
       ii.invoice_id,
       ii.line_number,
       ii.line_type,
       ii.item_code,
       ii.item_name,
       ii.offered_item_id,
       ii.unit_id,
       COALESCE(ii.unit_code, u.code) AS unit_code,
       u.coretax_code                 AS unit_coretax_code,
       ii.qty::text                AS qty,
       ii.unit_price::text         AS unit_price,
       ii.gross_unit_price::text   AS gross_unit_price,
       ii.cost_price::text         AS cost_price,
       ii.dpp::text             AS dpp,
       ii.dpp_nilai_lain::text  AS dpp_nilai_lain,
       ii.ppn_rate::text        AS ppn_rate,
       ii.ppn_amount::text      AS ppn_amount,
       ii.ship_destination,
       ii.goods_or_service
FROM invoice_items ii
LEFT JOIN units u ON u.id = ii.unit_id
WHERE ii.invoice_id = $1
ORDER BY COALESCE(ii.line_number, 0), ii.id;

-- name: invoices.list_items_bulk
-- Same projection and per-invoice ordering as invoices.list_items, for many
-- invoices in one round-trip. The leading invoice_id sort key makes grouping
-- stable; $1=invoice ids.
SELECT ii.id,
       ii.invoice_id,
       ii.line_number,
       ii.line_type,
       ii.item_code,
       ii.item_name,
       ii.offered_item_id,
       ii.unit_id,
       COALESCE(ii.unit_code, u.code) AS unit_code,
       u.coretax_code                 AS unit_coretax_code,
       ii.qty::text                AS qty,
       ii.unit_price::text         AS unit_price,
       ii.gross_unit_price::text   AS gross_unit_price,
       ii.cost_price::text         AS cost_price,
       ii.dpp::text             AS dpp,
       ii.dpp_nilai_lain::text  AS dpp_nilai_lain,
       ii.ppn_rate::text        AS ppn_rate,
       ii.ppn_amount::text      AS ppn_amount,
       ii.ship_destination,
       ii.goods_or_service
FROM invoice_items ii
LEFT JOIN units u ON u.id = ii.unit_id
WHERE ii.invoice_id = ANY($1::bigint[])
ORDER BY ii.invoice_id, COALESCE(ii.line_number, 0), ii.id;

-- name: invoices.summary
SELECT
  COUNT(*)::BIGINT AS total,
  COUNT(*) FILTER (
    WHERE status = 'draft'
      AND (due_date IS NULL OR due_date >= CURRENT_DATE)
  )::BIGINT AS draft,
  COUNT(*) FILTER (
    WHERE status = 'sent'
      AND (due_date IS NULL OR due_date >= CURRENT_DATE)
  )::BIGINT AS sent,
  COUNT(*) FILTER (WHERE status = 'paid')::BIGINT AS paid,
  COUNT(*) FILTER (
    WHERE status = 'overdue'
       OR (status IN ('draft', 'sent') AND due_date IS NOT NULL AND due_date < CURRENT_DATE)
  )::BIGINT AS overdue
FROM invoices
WHERE status <> 'cancelled';
