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
-- IMPA codes are stored trimmed and upper-cased, so the import lookup and
-- the one-active-owner index agree on what counts as the same code.
INSERT INTO items (name, impa_code, default_unit_id, description, is_active, created_by, updated_by)
VALUES ($1, NULLIF(UPPER(BTRIM($2)), ''), $3, $4, COALESCE($5, TRUE), $6, $6)
RETURNING id, name, impa_code, default_unit_id, description,
          is_active, created_at, updated_at, image_object_key;

-- name: items.update
UPDATE items
   SET name             = $2,
       impa_code        = NULLIF(UPPER(BTRIM($3)), ''),
       default_unit_id  = $4,
       description      = $5,
       is_active        = $6,
       updated_by       = $7,
       updated_at       = NOW()
 WHERE id = $1
RETURNING id, name, impa_code, default_unit_id, description,
          is_active, created_at, updated_at, image_object_key;

-- name: items.images
-- The cover first, then upload order.
SELECT i.id, i.object_key, COALESCE(i.object_key = it.image_object_key, FALSE) AS is_cover
FROM item_images i
JOIN items it ON it.id = i.item_id
WHERE i.item_id = $1
ORDER BY is_cover DESC, i.id;

-- name: items.image_add
SELECT fn_item_image_add($1, $2, $3);

-- name: items.image_delete
SELECT fn_item_image_delete($1, $2, $3);

-- name: items.image_set_cover
SELECT fn_item_image_set_cover($1, $2, $3);

