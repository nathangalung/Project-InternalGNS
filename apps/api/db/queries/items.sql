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

-- name: items.update
UPDATE items
   SET name             = $2,
       impa_code        = $3,
       default_unit_id  = $4,
       description      = $5,
       is_active        = $6,
       updated_by       = $7,
       updated_at       = NOW()
 WHERE id = $1
RETURNING id, name, impa_code, default_unit_id, description,
          is_active, created_at, updated_at;

-- name: items.add_vendor
WITH ins AS (
    INSERT INTO vendor_products
        (vendor_id, item_id, vendor_sku, cost_price, product_url, last_quoted_at, created_by, updated_by)
    VALUES
        ($1, $2, $3, $4, $5, NOW(), $6, $6)
    ON CONFLICT (vendor_id, item_id) DO UPDATE
       SET vendor_sku     = EXCLUDED.vendor_sku,
           cost_price     = EXCLUDED.cost_price,
           product_url    = EXCLUDED.product_url,
           last_quoted_at = EXCLUDED.last_quoted_at,
           is_active      = TRUE,
           updated_by     = EXCLUDED.updated_by,
           updated_at     = NOW()
    RETURNING id, vendor_id, vendor_sku, cost_price, product_url, last_quoted_at
)
SELECT ins.id              AS vendor_product_id,
       ins.vendor_id,
       v.name              AS vendor_name,
       ins.vendor_sku,
       ins.cost_price::text,
       ins.product_url,
       ins.last_quoted_at::text
FROM ins
JOIN vendors v ON v.id = ins.vendor_id;

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
    vp.product_url,
    vp.last_quoted_at::text
FROM vendor_products vp
JOIN vendors v ON v.id = vp.vendor_id
WHERE vp.item_id = $1 AND v.is_active = TRUE
ORDER BY vp.cost_price ASC NULLS LAST;

-- name: items.find_by_impa
SELECT id FROM items
WHERE impa_code = $1 AND is_active = TRUE
LIMIT 1;

-- name: items.match_with_vendor_by_id
SELECT
    i.id              AS item_id,
    i.name            AS item_name,
    i.impa_code,
    i.default_unit_id,
    u.code            AS default_unit_code,
    vp.id             AS vendor_product_id,
    v.id              AS vendor_id,
    v.name            AS vendor_name,
    vp.cost_price::text AS cost_price
FROM items i
LEFT JOIN units u ON u.id = i.default_unit_id
LEFT JOIN LATERAL (
    SELECT vp_inner.id, vp_inner.vendor_id, vp_inner.cost_price
    FROM vendor_products vp_inner
    WHERE vp_inner.item_id = i.id AND vp_inner.is_active = TRUE
    ORDER BY vp_inner.cost_price ASC NULLS LAST
    LIMIT 1
) vp ON TRUE
LEFT JOIN vendors v ON v.id = vp.vendor_id AND v.is_active = TRUE
WHERE i.id = $1 AND i.is_active = TRUE;

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
