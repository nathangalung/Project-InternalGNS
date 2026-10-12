-- Canonical current body of fn_search_items (deployed by migration 00113).
CREATE OR REPLACE FUNCTION public.fn_search_items(p_q text, p_min_score real DEFAULT 0.3, p_limit integer DEFAULT 10, p_is_active boolean DEFAULT true)
 RETURNS TABLE(id bigint, name character varying, impa_code character varying, default_unit_id smallint, score real, match_tier text)
 LANGUAGE sql
 STABLE
AS $function$
  WITH normalized AS (
    SELECT
      UPPER(REGEXP_REPLACE(TRIM(p_q), '\s+', ' ', 'g')) AS nq,
      '%' || REPLACE(REPLACE(REPLACE(
        UPPER(REGEXP_REPLACE(TRIM(p_q), '\s+', ' ', 'g')),
        '\', '\\'), '%', '\%'), '_', '\_') || '%' AS pat,
      -- A query that is an IMPA code finds only its holder.
      NULLIF(SUBSTRING(fn_impa_code(p_q) FROM '^[0-9]{6}$'), '') AS code
  ),
  candidates AS (
    SELECT i.id, i.name, i.impa_code, i.default_unit_id, 1.00::REAL AS combined_score
    FROM items i, normalized n
    WHERE n.code IS NOT NULL
      AND i.impa_code = n.code
      AND (p_is_active IS NULL OR i.is_active = p_is_active)
    UNION ALL
    SELECT
      i.id, i.name, i.impa_code, i.default_unit_id,
      GREATEST(
        -- 1. Exact IMPA match
        CASE WHEN i.impa_code = n.nq THEN 1.00::REAL ELSE 0::REAL END,
        -- 2. IMPA contains query, for a partly typed code
        CASE WHEN i.impa_code ILIKE n.pat THEN 0.95::REAL ELSE 0::REAL END,
        -- 3. Name contains query verbatim (case-insensitive ILIKE)
        CASE WHEN i.name ILIKE n.pat THEN 0.90::REAL ELSE 0::REAL END,
        -- 4. Fuzzy word match on name
        word_similarity(n.nq, i.name)
      ) AS combined_score
    FROM items i, normalized n
    WHERE n.code IS NULL
      AND (p_is_active IS NULL OR i.is_active = p_is_active)
      AND (
        i.name ILIKE n.pat
        OR i.impa_code ILIKE n.pat
        OR n.nq <% i.name
      )
  )
  SELECT
    c.id, c.name, c.impa_code, c.default_unit_id,
    c.combined_score AS score,
    CASE
      WHEN c.combined_score >= 0.90 THEN 'AUTO_MATCH'
      WHEN c.combined_score >= 0.60 THEN 'SUGGESTED'
      ELSE 'FUZZY'
    END::TEXT AS match_tier
  FROM candidates c
  WHERE c.combined_score >= p_min_score
  ORDER BY c.combined_score DESC, c.name ASC
  LIMIT p_limit;
$function$
