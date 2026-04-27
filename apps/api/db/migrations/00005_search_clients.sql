-- +goose Up
-- +goose StatementBegin

-- 00005 — SEARCH CLIENTS (companies + contacts)
-- Fuzzy search across company_client + company_contacts.
-- Output: flat row per (company × contact). Companies with
-- no active contact still appear with contact_* = NULL (LEFT JOIN).
-- Search signals: company name, contact name, email.
-- (NPWP excluded per user decision).

-- Indexes for fuzzy search (data UPPERCASE convention)
CREATE INDEX idx_company_client_name_trgm
  ON company_client USING GIN (name gin_trgm_ops);

CREATE INDEX idx_company_contacts_name_trgm
  ON company_contacts USING GIN (name gin_trgm_ops);

-- +goose StatementEnd


-- +goose StatementBegin
CREATE FUNCTION fn_search_clients(
  p_q         TEXT,
  p_min_score REAL DEFAULT 0.3,
  p_limit     INT  DEFAULT 10
) RETURNS TABLE (
  company_id      BIGINT,
  company_name    VARCHAR,
  company_number  VARCHAR,
  company_npwp    VARCHAR,
  company_address TEXT,
  company_email   VARCHAR,
  company_country CHAR(3),
  company_tku     VARCHAR,
  contact_id      BIGINT,
  contact_name    VARCHAR,
  contact_email   VARCHAR,
  contact_phone   VARCHAR,
  contact_title   VARCHAR,
  score           REAL,
  match_tier      TEXT
) AS $$
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
        -- Company name signals (highest priority)
        CASE WHEN UPPER(cc.name) ILIKE '%'||n.nq||'%' THEN 0.95::REAL ELSE 0::REAL END,
        word_similarity(n.nq, UPPER(cc.name)),
        -- Contact name signals (slight down-weight vs company)
        CASE WHEN ct.id IS NOT NULL AND UPPER(ct.name) ILIKE '%'||n.nq||'%' THEN 0.85::REAL ELSE 0::REAL END,
        CASE WHEN ct.id IS NOT NULL
             THEN (word_similarity(n.nq, UPPER(ct.name)) * 0.90)::REAL
             ELSE 0::REAL END,
        -- Email signals (lower weight, fallback)
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
$$ LANGUAGE SQL STABLE;
-- +goose StatementEnd


-- +goose StatementBegin
COMMENT ON FUNCTION fn_search_clients(TEXT, REAL, INT) IS
  'Fuzzy search company + contacts. Flat 1 row per (company × contact). Companies with no active contact still appear (contact_* NULL). Signals: company.name (0.95), contact.name (0.85), email (0.80). Tier: AUTO_MATCH ≥0.9, SUGGESTED ≥0.6, FUZZY ≥0.3.';
-- +goose StatementEnd


-- +goose Down
-- +goose StatementBegin
DROP FUNCTION IF EXISTS fn_search_clients(TEXT, REAL, INT);
DROP INDEX IF EXISTS idx_company_contacts_name_trgm;
DROP INDEX IF EXISTS idx_company_client_name_trgm;
-- +goose StatementEnd
