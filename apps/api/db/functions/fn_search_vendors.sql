-- Canonical current body of fn_search_vendors (deployed by migration 00008).
CREATE OR REPLACE FUNCTION public.fn_search_vendors(p_q text, p_min_score real DEFAULT 0.3, p_limit integer DEFAULT 10)
 RETURNS TABLE(vendor_id bigint, vendor_name character varying, location character varying, contact_info jsonb, score real, match_tier text)
 LANGUAGE sql
 STABLE
AS $function$
  WITH normalized AS (
    SELECT UPPER(REGEXP_REPLACE(TRIM(p_q), '\s+', ' ', 'g')) AS nq
  ),
  candidates AS (
    SELECT
      v.id           AS vendor_id,
      v.name         AS vendor_name,
      v.location,
      v.contact_info,
      GREATEST(
        -- Name signals (highest)
        CASE WHEN UPPER(v.name) ILIKE '%'||n.nq||'%' THEN 0.95::REAL ELSE 0::REAL END,
        word_similarity(n.nq, UPPER(v.name)),
        -- Location signals (lower weight)
        CASE WHEN UPPER(COALESCE(v.location,'')) ILIKE '%'||n.nq||'%' THEN 0.70::REAL ELSE 0::REAL END,
        (word_similarity(n.nq, UPPER(COALESCE(v.location,''))) * 0.70)::REAL
      ) AS combined_score
    FROM vendors v, normalized n
    WHERE v.is_active = TRUE
      AND (
        UPPER(v.name) ILIKE '%'||n.nq||'%'
        OR n.nq <% UPPER(v.name)
        OR UPPER(COALESCE(v.location,'')) ILIKE '%'||n.nq||'%'
      )
  )
  SELECT
    c.vendor_id, c.vendor_name, c.location, c.contact_info,
    c.combined_score AS score,
    CASE
      WHEN c.combined_score >= 0.90 THEN 'AUTO_MATCH'
      WHEN c.combined_score >= 0.60 THEN 'SUGGESTED'
      ELSE 'FUZZY'
    END::TEXT AS match_tier
  FROM candidates c
  WHERE c.combined_score >= p_min_score
  ORDER BY c.combined_score DESC, c.vendor_name ASC
  LIMIT p_limit;
$function$
