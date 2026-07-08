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
SELECT id, quotation_id, line_number, item_type,
       requested_item_id, requested_impa, requested_name,
       offered_item_id, vendor_product_id,
       qty::text, unit_id,
       selling_price::text, cost_price::text,
       discount_pct::text, total_selling::text,
       discount_amount::text, subtotal::text,
       is_available, ship_destination, shipping_days
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
    q.grand_total::text       AS grand_total,
    q.subtotal::text          AS subtotal,
    q.total_discount::text    AS total_discount,
    COALESCE(c.total_harga_beli, '0') AS total_harga_beli,
    q.created_at
FROM quotations q
LEFT JOIN LATERAL (
    SELECT SUM(qi.qty * qi.cost_price)::text AS total_harga_beli
    FROM quotation_items qi
    WHERE qi.quotation_id = q.id AND qi.item_type = 'product'
) c ON TRUE
WHERE 1=1;

-- name: quotations.list_count_base
SELECT COUNT(*) FROM quotations q WHERE 1=1;

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

-- name: quotations.fn_update_versioned
SELECT fn_update_quotation_versioned(
    $1, $2, $3, $4, $5, $6, $7::numeric(5,2),
    $8, $9, $10::numeric(15,2),
    $11::jsonb, $12, $13
);

-- name: quotations.row_version
SELECT row_version FROM quotations WHERE id = $1;

-- name: quotations.fn_change_status
SELECT fn_change_quotation_status($1, $2, $3, $4);

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
INSERT INTO quotation_item_requests (
    quotation_id, line_no, request_text, request_impa,
    requested_qty, requested_uom,
    matched_item_id, match_status, source_type, source_ref, notes,
    created_by, updated_by
) VALUES (
    $1, $2, $3, $4,
    $5::numeric(15,3), $6,
    $7, COALESCE($8, 'pending'), COALESCE($9, 'manual'), $10, $11,
    $12, $12
)
RETURNING id, quotation_id, line_no, request_text, request_impa,
          requested_qty::text, requested_uom,
          matched_item_id, match_status, source_type, source_ref, notes,
          reviewed_by, reviewed_at, row_version,
          created_by, updated_by, created_at, updated_at;

-- name: quotations.qir_update
UPDATE quotation_item_requests SET
    line_no         = $2,
    request_text    = $3,
    request_impa    = $4,
    requested_qty   = $5::numeric(15,3),
    requested_uom   = $6,
    matched_item_id = $7,
    match_status    = $8::varchar(20),
    source_type     = $9::varchar(20),
    source_ref      = $10,
    notes           = $11,
    reviewed_by     = CASE
        WHEN $8::varchar(20) <> 'pending' AND reviewed_by IS NULL THEN $12
        ELSE reviewed_by
    END,
    reviewed_at     = CASE
        WHEN $8::varchar(20) <> 'pending' AND reviewed_at IS NULL THEN NOW()
        ELSE reviewed_at
    END,
    updated_by      = $12,
    row_version     = row_version + 1
WHERE id = $1
RETURNING id, quotation_id, line_no, request_text, request_impa,
          requested_qty::text, requested_uom,
          matched_item_id, match_status, source_type, source_ref, notes,
          reviewed_by, reviewed_at, row_version,
          created_by, updated_by, created_at, updated_at;

-- name: quotations.qir_delete
DELETE FROM quotation_item_requests
WHERE id = $1
RETURNING id;

-- name: quotations.count_unpriced_products
SELECT count(*)::int
FROM quotation_items
WHERE quotation_id = $1
  AND item_type = 'product'
  AND (selling_price IS NULL OR selling_price <= 0);

-- name: quotations.update_contact
WITH q AS (
    SELECT id, company_client_id FROM quotations WHERE id = $1
),
upd AS (
    UPDATE quotations
       SET contact_id   = cc.id,
           contact_name = cc.name,
           updated_by   = $3,
           updated_at   = NOW()
      FROM q
      JOIN company_contacts cc ON cc.id = $2
                                AND cc.company_id = q.company_client_id
                                AND cc.is_active = TRUE
     WHERE quotations.id = q.id
    RETURNING quotations.id
)
SELECT
    CASE
        WHEN NOT EXISTS(SELECT 1 FROM q)   THEN 'not_found'
        WHEN NOT EXISTS(SELECT 1 FROM upd) THEN 'contact_invalid'
        ELSE 'ok'
    END AS result;
