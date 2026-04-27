-- +goose Up
-- +goose StatementBegin

-- 00008 — SEARCH VENDORS
-- Fuzzy search vendor by name + location.
-- Same pattern as fn_search_items and fn_search_clients.

CREATE INDEX idx_vendors_name_trgm
  ON vendors USING GIN (name gin_trgm_ops);

-- +goose StatementEnd


-- +goose StatementBegin
CREATE FUNCTION fn_search_vendors(
  p_q         TEXT,
  p_min_score REAL DEFAULT 0.3,
  p_limit     INT  DEFAULT 10
) RETURNS TABLE (
  vendor_id    BIGINT,
  vendor_name  VARCHAR,
  location     VARCHAR,
  contact_info JSONB,
  score        REAL,
  match_tier   TEXT
) AS $$
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
$$ LANGUAGE SQL STABLE;
-- +goose StatementEnd


-- +goose StatementBegin
COMMENT ON FUNCTION fn_search_vendors(TEXT, REAL, INT) IS
  'Fuzzy search vendor by name + location. Tier: AUTO_MATCH ≥0.9, SUGGESTED ≥0.6, FUZZY ≥0.3.';
-- +goose StatementEnd


-- +goose Down
-- +goose StatementBegin
DROP FUNCTION IF EXISTS fn_search_vendors(TEXT, REAL, INT);
DROP INDEX IF EXISTS idx_vendors_name_trgm;
-- +goose StatementEnd
