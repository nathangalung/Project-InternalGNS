-- Canonical current body of fn_recommend_lines (deployed by migration 00077).
CREATE OR REPLACE FUNCTION public.fn_recommend_lines(p_client_id bigint, p_item_ids bigint[])
 RETURNS TABLE(item_id bigint, vendor_product_id bigint, vendor_id bigint, vendor_name character varying, cost_price numeric, selling_price numeric)
 LANGUAGE sql
 STABLE
AS $function$
  -- Each pick is one row per item, so the cost stays linear in the deals.
  WITH deals AS (
    SELECT qi.id AS line_id, qi.offered_item_id AS item_id, q.company_client_id,
           qi.vendor_product_id, qi.selling_price, q.created_at
    FROM quotation_items qi
    JOIN quotations q ON q.id = qi.quotation_id
    WHERE qi.item_type = 'product'
      AND qi.offered_item_id = ANY(p_item_ids)
      AND q.status IN ('sent', 'accepted')
  ),
  own_price AS (
    SELECT DISTINCT ON (d.item_id) d.item_id, d.selling_price
    FROM deals d
    WHERE d.company_client_id = p_client_id AND d.selling_price > 0
    ORDER BY d.item_id, d.created_at DESC, d.line_id DESC
  ),
  any_price AS (
    SELECT DISTINCT ON (d.item_id) d.item_id, d.selling_price
    FROM deals d
    WHERE d.selling_price > 0
    ORDER BY d.item_id, d.created_at DESC, d.line_id DESC
  ),
  -- The client's vendor counts only while it still has a price.
  own_vendor AS (
    SELECT DISTINCT ON (d.item_id) d.item_id, ov.id
    FROM deals d
    JOIN vendor_products ov ON ov.id = d.vendor_product_id AND ov.is_active AND ov.cost_price > 0
    JOIN vendors ovv ON ovv.id = ov.vendor_id AND ovv.is_active
    WHERE d.company_client_id = p_client_id
    ORDER BY d.item_id, d.created_at DESC, d.line_id DESC
  ),
  -- A link saved before its price was known sits at 0; priced links win.
  cheapest AS (
    SELECT DISTINCT ON (cv.item_id) cv.item_id, cv.id
    FROM vendor_products cv
    JOIN vendors cvv ON cvv.id = cv.vendor_id AND cvv.is_active
    WHERE cv.item_id = ANY(p_item_ids) AND cv.is_active
    ORDER BY cv.item_id, (cv.cost_price > 0) DESC, cv.cost_price ASC, cv.id ASC
  )
  SELECT i.id, vp.id, v.id, v.name, vp.cost_price,
         COALESCE(op.selling_price, ap.selling_price)
  FROM items i
  LEFT JOIN own_price op ON op.item_id = i.id
  LEFT JOIN any_price ap ON ap.item_id = i.id
  LEFT JOIN own_vendor ow ON ow.item_id = i.id
  LEFT JOIN cheapest ch ON ch.item_id = i.id
  LEFT JOIN vendor_products vp ON vp.id = COALESCE(ow.id, ch.id)
  LEFT JOIN vendors v ON v.id = vp.vendor_id
  WHERE i.id = ANY(p_item_ids) AND i.is_active
  ORDER BY i.id;
$function$
