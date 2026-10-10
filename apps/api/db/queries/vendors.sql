-- name: vendors.list_base
SELECT v.id, v.name, v.location, v.contact_info, v.is_active, v.created_at, v.updated_at,
       COALESCE((SELECT COUNT(*) FROM vendor_products vp
                  JOIN items i ON i.id = vp.item_id AND i.is_active = TRUE
                  WHERE vp.vendor_id = v.id AND vp.is_active = TRUE), 0) AS product_count,
       COALESCE((SELECT SUM(c.cost)::TEXT FROM (
                  SELECT poi.total_cost AS cost
                  FROM purchase_order_items poi
                  JOIN purchase_orders po ON po.id = poi.po_id
                  JOIN vendor_products vp ON vp.id = poi.vendor_product_id
                  WHERE vp.vendor_id = v.id
                    AND po.status <> 'CANCELLED'
                  UNION ALL
                  SELECT qi.total_cost
                  FROM quotation_items qi
                  JOIN vendor_products vp ON vp.id = qi.vendor_product_id
                  JOIN quotations q ON q.id = qi.quotation_id
                  WHERE vp.vendor_id = v.id
                    AND q.status = 'accepted'
                    AND NOT EXISTS (SELECT 1 FROM purchase_orders po
                                    WHERE po.quotation_id = q.id)) c), '0') AS total_purchase,
       v.logo_object_key
FROM vendors v
WHERE 1=1;

-- name: vendors.list_count_base
SELECT COUNT(*) FROM vendors v
WHERE 1=1;

-- name: vendors.get_by_id
SELECT v.id, v.name, v.location, v.contact_info, v.is_active, v.created_at, v.updated_at,
       COALESCE((SELECT COUNT(*) FROM vendor_products vp
                  JOIN items i ON i.id = vp.item_id AND i.is_active = TRUE
                  WHERE vp.vendor_id = v.id AND vp.is_active = TRUE), 0) AS product_count,
       COALESCE((SELECT SUM(c.cost)::TEXT FROM (
                  SELECT poi.total_cost AS cost
                  FROM purchase_order_items poi
                  JOIN purchase_orders po ON po.id = poi.po_id
                  JOIN vendor_products vp ON vp.id = poi.vendor_product_id
                  WHERE vp.vendor_id = v.id
                    AND po.status <> 'CANCELLED'
                  UNION ALL
                  SELECT qi.total_cost
                  FROM quotation_items qi
                  JOIN vendor_products vp ON vp.id = qi.vendor_product_id
                  JOIN quotations q ON q.id = qi.quotation_id
                  WHERE vp.vendor_id = v.id
                    AND q.status = 'accepted'
                    AND NOT EXISTS (SELECT 1 FROM purchase_orders po
                                    WHERE po.quotation_id = q.id)) c), '0') AS total_purchase,
       v.logo_object_key
FROM vendors v
WHERE v.id = $1;

-- name: vendors.create
INSERT INTO vendors (name, location, contact_info, is_active, created_by, updated_by)
VALUES ($1, $2, $3, COALESCE($4, TRUE), $5, $5)
RETURNING id, name, location, contact_info, is_active, created_at, updated_at,
          0::BIGINT AS product_count, '0'::TEXT AS total_purchase,
          logo_object_key;

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
                    JOIN items i ON i.id = vp.item_id AND i.is_active = TRUE
                    WHERE vp.vendor_id = vendors.id AND vp.is_active = TRUE), 0) AS product_count,
          COALESCE((SELECT SUM(c.cost)::TEXT FROM (
                    SELECT poi.total_cost AS cost
                    FROM purchase_order_items poi
                    JOIN purchase_orders po ON po.id = poi.po_id
                    JOIN vendor_products vp ON vp.id = poi.vendor_product_id
                    WHERE vp.vendor_id = vendors.id
                      AND po.status <> 'CANCELLED'
                    UNION ALL
                    SELECT qi.total_cost
                    FROM quotation_items qi
                    JOIN vendor_products vp ON vp.id = qi.vendor_product_id
                    JOIN quotations q ON q.id = qi.quotation_id
                    WHERE vp.vendor_id = vendors.id
                      AND q.status = 'accepted'
                      AND NOT EXISTS (SELECT 1 FROM purchase_orders po
                                      WHERE po.quotation_id = q.id)) c), '0') AS total_purchase,
          logo_object_key;

