-- name: vendors.list
SELECT v.id, v.name, v.location, v.contact_info, v.is_active, v.created_at, v.updated_at,
       COALESCE((SELECT COUNT(*) FROM vendor_products vp
                  WHERE vp.vendor_id = v.id AND vp.is_active = TRUE), 0) AS product_count,
       COALESCE((SELECT SUM(qi.total_cost)::TEXT
                  FROM quotation_items qi
                  JOIN vendor_products vp ON vp.id = qi.vendor_product_id
                  JOIN quotations q ON q.id = qi.quotation_id
                  WHERE vp.vendor_id = v.id
                    AND q.status = 'accepted'), '0') AS total_purchase
FROM vendors v
WHERE v.is_active = TRUE
ORDER BY v.name
LIMIT $1 OFFSET $2;

-- name: vendors.get_by_id
SELECT v.id, v.name, v.location, v.contact_info, v.is_active, v.created_at, v.updated_at,
       COALESCE((SELECT COUNT(*) FROM vendor_products vp
                  WHERE vp.vendor_id = v.id AND vp.is_active = TRUE), 0) AS product_count,
       COALESCE((SELECT SUM(qi.total_cost)::TEXT
                  FROM quotation_items qi
                  JOIN vendor_products vp ON vp.id = qi.vendor_product_id
                  JOIN quotations q ON q.id = qi.quotation_id
                  WHERE vp.vendor_id = v.id
                    AND q.status = 'accepted'), '0') AS total_purchase
FROM vendors v
WHERE v.id = $1;

-- name: vendors.create
INSERT INTO vendors (name, location, contact_info, created_by, updated_by)
VALUES ($1, $2, $3, $4, $4)
RETURNING id, name, location, contact_info, is_active, created_at, updated_at,
          0::BIGINT AS product_count, '0'::TEXT AS total_purchase;

-- name: vendors.update
UPDATE vendors
   SET name         = $2,
       location     = $3,
       contact_info = $4,
       is_active    = $5,
       updated_by   = $6,
       updated_at   = NOW()
 WHERE id = $1
RETURNING id, name, location, contact_info, is_active, created_at, updated_at,
          COALESCE((SELECT COUNT(*) FROM vendor_products vp
                    WHERE vp.vendor_id = vendors.id AND vp.is_active = TRUE), 0) AS product_count,
          COALESCE((SELECT SUM(qi.total_cost)::TEXT
                    FROM quotation_items qi
                    JOIN vendor_products vp ON vp.id = qi.vendor_product_id
                    JOIN quotations q ON q.id = qi.quotation_id
                    WHERE vp.vendor_id = vendors.id
                      AND q.status = 'accepted'), '0') AS total_purchase;

-- name: vendors.search
SELECT * FROM fn_search_vendors($1, $2, $3);

-- name: vendors.list_items
SELECT
    item_id, item_name, impa_code, vendor_sku,
    cost_price::text,
    last_quoted_at::text
FROM fn_search_items_by_vendor($1, $2);
