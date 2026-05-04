-- name: purchase_orders.list
SELECT po.id,
       po.po_number,
       po.quotation_id,
       q.quotation_no,
       po.company_client_id,
       cc.name AS company_name,
       po.po_date,
       po.status,
       po.file_name,
       po.file_size,
       po.uploaded_at,
       po.notes,
       po.file_url,
       q.grand_total AS quotation_total,
       q.subtotal AS quotation_subtotal,
       po.created_at,
       po.updated_at
FROM purchase_orders po
JOIN quotations q ON q.id = po.quotation_id
JOIN company_client cc ON cc.id = po.company_client_id
WHERE ($1::text IS NULL OR (
       LOWER(po.po_number) LIKE LOWER('%' || $1 || '%')
    OR LOWER(q.quotation_no) LIKE LOWER('%' || $1 || '%')
    OR LOWER(cc.name) LIKE LOWER('%' || $1 || '%')))
  AND ($2::text IS NULL OR po.status = $2::text)
ORDER BY po.po_date DESC, po.id DESC
LIMIT $3 OFFSET $4;

-- name: purchase_orders.get_by_id
SELECT po.id,
       po.po_number,
       po.quotation_id,
       q.quotation_no,
       po.company_client_id,
       cc.name AS company_name,
       po.po_date,
       po.status,
       po.file_name,
       po.file_size,
       po.uploaded_at,
       po.notes,
       po.file_url,
       q.grand_total AS quotation_total,
       q.subtotal AS quotation_subtotal,
       po.created_at,
       po.updated_at
FROM purchase_orders po
JOIN quotations q ON q.id = po.quotation_id
JOIN company_client cc ON cc.id = po.company_client_id
WHERE po.id = $1;

-- name: purchase_orders.get_by_quotation
SELECT po.id,
       po.po_number,
       po.quotation_id,
       q.quotation_no,
       po.company_client_id,
       cc.name AS company_name,
       po.po_date,
       po.status,
       po.file_name,
       po.file_size,
       po.uploaded_at,
       po.notes,
       po.file_url,
       q.grand_total AS quotation_total,
       q.subtotal AS quotation_subtotal,
       po.created_at,
       po.updated_at
FROM purchase_orders po
JOIN quotations q ON q.id = po.quotation_id
JOIN company_client cc ON cc.id = po.company_client_id
WHERE po.quotation_id = $1;

-- name: purchase_orders.update_file
UPDATE purchase_orders
SET file_name   = $2,
    file_size   = $3,
    file_url    = $4,
    uploaded_at = NOW(),
    updated_by  = $5,
    status      = CASE WHEN status = 'PENDING' THEN 'UPLOADED' ELSE status END
WHERE id = $1
RETURNING id;

-- name: purchase_orders.update_notes
UPDATE purchase_orders
SET notes      = $2,
    updated_by = $3
WHERE id = $1
RETURNING id;

-- name: purchase_orders.change_status
SELECT fn_change_po_status($1::bigint, $2::text, $3::bigint);
