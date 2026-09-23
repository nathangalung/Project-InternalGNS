-- name: purchase_orders.list_base
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
       po.discount_pct::text AS discount_pct,
       q.grand_total::text AS quotation_total,
       q.subtotal::text     AS quotation_subtotal,
       COALESCE(t.po_subtotal::text, '0')         AS po_subtotal,
       COALESCE(t.po_total_produk::text, '0')     AS po_total_produk,
       COALESCE(t.po_total_profit::text, '0')     AS po_total_profit,
       COALESCE(t.po_dpp_nilai_lain::text, '0')   AS po_dpp_nilai_lain,
       COALESCE(t.po_ppn_amount::text, '0')       AS po_ppn_amount,
       COALESCE(t.po_grand_total::text, '0')      AS po_grand_total,
       COALESCE(t.po_total_discount::text, '0')   AS po_total_discount,
       po.row_version,
       po.created_at,
       po.updated_at
FROM purchase_orders po
JOIN quotations q ON q.id = po.quotation_id
JOIN company_client cc ON cc.id = po.company_client_id
LEFT JOIN v_po_totals t ON t.po_id = po.id
WHERE 1=1;

-- name: purchase_orders.list_count_base
SELECT COUNT(*)
FROM purchase_orders po
JOIN quotations q ON q.id = po.quotation_id
JOIN company_client cc ON cc.id = po.company_client_id
LEFT JOIN v_po_totals t ON t.po_id = po.id
WHERE 1=1;

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
       po.discount_pct::text AS discount_pct,
       q.grand_total::text AS quotation_total,
       q.subtotal::text     AS quotation_subtotal,
       COALESCE(t.po_subtotal::text, '0')         AS po_subtotal,
       COALESCE(t.po_total_produk::text, '0')     AS po_total_produk,
       COALESCE(t.po_total_profit::text, '0')     AS po_total_profit,
       COALESCE(t.po_dpp_nilai_lain::text, '0')   AS po_dpp_nilai_lain,
       COALESCE(t.po_ppn_amount::text, '0')       AS po_ppn_amount,
       COALESCE(t.po_grand_total::text, '0')      AS po_grand_total,
       COALESCE(t.po_total_discount::text, '0')   AS po_total_discount,
       po.row_version,
       po.created_at,
       po.updated_at
FROM purchase_orders po
JOIN quotations q ON q.id = po.quotation_id
JOIN company_client cc ON cc.id = po.company_client_id
LEFT JOIN v_po_totals t ON t.po_id = po.id
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
       po.discount_pct::text AS discount_pct,
       q.grand_total::text AS quotation_total,
       q.subtotal::text     AS quotation_subtotal,
       COALESCE(t.po_subtotal::text, '0')         AS po_subtotal,
       COALESCE(t.po_total_produk::text, '0')     AS po_total_produk,
       COALESCE(t.po_total_profit::text, '0')     AS po_total_profit,
       COALESCE(t.po_dpp_nilai_lain::text, '0')   AS po_dpp_nilai_lain,
       COALESCE(t.po_ppn_amount::text, '0')       AS po_ppn_amount,
       COALESCE(t.po_grand_total::text, '0')      AS po_grand_total,
       COALESCE(t.po_total_discount::text, '0')   AS po_total_discount,
       po.row_version,
       po.created_at,
       po.updated_at
FROM purchase_orders po
JOIN quotations q ON q.id = po.quotation_id
JOIN company_client cc ON cc.id = po.company_client_id
LEFT JOIN v_po_totals t ON t.po_id = po.id
WHERE po.quotation_id = $1;

-- name: purchase_orders.list_items
SELECT poi.id,
       poi.po_id,
       poi.quotation_item_id,
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
       poi.shipping_days,
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

-- name: purchase_orders.update_details
UPDATE purchase_orders
SET po_number  = $2,
    po_date    = $3,
    updated_by = $4
WHERE id = $1
RETURNING id;

-- name: purchase_orders.change_status
SELECT fn_change_po_status($1::bigint, $2::text, $3::bigint);

-- name: purchase_orders.update_items
SELECT fn_update_po_items($1::bigint, $2::bigint, $3::numeric, $4::text, $5::text, $6::int, $7::numeric, $8::jsonb);

-- name: purchase_orders.update_items_versioned
SELECT fn_update_po_items_versioned(
    $1::bigint, $2::int, $3::bigint, $4::numeric, $5::text,
    $6::text, $7::int, $8::numeric, $9::jsonb
);

-- name: purchase_orders.row_version
SELECT row_version FROM purchase_orders WHERE id = $1;
