-- name: vendors.list
SELECT id, name, location, contact_info, is_active, created_at, updated_at
FROM vendors
WHERE is_active = TRUE
ORDER BY name
LIMIT $1 OFFSET $2;

-- name: vendors.get_by_id
SELECT id, name, location, contact_info, is_active, created_at, updated_at
FROM vendors
WHERE id = $1;

-- name: vendors.create
INSERT INTO vendors (name, location, contact_info, created_by, updated_by)
VALUES ($1, $2, $3, $4, $4)
RETURNING id, name, location, contact_info, is_active, created_at, updated_at;

-- name: vendors.search
SELECT * FROM fn_search_vendors($1, $2, $3);

-- name: vendors.list_items
SELECT
    item_id, item_name, impa_code, vendor_sku,
    cost_price::text,
    last_quoted_at::text
FROM fn_search_items_by_vendor($1, $2);
