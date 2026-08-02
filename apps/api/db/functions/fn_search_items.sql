-- Canonical current body of fn_search_items (deployed by migration 00003).
CREATE OR REPLACE FUNCTION public.fn_search_items(p_q text, p_min_score real DEFAULT 0.3, p_limit integer DEFAULT 10)
 RETURNS TABLE(id bigint, name character varying, impa_code character varying, default_unit_id smallint, score real, match_tier text)
 LANGUAGE sql
 STABLE
AS $function$
  WITH normalized AS (
    SELECT UPPER(REGEXP_REPLACE(TRIM(p_q), '\s+', ' ', 'g')) AS nq
  ),
  candidates AS (
    SELECT
      i.id, i.name, i.impa_code, i.default_unit_id,
      GREATEST(
        -- 1. Exact IMPA match (highest signal)
        CASE WHEN i.impa_code = n.nq THEN 1.00::REAL ELSE 0::REAL END,
        -- 2. IMPA contains query
        CASE WHEN COALESCE(i.impa_code,'') ILIKE '%'||n.nq||'%' THEN 0.95::REAL ELSE 0::REAL END,
        -- 3. Name contains query verbatim (case-insensitive ILIKE)
        CASE WHEN i.name ILIKE '%'||n.nq||'%' THEN 0.90::REAL ELSE 0::REAL END,
        -- 4. Fuzzy word match on name (workhorse)
        word_similarity(n.nq, i.name),
        -- 5. Fuzzy IMPA (typo di digit), weighted down
        (similarity(COALESCE(i.impa_code,''), n.nq) * 0.80)::REAL
      ) AS combined_score
    FROM items i, normalized n
    WHERE i.is_active = TRUE
      AND (
        i.name ILIKE '%'||n.nq||'%'
        OR COALESCE(i.impa_code,'') ILIKE '%'||n.nq||'%'
        OR n.nq <% i.name
        OR COALESCE(i.impa_code,'') % n.nq
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
