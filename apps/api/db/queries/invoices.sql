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
       inv.attachment_object_key
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
       inv.attachment_object_key
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
       inv.attachment_object_key
FROM invoices inv
JOIN quotations q ON q.id = inv.quotation_id
JOIN company_client cc ON cc.id = inv.company_client_id
WHERE inv.quotation_id = $1
ORDER BY inv.id DESC
LIMIT 1;

-- name: invoices.change_status
SELECT fn_change_invoice_status($1::bigint, $2::text, $3::bigint);

-- name: invoices.update_dates
UPDATE invoices
SET invoice_date = COALESCE($2, invoice_date),
    due_date     = COALESCE($3, due_date),
    updated_by   = $4
WHERE id = $1
  AND ($5::int IS NULL OR row_version = $5::int)
RETURNING row_version;

-- name: invoices.row_version
SELECT row_version FROM invoices WHERE id = $1;

-- name: invoices.update_attachment
UPDATE invoices
   SET attachment_object_key = $2,
       updated_by            = $3
 WHERE id = $1
RETURNING id;

-- name: invoices.list_items
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
       ii.qty::text             AS qty,
       ii.unit_price::text      AS unit_price,
       ii.cost_price::text      AS cost_price,
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

-- name: invoices.summary
SELECT
  COUNT(*)::BIGINT AS total,
  COUNT(*) FILTER (
    WHERE status = 'draft'
      AND (due_date IS NULL OR due_date >= NOW())
  )::BIGINT AS draft,
  COUNT(*) FILTER (
    WHERE status = 'sent'
      AND (due_date IS NULL OR due_date >= NOW())
  )::BIGINT AS sent,
  COUNT(*) FILTER (WHERE status = 'paid')::BIGINT AS paid,
  COUNT(*) FILTER (
    WHERE status = 'overdue'
       OR (status IN ('draft', 'sent') AND due_date IS NOT NULL AND due_date < NOW())
  )::BIGINT AS overdue
FROM invoices
WHERE status <> 'cancelled';
