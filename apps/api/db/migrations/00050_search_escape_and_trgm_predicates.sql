-- +goose Up

-- Two defects in one pass over the four search functions.
--
-- 1. The ILIKE patterns were built straight from user input, so a lone `%`
--    matched every row and scored 0.95 AUTO_MATCH. Each function now derives
--    an escaped `pat` once and every LIKE predicate uses it.
-- 2. The predicates wrapped the indexed columns in UPPER()/COALESCE(), which
--    hides the expression the GIN trigram indexes were built on
--    (idx_items_name_trgm, idx_company_client_name_trgm, idx_vendors_name_trgm,
--    idx_item_request_matches_trgm). pg_trgm lowercases before extracting
--    trigrams and ILIKE is case-insensitive, so dropping the wrappers keeps
--    the result set identical while making the indexes reachable.

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_search_items(p_q text, p_min_score real DEFAULT 0.3, p_limit integer DEFAULT 10)
 RETURNS TABLE(id bigint, name character varying, impa_code character varying, default_unit_id smallint, score real, match_tier text)
 LANGUAGE sql
 STABLE
AS $function$
  WITH normalized AS (
    SELECT
      UPPER(REGEXP_REPLACE(TRIM(p_q), '\s+', ' ', 'g')) AS nq,
      '%' || REPLACE(REPLACE(REPLACE(
        UPPER(REGEXP_REPLACE(TRIM(p_q), '\s+', ' ', 'g')),
        '\', '\\'), '%', '\%'), '_', '\_') || '%' AS pat
  ),
  candidates AS (
    SELECT
      i.id, i.name, i.impa_code, i.default_unit_id,
      GREATEST(
        -- 1. Exact IMPA match (highest signal)
        CASE WHEN i.impa_code = n.nq THEN 1.00::REAL ELSE 0::REAL END,
        -- 2. IMPA contains query
        CASE WHEN i.impa_code ILIKE n.pat THEN 0.95::REAL ELSE 0::REAL END,
        -- 3. Name contains query verbatim (case-insensitive ILIKE)
        CASE WHEN i.name ILIKE n.pat THEN 0.90::REAL ELSE 0::REAL END,
        -- 4. Fuzzy word match on name (workhorse)
        word_similarity(n.nq, i.name),
        -- 5. Fuzzy IMPA (typo di digit), weighted down
        (similarity(COALESCE(i.impa_code,''), n.nq) * 0.80)::REAL
      ) AS combined_score
    FROM items i, normalized n
    WHERE i.is_active = TRUE
      AND (
        i.name ILIKE n.pat
        OR i.impa_code ILIKE n.pat
        OR n.nq <% i.name
        OR i.impa_code % n.nq
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
$function$;
-- +goose StatementEnd

-- +goose StatementBegin
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
  -- Tier 2: Learning cache fuzzy (confidence x 0.95 discount)
  learned_fuzzy AS (
    SELECT
      irm.matched_item_id AS item_id,
      (word_similarity(n.nq, irm.request_text) * 0.95)::REAL AS confidence,
      'LEARNED_FUZZY'     AS source
    FROM item_request_matches irm, normalized n
    WHERE irm.matched_item_id IS NOT NULL
      AND n.nq <% irm.request_text
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
$function$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_search_clients(p_q text, p_min_score real DEFAULT 0.3, p_limit integer DEFAULT 10)
 RETURNS TABLE(company_id bigint, company_name character varying, company_number character varying, company_npwp character varying, company_address text, company_email character varying, company_country character, company_tku character varying, contact_id bigint, contact_name character varying, contact_email character varying, contact_phone character varying, contact_title character varying, score real, match_tier text)
 LANGUAGE sql
 STABLE
AS $function$
  WITH normalized AS (
    SELECT
      UPPER(REGEXP_REPLACE(TRIM(p_q), '\s+', ' ', 'g')) AS nq,
      '%' || REPLACE(REPLACE(REPLACE(
        UPPER(REGEXP_REPLACE(TRIM(p_q), '\s+', ' ', 'g')),
        '\', '\\'), '%', '\%'), '_', '\_') || '%' AS pat
  ),
  candidates AS (
    SELECT
      cc.id            AS company_id,
      cc.name          AS company_name,
      cc.number        AS company_number,
      cc.npwp          AS company_npwp,
      cc.address       AS company_address,
      cc.email         AS company_email,
      cc.country_code  AS company_country,
      cc.tku_id        AS company_tku,
      ct.id            AS contact_id,
      ct.name          AS contact_name,
      ct.email         AS contact_email,
      ct.phone         AS contact_phone,
      ct.title         AS contact_title,
      GREATEST(
        -- Company name signals (highest priority)
        CASE WHEN cc.name ILIKE n.pat THEN 0.95::REAL ELSE 0::REAL END,
        word_similarity(n.nq, cc.name),
        -- Contact name signals (slight down-weight vs company)
        CASE WHEN ct.id IS NOT NULL AND ct.name ILIKE n.pat THEN 0.85::REAL ELSE 0::REAL END,
        CASE WHEN ct.id IS NOT NULL
             THEN (word_similarity(n.nq, ct.name) * 0.90)::REAL
             ELSE 0::REAL END,
        -- Email signals (lower weight, fallback)
        CASE WHEN cc.email ILIKE n.pat THEN 0.80::REAL ELSE 0::REAL END,
        CASE WHEN ct.id IS NOT NULL AND ct.email ILIKE n.pat THEN 0.80::REAL ELSE 0::REAL END,
        (word_similarity(n.nq, COALESCE(cc.email,'')) * 0.70)::REAL,
        CASE WHEN ct.id IS NOT NULL
             THEN (word_similarity(n.nq, COALESCE(ct.email,'')) * 0.70)::REAL
             ELSE 0::REAL END
      ) AS combined_score
    FROM company_client cc
    LEFT JOIN company_contacts ct
           ON ct.company_id = cc.id
          AND ct.is_active = TRUE
    CROSS JOIN normalized n
    WHERE cc.is_active = TRUE
      AND (
        cc.name ILIKE n.pat
        OR n.nq <% cc.name
        OR cc.email ILIKE n.pat
        OR (ct.id IS NOT NULL AND (
              ct.name ILIKE n.pat
              OR n.nq <% ct.name
              OR ct.email ILIKE n.pat
           ))
      )
  )
  SELECT
    c.company_id, c.company_name, c.company_number, c.company_npwp,
    c.company_address, c.company_email, c.company_country, c.company_tku,
    c.contact_id, c.contact_name, c.contact_email, c.contact_phone, c.contact_title,
    c.combined_score AS score,
    CASE
      WHEN c.combined_score >= 0.90 THEN 'AUTO_MATCH'
      WHEN c.combined_score >= 0.60 THEN 'SUGGESTED'
      ELSE 'FUZZY'
    END::TEXT AS match_tier
  FROM candidates c
  WHERE c.combined_score >= p_min_score
  ORDER BY c.combined_score DESC,
           c.company_name ASC,
           c.contact_name ASC NULLS FIRST
  LIMIT p_limit;
$function$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_search_vendors(p_q text, p_min_score real DEFAULT 0.3, p_limit integer DEFAULT 10)
 RETURNS TABLE(vendor_id bigint, vendor_name character varying, location character varying, contact_info jsonb, score real, match_tier text)
 LANGUAGE sql
 STABLE
AS $function$
  WITH normalized AS (
    SELECT
      UPPER(REGEXP_REPLACE(TRIM(p_q), '\s+', ' ', 'g')) AS nq,
      '%' || REPLACE(REPLACE(REPLACE(
        UPPER(REGEXP_REPLACE(TRIM(p_q), '\s+', ' ', 'g')),
        '\', '\\'), '%', '\%'), '_', '\_') || '%' AS pat
  ),
  candidates AS (
    SELECT
      v.id           AS vendor_id,
      v.name         AS vendor_name,
      v.location,
      v.contact_info,
      GREATEST(
        -- Name signals (highest)
        CASE WHEN v.name ILIKE n.pat THEN 0.95::REAL ELSE 0::REAL END,
        word_similarity(n.nq, v.name),
        -- Location signals (lower weight)
        CASE WHEN v.location ILIKE n.pat THEN 0.70::REAL ELSE 0::REAL END,
        (word_similarity(n.nq, COALESCE(v.location,'')) * 0.70)::REAL
      ) AS combined_score
    FROM vendors v, normalized n
    WHERE v.is_active = TRUE
      AND (
        v.name ILIKE n.pat
        OR n.nq <% v.name
        OR v.location ILIKE n.pat
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
$function$;
-- +goose StatementEnd

-- +goose Down

-- +goose StatementBegin
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
        CASE WHEN i.impa_code = n.nq THEN 1.00::REAL ELSE 0::REAL END,
        CASE WHEN COALESCE(i.impa_code,'') ILIKE '%'||n.nq||'%' THEN 0.95::REAL ELSE 0::REAL END,
        CASE WHEN i.name ILIKE '%'||n.nq||'%' THEN 0.90::REAL ELSE 0::REAL END,
        word_similarity(n.nq, i.name),
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
$function$;
-- +goose StatementEnd

-- +goose StatementBegin
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
  learned_exact AS (
    SELECT
      irm.matched_item_id AS item_id,
      1.00::REAL          AS confidence,
      'LEARNED_EXACT'     AS source
    FROM item_request_matches irm, normalized n
    WHERE LOWER(TRIM(irm.request_text)) = n.nq_lower
      AND irm.matched_item_id IS NOT NULL
  ),
  learned_fuzzy AS (
    SELECT
      irm.matched_item_id AS item_id,
      (word_similarity(n.nq, UPPER(irm.request_text)) * 0.95)::REAL AS confidence,
      'LEARNED_FUZZY'     AS source
    FROM item_request_matches irm, normalized n
    WHERE irm.matched_item_id IS NOT NULL
      AND n.nq <% UPPER(irm.request_text)
      AND LOWER(TRIM(irm.request_text)) != n.nq_lower
  ),
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
$function$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_search_clients(p_q text, p_min_score real DEFAULT 0.3, p_limit integer DEFAULT 10)
 RETURNS TABLE(company_id bigint, company_name character varying, company_number character varying, company_npwp character varying, company_address text, company_email character varying, company_country character, company_tku character varying, contact_id bigint, contact_name character varying, contact_email character varying, contact_phone character varying, contact_title character varying, score real, match_tier text)
 LANGUAGE sql
 STABLE
AS $function$
  WITH normalized AS (
    SELECT UPPER(REGEXP_REPLACE(TRIM(p_q), '\s+', ' ', 'g')) AS nq
  ),
  candidates AS (
    SELECT
      cc.id            AS company_id,
      cc.name          AS company_name,
      cc.number        AS company_number,
      cc.npwp          AS company_npwp,
      cc.address       AS company_address,
      cc.email         AS company_email,
      cc.country_code  AS company_country,
      cc.tku_id        AS company_tku,
      ct.id            AS contact_id,
      ct.name          AS contact_name,
      ct.email         AS contact_email,
      ct.phone         AS contact_phone,
      ct.title         AS contact_title,
      GREATEST(
        CASE WHEN UPPER(cc.name) ILIKE '%'||n.nq||'%' THEN 0.95::REAL ELSE 0::REAL END,
        word_similarity(n.nq, UPPER(cc.name)),
        CASE WHEN ct.id IS NOT NULL AND UPPER(ct.name) ILIKE '%'||n.nq||'%' THEN 0.85::REAL ELSE 0::REAL END,
        CASE WHEN ct.id IS NOT NULL
             THEN (word_similarity(n.nq, UPPER(ct.name)) * 0.90)::REAL
             ELSE 0::REAL END,
        CASE WHEN UPPER(COALESCE(cc.email,'')) ILIKE '%'||n.nq||'%' THEN 0.80::REAL ELSE 0::REAL END,
        CASE WHEN ct.id IS NOT NULL AND UPPER(COALESCE(ct.email,'')) ILIKE '%'||n.nq||'%' THEN 0.80::REAL ELSE 0::REAL END,
        (word_similarity(n.nq, UPPER(COALESCE(cc.email,''))) * 0.70)::REAL,
        CASE WHEN ct.id IS NOT NULL
             THEN (word_similarity(n.nq, UPPER(COALESCE(ct.email,''))) * 0.70)::REAL
             ELSE 0::REAL END
      ) AS combined_score
    FROM company_client cc
    LEFT JOIN company_contacts ct
           ON ct.company_id = cc.id
          AND ct.is_active = TRUE
    CROSS JOIN normalized n
    WHERE cc.is_active = TRUE
      AND (
        UPPER(cc.name) ILIKE '%'||n.nq||'%'
        OR n.nq <% UPPER(cc.name)
        OR UPPER(COALESCE(cc.email,'')) ILIKE '%'||n.nq||'%'
        OR (ct.id IS NOT NULL AND (
              UPPER(ct.name) ILIKE '%'||n.nq||'%'
              OR n.nq <% UPPER(ct.name)
              OR UPPER(COALESCE(ct.email,'')) ILIKE '%'||n.nq||'%'
           ))
      )
  )
  SELECT
    c.company_id, c.company_name, c.company_number, c.company_npwp,
    c.company_address, c.company_email, c.company_country, c.company_tku,
    c.contact_id, c.contact_name, c.contact_email, c.contact_phone, c.contact_title,
    c.combined_score AS score,
    CASE
      WHEN c.combined_score >= 0.90 THEN 'AUTO_MATCH'
      WHEN c.combined_score >= 0.60 THEN 'SUGGESTED'
      ELSE 'FUZZY'
    END::TEXT AS match_tier
  FROM candidates c
  WHERE c.combined_score >= p_min_score
  ORDER BY c.combined_score DESC,
           c.company_name ASC,
           c.contact_name ASC NULLS FIRST
  LIMIT p_limit;
$function$;
-- +goose StatementEnd

-- +goose StatementBegin
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
        CASE WHEN UPPER(v.name) ILIKE '%'||n.nq||'%' THEN 0.95::REAL ELSE 0::REAL END,
        word_similarity(n.nq, UPPER(v.name)),
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
$function$;
-- +goose StatementEnd
