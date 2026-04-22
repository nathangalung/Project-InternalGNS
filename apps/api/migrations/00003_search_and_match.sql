-- +goose Up
-- +goose StatementBegin

-- ============================================================
-- 00003 — SEARCH & MATCH
-- ============================================================
-- 1. View:     v_items_with_cheapest_vendor — procurement lookup
-- 2. Function: fn_search_items — fuzzy search (name + IMPA)
-- 3. Function: fn_search_items_by_vendor — reverse lookup
-- 4. Function: fn_match_request — smart match dgn learning cache
-- 5. Trigger:  trg_learn_match — UPSERT item_request_matches
--              setiap quotation_item INSERT dengan match confirmed
-- ============================================================
-- Convention: query + data normalized via UPPER(TRIM(REGEXP_REPLACE(..,'\s+',' '))).
-- Ship supply items convention: stored UPPERCASE. Existing GIN trgm
-- idx_items_name_trgm supports both `<%` operator dan `ILIKE` search.
-- ============================================================


-- ─── 1. View: cheapest vendor per item ────────────────────
CREATE VIEW v_items_with_cheapest_vendor AS
SELECT DISTINCT ON (i.id)
  i.id                 AS item_id,
  i.name               AS item_name,
  i.impa_code,
  i.default_unit_id,
  vp.id                AS vendor_product_id,
  vp.vendor_id,
  v.name               AS vendor_name,
  vp.vendor_sku,
  vp.cost_price        AS lowest_cost,
  vp.last_quoted_at
FROM items i
LEFT JOIN vendor_products vp
       ON vp.item_id = i.id
      AND vp.is_active = TRUE
LEFT JOIN vendors v
       ON v.id = vp.vendor_id
      AND v.is_active = TRUE
WHERE i.is_active = TRUE
ORDER BY i.id, vp.cost_price ASC NULLS LAST;

COMMENT ON VIEW v_items_with_cheapest_vendor IS
  'Procurement lookup: untuk tiap item aktif, tampilkan vendor dgn cost_price terendah. Item tanpa vendor_product (belum di-source) tetap muncul dengan vendor_id NULL.';

-- +goose StatementEnd


-- ─── 2. Function: fuzzy search items (name + IMPA) ────────
-- +goose StatementBegin
CREATE FUNCTION fn_search_items(
  p_q         TEXT,
  p_min_score REAL DEFAULT 0.3,
  p_limit     INT  DEFAULT 10
) RETURNS TABLE (
  id                BIGINT,
  name              VARCHAR,
  impa_code         VARCHAR,
  default_unit_id   SMALLINT,
  score             REAL,
  match_tier        TEXT
) AS $$
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
$$ LANGUAGE SQL STABLE;
-- +goose StatementEnd


-- +goose StatementBegin
COMMENT ON FUNCTION fn_search_items(TEXT, REAL, INT) IS
  'Combined-signal fuzzy search. Tier: ≥0.90 AUTO_MATCH, ≥0.60 SUGGESTED, ≥0.30 FUZZY. Normalisasi UPPER(TRIM+collapse whitespace).';
-- +goose StatementEnd


-- ─── 3. Function: items per vendor (reverse lookup) ───────
-- +goose StatementBegin
CREATE FUNCTION fn_search_items_by_vendor(
  p_vendor_id BIGINT,
  p_limit     INT DEFAULT 50
) RETURNS TABLE (
  item_id         BIGINT,
  item_name       VARCHAR,
  impa_code       VARCHAR,
  vendor_sku      VARCHAR,
  cost_price      NUMERIC,
  last_quoted_at  TIMESTAMPTZ
) AS $$
  SELECT
    i.id, i.name, i.impa_code,
    vp.vendor_sku, vp.cost_price, vp.last_quoted_at
  FROM vendor_products vp
  JOIN items i ON i.id = vp.item_id AND i.is_active = TRUE
  WHERE vp.vendor_id = p_vendor_id
    AND vp.is_active = TRUE
  ORDER BY vp.last_quoted_at DESC NULLS LAST, i.name ASC
  LIMIT p_limit;
$$ LANGUAGE SQL STABLE;
-- +goose StatementEnd


-- +goose StatementBegin
COMMENT ON FUNCTION fn_search_items_by_vendor(BIGINT, INT) IS
  'List semua items aktif yang di-supply oleh vendor, sorted by last_quoted_at DESC.';
-- +goose StatementEnd


-- ─── 4. Function: smart match request (2-tier) ────────────
-- +goose StatementBegin
CREATE FUNCTION fn_match_request(
  p_req_text TEXT,
  p_limit    INT DEFAULT 5
) RETURNS TABLE (
  item_id     BIGINT,
  item_name   VARCHAR,
  impa_code   VARCHAR,
  confidence  REAL,
  source      TEXT
) AS $$
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
$$ LANGUAGE SQL STABLE;
-- +goose StatementEnd


-- +goose StatementBegin
COMMENT ON FUNCTION fn_match_request(TEXT, INT) IS
  'Smart match: (1) cache exact, (2) cache fuzzy, (3) catalog fallback. Return top-N dedup by item_id.';
-- +goose StatementEnd


-- ─── 5. Trigger: auto-populate learning cache ─────────────
-- +goose StatementBegin
CREATE FUNCTION trg_fn_learn_match() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.requested_item_id IS NOT NULL
     AND NEW.requested_name IS NOT NULL
     AND TRIM(NEW.requested_name) != '' THEN

    INSERT INTO item_request_matches
      (request_text, matched_item_id, match_count, last_used_at)
    VALUES
      (NEW.requested_name, NEW.requested_item_id, 1, NOW())
    ON CONFLICT (LOWER(TRIM(request_text)))
    DO UPDATE SET
      match_count     = item_request_matches.match_count + 1,
      last_used_at    = NOW(),
      matched_item_id = EXCLUDED.matched_item_id;

  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd


-- +goose StatementBegin
COMMENT ON FUNCTION trg_fn_learn_match() IS
  'Trigger function: setiap quotation_item INSERT dengan requested_item_id set → UPSERT ke item_request_matches (increment match_count via existing unique idx on LOWER(TRIM(request_text))).';

CREATE TRIGGER trg_learn_match
AFTER INSERT ON quotation_items
FOR EACH ROW
EXECUTE FUNCTION trg_fn_learn_match();
-- +goose StatementEnd


-- +goose Down
-- +goose StatementBegin
DROP TRIGGER  IF EXISTS trg_learn_match ON quotation_items;
DROP FUNCTION IF EXISTS trg_fn_learn_match();
DROP FUNCTION IF EXISTS fn_match_request(TEXT, INT);
DROP FUNCTION IF EXISTS fn_search_items_by_vendor(BIGINT, INT);
DROP FUNCTION IF EXISTS fn_search_items(TEXT, REAL, INT);
DROP VIEW     IF EXISTS v_items_with_cheapest_vendor;
-- +goose StatementEnd
