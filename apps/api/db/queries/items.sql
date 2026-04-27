-- name: items.list
SELECT id, name, impa_code, default_unit_id, description,
       is_active, created_at, updated_at
FROM items
WHERE is_active = TRUE
ORDER BY name
LIMIT $1 OFFSET $2;

-- name: items.get_by_id
SELECT id, name, impa_code, default_unit_id, description,
       is_active, created_at, updated_at
FROM items
WHERE id = $1;

-- name: items.create
INSERT INTO items (name, impa_code, default_unit_id, description, created_by, updated_by)
VALUES ($1, $2, $3, $4, $5, $5)
RETURNING id, name, impa_code, default_unit_id, description,
          is_active, created_at, updated_at;

-- name: items.search
SELECT * FROM fn_search_items($1, $2, $3);

-- name: items.match_request
SELECT * FROM fn_match_request($1, $2);

-- name: items.list_vendors_for_item
SELECT
    vp.id              AS vendor_product_id,
    v.id               AS vendor_id,
    v.name             AS vendor_name,
    vp.vendor_sku,
    vp.cost_price::text,
    vp.last_quoted_at::text
FROM vendor_products vp
JOIN vendors v ON v.id = vp.vendor_id
WHERE vp.item_id = $1 AND v.is_active = TRUE
ORDER BY vp.cost_price ASC NULLS LAST;

-- name: items.suggest_selling_prices
SELECT
    quotation_no,
    quotation_date::text,
    client_name,
    qty::text,
    cost_price::text,
    selling_price::text,
    profit_pct::text
FROM fn_suggest_selling_prices($1, $2);