-- name: vendors.update_logo
UPDATE vendors
   SET logo_object_key = $2,
       updated_by      = $3,
       updated_at      = NOW()
 WHERE id = $1
RETURNING id;

-- name: vendors.list_items_count
-- Same rows as vendors.list_items, so X-Total-Count matches the pages.
SELECT COUNT(*)
FROM vendor_products vp
JOIN items i ON i.id = vp.item_id AND i.is_active = TRUE
WHERE vp.vendor_id = $1
  AND vp.is_active = TRUE;

-- name: vendors.list_items
-- i.id breaks name ties so a row never repeats or skips across pages.
-- $1=vendor id, $2=limit, $3=offset
SELECT
    i.id                  AS item_id,
    i.name                AS item_name,
    i.impa_code,
    vp.vendor_sku,
    vp.cost_price::text   AS cost_price,
    vp.last_quoted_at::text,
    vp.product_url
FROM vendor_products vp
JOIN items i ON i.id = vp.item_id AND i.is_active = TRUE
WHERE vp.vendor_id = $1
  AND vp.is_active = TRUE
ORDER BY i.name ASC, i.id ASC
LIMIT $2 OFFSET $3;

-- name: vendors.recent_quotations
-- The vendor's newest quotation lines: lines supplied through it on quotations that
-- reached the client (every status but draft and cancelled), newest
-- quotation first. $2 = limit.
SELECT qi.id AS line_id, q.id AS quotation_id, q.quotation_no, q.created_at AS quotation_date, q.status,
       q.company_client_id AS client_id, q.company_client_name AS client_name, q.contact_name,
       it.id AS item_id, COALESCE(it.name, qi.requested_name) AS item_name,
       COALESCE(it.impa_code, qi.requested_impa) AS impa_code
FROM quotation_items qi
JOIN vendor_products vp ON vp.id = qi.vendor_product_id
JOIN quotations q ON q.id = qi.quotation_id
LEFT JOIN items it ON it.id = qi.offered_item_id
WHERE vp.vendor_id = $1
  AND qi.item_type = 'product'
  AND qi.is_available
  AND q.status NOT IN ('draft', 'cancelled')
ORDER BY q.created_at DESC, q.id DESC, qi.line_number
LIMIT $2;

-- name: vendors.lock_for_delete
-- The vendor row, locked without waiting: a link being saved for it holds
-- a key lock, so the delete is refused (55P03) instead of queueing into a
-- deadlock, and a link saved after this waits and then fails its foreign
-- key.
SELECT name FROM vendors WHERE id = $1 FOR UPDATE NOWAIT;

-- name: vendors.lock_links_for_delete
-- Its links, locked the same way: a quotation or PO line being saved
-- holds a key lock on the link it names, not on the vendor.
SELECT id FROM vendor_products WHERE vendor_id = $1 FOR UPDATE NOWAIT;

-- name: vendors.usage
-- Quotations and POs with a line through any of its links, in any status.
-- Read after the locks, so every committed line is counted.
SELECT
  (SELECT COUNT(DISTINCT qi.quotation_id) FROM quotation_items qi
     JOIN vendor_products vp ON vp.id = qi.vendor_product_id
    WHERE vp.vendor_id = $1) AS quotations,
  (SELECT COUNT(DISTINCT poi.po_id) FROM purchase_order_items poi
     JOIN vendor_products vp ON vp.id = poi.vendor_product_id
    WHERE vp.vendor_id = $1) AS purchase_orders;

-- name: vendors.delete_links
DELETE FROM vendor_products WHERE vendor_id = $1;

-- name: vendors.delete
DELETE FROM vendors WHERE id = $1;
