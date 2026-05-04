-- name: quotations.stats
SELECT status, COUNT(*) AS count
FROM quotations
GROUP BY status
ORDER BY status;

-- name: quotations.get_header
SELECT id, quotation_no, version, company_client_id, company_client_name,
       contact_id, contact_name, client_ref_no, vessel_name, status,
       payment_terms, validity_days,
       discount_pct::text, total_produk::text, total::text, total_discount::text,
       notes, created_at, updated_at
FROM quotations
WHERE id = $1;

-- name: quotations.get_items
SELECT id, quotation_id, line_number, item_type,
       requested_item_id, requested_impa, requested_name,
       offered_item_id, vendor_product_id,
       qty::text, unit_id,
       selling_price::text, cost_price::text,
       discount_pct::text, total_selling::text,
       discount_amount::text, subtotal::text,
       is_available, ship_destination
FROM quotation_items
WHERE quotation_id = $1
ORDER BY line_number;

-- name: quotations.get_history
SELECT id, from_status, to_status, note, changed_by, changed_at
FROM quotation_status_history
WHERE quotation_id = $1
ORDER BY changed_at;

-- name: quotations.list_base
SELECT
    q.id,
    q.quotation_no,
    q.version,
    q.company_client_name AS company_name,
    q.status,
    q.grand_total::text AS total,
    COALESCE((
        SELECT SUM(qi.qty * qi.cost_price)::text
        FROM quotation_items qi
        WHERE qi.quotation_id = q.id AND qi.item_type = 'product'
    ), '0') AS total_harga_beli,
    q.created_at
FROM quotations q
WHERE 1=1;

-- name: quotations.fn_create
SELECT fn_create_quotation(
    $1, $2, $3, $4, $5, $6, $7::numeric(5,2),
    $8, $9, $10::numeric(15,2),
    $11::jsonb, $12, $13, $14
);

-- name: quotations.fn_update
SELECT fn_update_quotation(
    $1, $2, $3, $4, $5, $6::numeric(5,2),
    $7, $8, $9::numeric(15,2),
    $10::jsonb, $11, $12
);

-- name: quotations.fn_change_status
SELECT fn_change_quotation_status($1, $2, $3, $4);
