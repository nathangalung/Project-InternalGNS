-- name: items.list_base
SELECT id, name, impa_code, default_unit_id, description,
       is_active, created_at, updated_at, image_object_key
FROM items
WHERE 1=1;

-- name: items.list_count_base
SELECT COUNT(*)
FROM items
WHERE 1=1;

-- name: items.get_by_id
SELECT id, name, impa_code, default_unit_id, description,
       is_active, created_at, updated_at, image_object_key
FROM items
WHERE id = $1;

-- name: items.create
INSERT INTO items (name, impa_code, default_unit_id, description, is_active, created_by, updated_by)
VALUES ($1, $2, $3, $4, COALESCE($5, TRUE), $6, $6)
RETURNING id, name, impa_code, default_unit_id, description,
          is_active, created_at, updated_at, image_object_key;

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
          is_active, created_at, updated_at, image_object_key;

-- name: items.update_image
UPDATE items
   SET image_object_key = $2,
       updated_by       = $3,
       updated_at       = NOW()
 WHERE id = $1
RETURNING id;

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

-- name: items.active_flags_by_ids
-- Advanced-search enrichment: real is_active plus catalog identity per merged
-- hit. fn_search_items only returns active items, but the vendor-offer and
-- request-history layers can surface a deactivated item (and carry no name),
-- so we backfill name/impa/unit for hits those layers produced.
-- $1=item ids
SELECT id, is_active, name, impa_code, default_unit_id
FROM items
WHERE id = ANY($1);

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

-- name: items.search_vendor_offers
-- VENDOR_OFFER layer: search by vendor SKU and vendor name.
-- Returns matched item id w/ score 0..1. Powers "find product by vendor offer".
-- $1=query, $2=limit
WITH q AS (
    SELECT lower(trim($1::text)) AS nq
), hits AS (
    SELECT
        vp.item_id,
        v.id   AS vendor_id,
        v.name AS vendor_name,
        vp.vendor_sku,
        GREATEST(
            CASE WHEN COALESCE(vp.vendor_sku,'') = q.nq           THEN 1.00 ELSE 0 END,
            CASE WHEN COALESCE(lower(vp.vendor_sku),'') LIKE '%'||q.nq||'%' THEN 0.92 ELSE 0 END,
            CASE WHEN lower(v.name) LIKE '%'||q.nq||'%'           THEN 0.70 ELSE 0 END,
            similarity(COALESCE(vp.vendor_sku,''), q.nq) * 0.85,
            word_similarity(q.nq, lower(v.name)) * 0.65
        ) AS score
    FROM vendor_products vp
    JOIN vendors v ON v.id = vp.vendor_id AND v.is_active = TRUE
    CROSS JOIN q
    WHERE vp.is_active = TRUE
      AND (
        -- Bare lower(vendor_sku) so idx_vendor_products_sku_trgm stays
        -- reachable; COALESCE would hide the indexed expression. NULL LIKE
        -- yields NULL, which WHERE treats as no match, same as '' did.
        lower(vp.vendor_sku) LIKE '%'||q.nq||'%'
        OR lower(v.name) LIKE '%'||q.nq||'%'
        OR similarity(COALESCE(vp.vendor_sku,''), q.nq) > 0.30
        OR word_similarity(q.nq, lower(v.name))         > 0.40
      )
)
SELECT DISTINCT ON (item_id)
    item_id,
    vendor_id,
    vendor_name,
    vendor_sku,
    score::real AS score
FROM hits
WHERE score >= 0.30
ORDER BY item_id, score DESC
LIMIT $2;

-- name: items.search_request_history
-- REQUEST_HISTORY layer: search past klien request texts (item_request_matches).
-- Returns matched item_id from cached confirmed matches.
-- $1=query, $2=limit
WITH q AS (
    SELECT lower(trim($1::text)) AS nq
)
SELECT
    irm.matched_item_id AS item_id,
    irm.request_text,
    irm.match_count,
    GREATEST(
        CASE WHEN lower(irm.request_text) = q.nq                       THEN 1.00 ELSE 0 END,
        CASE WHEN lower(irm.request_text) LIKE '%'||q.nq||'%'          THEN 0.88 ELSE 0 END,
        word_similarity(q.nq, lower(irm.request_text))
    )::real AS score
FROM item_request_matches irm
CROSS JOIN q
WHERE irm.matched_item_id IS NOT NULL
  AND (
    lower(irm.request_text) LIKE '%'||q.nq||'%'
    OR word_similarity(q.nq, lower(irm.request_text)) > 0.30
  )
ORDER BY score DESC, irm.match_count DESC
LIMIT $2;
