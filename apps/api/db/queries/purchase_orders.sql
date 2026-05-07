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
       q.grand_total::text AS quotation_total,
       q.subtotal::text     AS quotation_subtotal,
       COALESCE((SELECT SUM(poi.subtotal) FROM purchase_order_items poi WHERE poi.po_id = po.id), 0)::text AS po_subtotal,
       COALESCE((SELECT SUM(poi.total_selling) FROM purchase_order_items poi WHERE poi.po_id = po.id AND poi.item_type = 'product'), 0)::text AS po_total_produk,
       COALESCE((SELECT SUM(poi.profit_amount) FROM purchase_order_items poi WHERE poi.po_id = po.id AND poi.item_type = 'product'), 0)::text AS po_total_profit,
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
       q.grand_total::text AS quotation_total,
       q.subtotal::text     AS quotation_subtotal,
       COALESCE((SELECT SUM(poi.subtotal) FROM purchase_order_items poi WHERE poi.po_id = po.id), 0)::text AS po_subtotal,
       COALESCE((SELECT SUM(poi.total_selling) FROM purchase_order_items poi WHERE poi.po_id = po.id AND poi.item_type = 'product'), 0)::text AS po_total_produk,
       COALESCE((SELECT SUM(poi.profit_amount) FROM purchase_order_items poi WHERE poi.po_id = po.id AND poi.item_type = 'product'), 0)::text AS po_total_profit,
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
       q.grand_total::text AS quotation_total,
       q.subtotal::text     AS quotation_subtotal,
       COALESCE((SELECT SUM(poi.subtotal) FROM purchase_order_items poi WHERE poi.po_id = po.id), 0)::text AS po_subtotal,
       COALESCE((SELECT SUM(poi.total_selling) FROM purchase_order_items poi WHERE poi.po_id = po.id AND poi.item_type = 'product'), 0)::text AS po_total_produk,
       COALESCE((SELECT SUM(poi.profit_amount) FROM purchase_order_items poi WHERE poi.po_id = po.id AND poi.item_type = 'product'), 0)::text AS po_total_profit,
       po.created_at,
       po.updated_at
FROM purchase_orders po
JOIN quotations q ON q.id = po.quotation_id
JOIN company_client cc ON cc.id = po.company_client_id
WHERE po.quotation_id = $1;

-- name: purchase_orders.list_items
SELECT poi.id,
       poi.po_id,
       poi.line_number,
       poi.item_type,
       poi.offered_item_id,
       COALESCE(poi.item_code, i.impa_code) AS item_code,
       COALESCE(NULLIF(poi.item_name, ''), i.name, '') AS item_name,
       poi.qty::text          AS qty,
       poi.unit_id,
       u.code AS unit_code,
       poi.selling_price::text AS selling_price,
       poi.cost_price::text    AS cost_price,
       poi.subtotal::text      AS subtotal,
       poi.total_selling::text AS total_selling,
       poi.profit_amount::text AS profit_amount,
       poi.ship_destination,
       poi.is_available
FROM purchase_order_items poi
LEFT JOIN items i ON i.id = poi.offered_item_id
LEFT JOIN units u ON u.id = poi.unit_id
WHERE poi.po_id = $1
ORDER BY poi.line_number;

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
