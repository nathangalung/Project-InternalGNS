-- Canonical current body of fn_match_request (deployed by migration 00003).
CREATE OR REPLACE FUNCTION public.fn_match_request(p_req_text text, p_limit integer DEFAULT 5)
 RETURNS TABLE(item_id bigint, item_name character varying, impa_code character varying, confidence real, source text)
 LANGUAGE sql
 STABLE
AS $function$
  WITH normalized AS (
    SELECT
      UPPER(REGEXP_REPLACE(TRIM(p_req_text), '\s+', ' ', 'g')) AS nq,
      LOWER(TRIM(p_req_text)) AS nq_lower
  ),
  -- Tier 1: Learning cache exact match (confidence 1.00)
  learned_exact AS (
    SELECT
      irm.matched_item_id AS item_id,
      1.00::REAL          AS confidence,
      'LEARNED_EXACT'     AS source
    FROM item_request_matches irm, normalized n
    WHERE LOWER(TRIM(irm.request_text)) = n.nq_lower
      AND irm.matched_item_id IS NOT NULL
  ),
  -- Tier 2: Learning cache fuzzy (confidence × 0.95 discount)
  learned_fuzzy AS (
    SELECT
      irm.matched_item_id AS item_id,
      (word_similarity(n.nq, UPPER(irm.request_text)) * 0.95)::REAL AS confidence,
      'LEARNED_FUZZY'     AS source
    FROM item_request_matches irm, normalized n
    WHERE irm.matched_item_id IS NOT NULL
      AND n.nq <% UPPER(irm.request_text)
      AND LOWER(TRIM(irm.request_text)) != n.nq_lower  -- exclude exact (Tier 1)
  ),
  -- Tier 3: Catalog search fallback
  catalog_match AS (
    SELECT
      s.id            AS item_id,
      s.score         AS confidence,
      'CATALOG_MATCH' AS source
    FROM fn_search_items(p_req_text, 0.60, p_limit) s
  ),
  all_matches AS (
    SELECT * FROM learned_exact
    UNION ALL
    SELECT * FROM learned_fuzzy
    UNION ALL
    SELECT * FROM catalog_match
  ),
  -- Dedup: keep max confidence per item_id
  deduped AS (
    SELECT DISTINCT ON (item_id)
      item_id, confidence, source
    FROM all_matches
    ORDER BY item_id, confidence DESC
  )
  SELECT
    d.item_id,
    i.name  AS item_name,
    i.impa_code,
    d.confidence,
    d.source::TEXT
  FROM deduped d
  JOIN items i ON i.id = d.item_id
  WHERE i.is_active = TRUE
  ORDER BY d.confidence DESC, i.name ASC
  LIMIT p_limit;
$function$
