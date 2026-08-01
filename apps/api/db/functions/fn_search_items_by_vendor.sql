-- Canonical current body of fn_search_items_by_vendor (deployed by migration 00003).
CREATE OR REPLACE FUNCTION public.fn_search_items_by_vendor(p_vendor_id bigint, p_limit integer DEFAULT 50)
 RETURNS TABLE(item_id bigint, item_name character varying, impa_code character varying, vendor_sku character varying, cost_price numeric, last_quoted_at timestamp with time zone)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT
    i.id, i.name, i.impa_code,
    vp.vendor_sku, vp.cost_price, vp.last_quoted_at
  FROM vendor_products vp
  JOIN items i ON i.id = vp.item_id AND i.is_active = TRUE
  WHERE vp.vendor_id = p_vendor_id
    AND vp.is_active = TRUE
  ORDER BY vp.last_quoted_at DESC NULLS LAST, i.name ASC
  LIMIT p_limit;
$function$
