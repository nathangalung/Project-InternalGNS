-- +goose Up

-- 00055 MASTER DATA KEYS
-- 1. A deleted contact kept its email in a unique index that ignored
--    is_active, so the address could never be used again by any client
--    (MD-08). Only active contacts own an email now.
-- 2. IMPA codes were stored as typed while import matching upper-cased the
--    lookup, so a lowercase code never matched and auto-create made a second
--    item (MD-03). Nothing stopped two active items sharing a code either,
--    and the lookup picked one of them at random (MD-04). Codes are stored
--    trimmed and upper-cased from now on, and one active item owns a code.
-- 3. The catalog search ORs name and impa_code trigram predicates. Only name
--    had a trigram index, so no arm of the OR could use an index and every
--    call scanned the table. The impa_code trigram index makes the whole OR
--    answerable from bitmap scans, which the batched import match relies on.

DROP INDEX IF EXISTS idx_company_contacts_email;

CREATE UNIQUE INDEX idx_company_contacts_email
  ON company_contacts (LOWER(email))
  WHERE email IS NOT NULL AND is_active;

UPDATE items
   SET impa_code = NULLIF(UPPER(BTRIM(impa_code)), '')
 WHERE impa_code IS DISTINCT FROM NULLIF(UPPER(BTRIM(impa_code)), '');

-- Refuse to guess which duplicate is the real item: merging catalog rows is a
-- business decision, so name them and stop.
-- +goose StatementBegin
DO $$
DECLARE
  v_dups TEXT;
BEGIN
  SELECT string_agg(impa_code || ' (items ' || ids || ')', '; ')
    INTO v_dups
    FROM (
      SELECT impa_code, string_agg(id::TEXT, ', ' ORDER BY id) AS ids
        FROM items
       WHERE is_active AND impa_code IS NOT NULL
       GROUP BY impa_code
      HAVING COUNT(*) > 1
    ) d;
  IF v_dups IS NOT NULL THEN
    RAISE EXCEPTION 'active items share an IMPA code, merge or deactivate them first: %', v_dups;
  END IF;
END $$;
-- +goose StatementEnd

CREATE UNIQUE INDEX uq_items_impa_code_active
  ON items (UPPER(impa_code))
  WHERE is_active AND impa_code IS NOT NULL;

CREATE INDEX idx_items_impa_trgm
  ON items USING gin (impa_code gin_trgm_ops);

-- +goose Down

-- The IMPA normalisation is not reversed: the original casing is gone.

DROP INDEX IF EXISTS idx_items_impa_trgm;

DROP INDEX IF EXISTS uq_items_impa_code_active;

DROP INDEX IF EXISTS idx_company_contacts_email;

CREATE UNIQUE INDEX idx_company_contacts_email
  ON company_contacts (LOWER(email))
  WHERE email IS NOT NULL;
