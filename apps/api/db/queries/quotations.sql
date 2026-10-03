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
       subtotal::text, dpp_nilai_lain::text, ppn_amount::text, grand_total::text,
       notes, row_version, created_at, updated_at
FROM quotations
WHERE id = $1;

-- name: quotations.get_items
SELECT qi.id, qi.quotation_id, qi.line_number, qi.item_type,
       qi.requested_item_id, qi.requested_impa, qi.requested_name,
       qi.offered_item_id, qi.vendor_product_id,
       oi.name       AS offered_name,
       oi.impa_code  AS offered_impa,
       v.id          AS vendor_id,
       v.name        AS vendor_name,
       qi.qty::text, qi.unit_id,
       qi.selling_price::text, qi.cost_price::text,
       qi.discount_pct::text, qi.total_selling::text,
       qi.discount_amount::text, qi.subtotal::text,
       qi.is_available, qi.ship_destination, qi.shipping_days
FROM quotation_items qi
LEFT JOIN items oi ON oi.id = qi.offered_item_id
LEFT JOIN vendor_products vp ON vp.id = qi.vendor_product_id
LEFT JOIN vendors v ON v.id = vp.vendor_id
WHERE qi.quotation_id = $1
ORDER BY qi.line_number;

-- name: quotations.get_history
SELECT id, from_status, to_status, note, changed_by, changed_at
FROM quotation_status_history
WHERE quotation_id = $1
ORDER BY changed_at, id;

-- name: quotations.list_base
SELECT
    q.id,
    q.quotation_no,
    q.version,
    q.company_client_id,
    q.company_client_name AS company_name,
    q.status,
    q.grand_total::text       AS grand_total,
    q.subtotal::text          AS subtotal,
    q.total_discount::text    AS total_discount,
    COALESCE(c.total_harga_beli, '0') AS total_harga_beli,
    c.product_count,
    q.created_at
FROM quotations q
LEFT JOIN LATERAL (
    SELECT SUM(qi.qty * qi.cost_price)::text AS total_harga_beli,
           COUNT(*)                          AS product_count
    FROM quotation_items qi
    WHERE qi.quotation_id = q.id AND qi.item_type = 'product'
) c ON TRUE
WHERE 1=1;

-- name: quotations.list_count_base
SELECT COUNT(*) FROM quotations q WHERE 1=1;

-- name: quotations.fn_create
-- Lines pass through fn_prepare_quotation_lines first (no-offer lines,
-- vendor links); see migration 00077.
SELECT fn_create_quotation(
    $1, $2, $3, $4, $5, $6, $7::numeric(5,2),
    $8, $9, $10::numeric(15,2),
    fn_prepare_quotation_lines($11::jsonb, $12::bigint), $12, $13, $14
);

-- name: quotations.fn_update
SELECT fn_update_quotation(
    $1, $2, $3, $4, $5, $6::numeric(5,2),
    $7, $8, $9::numeric(15,2),
    fn_prepare_quotation_lines($10::jsonb, $11::bigint), $11, $12
);

-- name: quotations.fn_update_versioned
SELECT fn_update_quotation_versioned(
    $1, $2, $3, $4, $5, $6, $7::numeric(5,2),
    $8, $9, $10::numeric(15,2),
    fn_prepare_quotation_lines($11::jsonb, $12::bigint), $12, $13
);

-- name: quotations.row_version
SELECT row_version FROM quotations WHERE id = $1;

-- name: quotations.fn_change_status
SELECT fn_change_quotation_status($1, $2, $3, $4);

-- name: quotations.fn_revise
SELECT fn_revise_quotation($1, $2, $3);

-- name: quotations.expire_due
SELECT fn_expire_quotations($1::date);

-- name: quotations.list_revisions
WITH RECURSIVE chain AS (
    SELECT id, parent_id FROM quotations WHERE id = $1
    UNION
    SELECT q.id, q.parent_id
    FROM quotations q
    JOIN chain c ON q.id = c.parent_id OR q.parent_id = c.id
)
SELECT q.id, q.parent_id, q.quotation_no, q.version, q.status,
       q.grand_total::text  AS grand_total,
       q.total_produk::text AS total_produk,
       q.created_at, q.updated_at
FROM chain c
JOIN quotations q ON q.id = c.id
ORDER BY q.version, q.id;

-- name: quotations.qir_list
SELECT id, quotation_id, line_no, request_text, request_impa,
       requested_qty::text, requested_uom,
       matched_item_id, match_status, source_type, source_ref, notes,
       reviewed_by, reviewed_at, row_version,
       created_by, updated_by, created_at, updated_at
FROM quotation_item_requests
WHERE quotation_id = $1
ORDER BY line_no;

-- name: quotations.qir_get
SELECT id, quotation_id, line_no, request_text, request_impa,
       requested_qty::text, requested_uom,
       matched_item_id, match_status, source_type, source_ref, notes,
       reviewed_by, reviewed_at, row_version,
       created_by, updated_by, created_at, updated_at
FROM quotation_item_requests
WHERE id = $1;

-- name: quotations.qir_create
-- Draft only; open editors hear of it.
SELECT id, quotation_id, line_no, request_text, request_impa,
       requested_qty::text, requested_uom,
       matched_item_id, match_status, source_type, source_ref, notes,
       reviewed_by, reviewed_at, row_version,
       created_by, updated_by, created_at, updated_at
FROM fn_quotation_request_add($1, $2, $3, $4, $5::numeric, $6, $7, $8, $9, $10, $11, $12);

-- name: quotations.qir_update
-- $3 is the If-Match version; a stale one raises P0010.
SELECT id, quotation_id, line_no, request_text, request_impa,
       requested_qty::text, requested_uom,
       matched_item_id, match_status, source_type, source_ref, notes,
       reviewed_by, reviewed_at, row_version,
       created_by, updated_by, created_at, updated_at
FROM fn_quotation_request_update($1, $2, $3, $4, $5, $6, $7::numeric, $8, $9, $10, $11, $12, $13, $14);

-- name: quotations.qir_delete
-- Refused while another user holds a line linked to the request.
SELECT fn_quotation_request_delete($1, $2, $3);

-- name: quotations.update_contact
-- Only a draft or an accepted quotation takes another contact: the draft in
-- the live editor, as part of its header, the accepted one when the PO gate
-- asks for an active contact.
SELECT fn_quotation_update_contact($1, $2, $3) AS result;

-- name: quotations.lock
SELECT fn_quotation_lock($1, $2, $3, $4);

-- name: quotations.unlock
SELECT fn_quotation_unlock($1, $2, $3);

-- name: quotations.edit_locks
SELECT l.part, l.user_id, u.name AS user_name, l.expires_at
FROM quotation_edit_locks l
JOIN users u ON u.id = l.user_id
WHERE l.quotation_id = $1 AND l.expires_at > NOW()
ORDER BY l.part;

-- name: quotations.add_lines
SELECT fn_quotation_add_lines($1, $2::jsonb, $3);

-- name: quotations.update_line
SELECT fn_quotation_update_line($1, $2, $3::jsonb, $4);

-- name: quotations.set_line_offer
SELECT fn_quotation_set_line_offer($1, $2, $3, $4);

-- name: quotations.delete_line
SELECT fn_quotation_delete_line($1, $2, $3);

-- name: quotations.update_header
SELECT fn_quotation_update_header(
    $1, $2, $3, $4, $5, $6::numeric(5,2), $7, $8, $9::numeric(15,2), $10, $11
);