-- name: items.add_vendor
-- Links only an active vendor: an inactive one is filtered out of every
-- vendor list, so the link would be saved but never shown. No row back means
-- the vendor is missing or inactive; items.vendor_active tells which.
WITH ins AS (
    INSERT INTO vendor_products
        (vendor_id, item_id, vendor_sku, cost_price, product_url, last_quoted_at, created_by, updated_by)
    SELECT $1::bigint, $2::bigint, $3::varchar, $4::numeric, $5::text, NOW(), $6::bigint, $6::bigint
    WHERE EXISTS (SELECT 1 FROM vendors WHERE id = $1::bigint AND is_active)
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

-- name: items.search_catalog
-- Name layer of search-advanced. $4 is the isActive filter; NULL keeps
-- active and inactive items alike.
-- $1=query, $2=min score, $3=limit, $4=is_active
SELECT * FROM fn_search_items($1, $2, $3, $4::boolean);

-- name: items.active_flags_by_ids
-- Advanced-search enrichment: real is_active plus catalog identity per merged
-- hit. The vendor-offer and request-history layers carry no item name, so we
-- backfill name/impa/unit for hits those layers produced. Every hit takes
-- its image key from here, so search results show the same thumbnails.
-- $1=item ids
SELECT id, is_active, name, impa_code, default_unit_id, image_object_key
FROM items
WHERE id = ANY($1);

-- name: items.match_request_batch
-- Best match per import row in one statement. Called row by row the import
-- spent about 110 ms per line; laterally over an array the planner answers
-- each call from bitmap scans on the trigram indexes (see migration 00055).
-- idx is the 1-based position in $1.
SELECT b.ord AS idx, m.item_id, m.confidence, m.source
FROM unnest($1::text[]) WITH ORDINALITY AS b(req_text, ord)
CROSS JOIN LATERAL fn_match_request(b.req_text, 1) m;

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
-- UPPER(impa_code) is the expression uq_items_impa_code_active indexes, so
-- rows stored before normalisation still match. ORDER BY keeps the pick
-- stable should an inactive duplicate ever be reactivated around the index.
SELECT id FROM items
WHERE UPPER(impa_code) = UPPER(BTRIM($1)) AND is_active = TRUE
ORDER BY id
LIMIT 1;

-- name: items.vendor_active
SELECT is_active FROM vendors WHERE id = $1;

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
-- The vendor filter sits inside the LATERAL: filtering after LIMIT 1 would
-- pick a deactivated vendor's cheaper price and then drop the vendor,
-- leaving the row with no price at all.
LEFT JOIN LATERAL (
    SELECT vp_inner.id, vp_inner.vendor_id, vp_inner.cost_price
    FROM vendor_products vp_inner
    JOIN vendors v_inner ON v_inner.id = vp_inner.vendor_id AND v_inner.is_active = TRUE
    WHERE vp_inner.item_id = i.id AND vp_inner.is_active = TRUE
    ORDER BY vp_inner.cost_price ASC NULLS LAST, vp_inner.id ASC
    LIMIT 1
) vp ON TRUE
LEFT JOIN vendors v ON v.id = vp.vendor_id
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
-- $1=query, $2=limit, $3=item is_active, NULL for both
WITH q AS (
    SELECT
        lower(trim($1::text)) AS nq,
        '%' || replace(replace(replace(
            lower(trim($1::text)),
            '\', '\\'), '%', '\%'), '_', '\_') || '%' AS pat
), hits AS (
    SELECT
        vp.item_id,
        v.id   AS vendor_id,
        v.name AS vendor_name,
        vp.vendor_sku,
        GREATEST(
            CASE WHEN COALESCE(vp.vendor_sku,'') = q.nq THEN 1.00 ELSE 0 END,
            CASE WHEN lower(vp.vendor_sku) LIKE q.pat   THEN 0.92 ELSE 0 END,
            CASE WHEN lower(v.name) LIKE q.pat          THEN 0.70 ELSE 0 END,
            similarity(COALESCE(vp.vendor_sku,''), q.nq) * 0.85,
            word_similarity(q.nq, lower(v.name)) * 0.65
        ) AS score
    FROM vendor_products vp
    JOIN vendors v ON v.id = vp.vendor_id AND v.is_active = TRUE
    JOIN items i ON i.id = vp.item_id AND ($3::boolean IS NULL OR i.is_active = $3)
    CROSS JOIN q
    WHERE vp.is_active = TRUE
      AND (
        -- Bare lower(vendor_sku) so idx_vendor_products_sku_trgm stays
        -- reachable; COALESCE would hide the indexed expression. NULL LIKE
        -- yields NULL, which WHERE treats as no match, same as '' did.
        lower(vp.vendor_sku) LIKE q.pat
        OR lower(v.name) LIKE q.pat
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
-- $1=query, $2=limit, $3=item is_active, NULL for both
WITH q AS (
    SELECT
        lower(trim($1::text)) AS nq,
        '%' || replace(replace(replace(
            lower(trim($1::text)),
            '\', '\\'), '%', '\%'), '_', '\_') || '%' AS pat
)
SELECT
    irm.matched_item_id AS item_id,
    irm.request_text,
    irm.match_count,
    GREATEST(
        CASE WHEN lower(irm.request_text) = q.nq  THEN 1.00 ELSE 0 END,
        CASE WHEN irm.request_text ILIKE q.pat    THEN 0.88 ELSE 0 END,
        word_similarity(q.nq, irm.request_text)
    )::real AS score
FROM item_request_matches irm
JOIN items i ON i.id = irm.matched_item_id AND ($3::boolean IS NULL OR i.is_active = $3)
CROSS JOIN q
WHERE irm.matched_item_id IS NOT NULL
  AND (
    -- Bare request_text keeps idx_item_request_matches_trgm reachable;
    -- ILIKE and word_similarity are both case-insensitive.
    irm.request_text ILIKE q.pat
    OR word_similarity(q.nq, irm.request_text) > 0.30
  )
ORDER BY score DESC, irm.match_count DESC
LIMIT $2;

-- name: items.recommend
-- Line defaults per item: vendor, harga beli and harga jual. The rules are
-- in fn_recommend_lines. $1=client id or NULL, $2=item ids.
SELECT item_id, vendor_product_id, vendor_id, vendor_name,
       cost_price::text, selling_price::text
FROM fn_recommend_lines($1, $2);

-- name: items.recent_quotations
-- The product's newest quotation lines: quotations that reached the client
-- (every status but draft and cancelled), newest quotation first. Lines
-- marked Tidak Ditawarkan were not offered and stay out. $2 = limit.
SELECT qi.id AS line_id, q.id AS quotation_id, q.quotation_no, q.created_at AS quotation_date, q.status,
       q.company_client_id AS client_id, q.company_client_name AS client_name, q.contact_name,
       v.id AS vendor_id, v.name AS vendor_name,
       qi.qty::text AS qty, qi.cost_price::text AS cost_price, qi.selling_price::text AS selling_price
FROM quotation_items qi
JOIN quotations q ON q.id = qi.quotation_id
LEFT JOIN vendor_products vp ON vp.id = qi.vendor_product_id
LEFT JOIN vendors v ON v.id = vp.vendor_id
WHERE qi.offered_item_id = $1
  AND qi.item_type = 'product'
  AND qi.is_available
  AND q.status NOT IN ('draft', 'cancelled')
ORDER BY q.created_at DESC, q.id DESC, qi.line_number
LIMIT $2;
