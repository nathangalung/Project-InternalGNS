-- Canonical current body of fn_recommend_lines (deployed by migration 00077).
CREATE OR REPLACE FUNCTION public.fn_recommend_lines(p_client_id bigint, p_item_ids bigint[])
 RETURNS TABLE(item_id bigint, vendor_product_id bigint, vendor_id bigint, vendor_name character varying, cost_price numeric, selling_price numeric)
 LANGUAGE sql
 STABLE
AS $function$
  WITH deals AS (
    SELECT qi.id AS line_id, qi.offered_item_id AS item_id, q.company_client_id,
           qi.vendor_product_id, qi.selling_price, q.created_at
    FROM quotation_items qi
    JOIN quotations q ON q.id = qi.quotation_id
    WHERE qi.item_type = 'product'
      AND qi.offered_item_id = ANY(p_item_ids)
      AND q.status IN ('sent', 'accepted')
  )
  SELECT i.id, vp.id, v.id, v.name, vp.cost_price,
         COALESCE(own_price.selling_price, any_price.selling_price)
  FROM items i
  LEFT JOIN LATERAL (
    SELECT d.selling_price FROM deals d
    WHERE d.item_id = i.id AND d.company_client_id = p_client_id AND d.selling_price > 0
    ORDER BY d.created_at DESC, d.line_id DESC
    LIMIT 1
  ) own_price ON TRUE
  LEFT JOIN LATERAL (
    SELECT d.selling_price FROM deals d
    WHERE d.item_id = i.id AND d.selling_price > 0
    ORDER BY d.created_at DESC, d.line_id DESC
    LIMIT 1
  ) any_price ON TRUE
  LEFT JOIN LATERAL (
    SELECT ov.id FROM deals d
    JOIN vendor_products ov ON ov.id = d.vendor_product_id AND ov.is_active
    JOIN vendors ovv ON ovv.id = ov.vendor_id AND ovv.is_active
    WHERE d.item_id = i.id AND d.company_client_id = p_client_id
    ORDER BY d.created_at DESC, d.line_id DESC
    LIMIT 1
  ) own_vendor ON TRUE
  LEFT JOIN LATERAL (
    SELECT cv.id FROM vendor_products cv
    JOIN vendors cvv ON cvv.id = cv.vendor_id AND cvv.is_active
    WHERE cv.item_id = i.id AND cv.is_active
    ORDER BY cv.cost_price ASC NULLS LAST, cv.id ASC
    LIMIT 1
  ) cheapest ON TRUE
  LEFT JOIN vendor_products vp ON vp.id = COALESCE(own_vendor.id, cheapest.id)
  LEFT JOIN vendors v ON v.id = vp.vendor_id
  WHERE i.id = ANY(p_item_ids) AND i.is_active
  ORDER BY i.id;
$function$
