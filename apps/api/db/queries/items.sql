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
        (vendor_id, item_id, vendor_sku, cost_price, last_quoted_at, created_by, updated_by)
    VALUES
        ($1, $2, $3, $4, NOW(), $5, $5)
    ON CONFLICT (vendor_id, item_id) DO UPDATE
       SET vendor_sku     = EXCLUDED.vendor_sku,
           cost_price     = EXCLUDED.cost_price,
           last_quoted_at = EXCLUDED.last_quoted_at,
           is_active      = TRUE,
           updated_by     = EXCLUDED.updated_by,
           updated_at     = NOW()
    RETURNING id, vendor_id, vendor_sku, cost_price, last_quoted_at
)
SELECT ins.id              AS vendor_product_id,
       ins.vendor_id,
       v.name              AS vendor_name,
       ins.vendor_sku,
       ins.cost_price::text,
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
