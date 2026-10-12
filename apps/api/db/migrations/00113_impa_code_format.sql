-- +goose Up
-- 00113 IMPA CODE FORMAT
-- An IMPA code is six digits. fn_impa_code reduces the forms people type
-- (IMPA 190105, (190105), 19 01 05) to them, and a CHECK on every code
-- column keeps anything else out. A name or request text no longer
-- repeats its own row's code: fn_impa_split takes the code and its IMPA
-- mark, brackets and separator out of the text, and moves an IMPA marked
-- code from a request's text into its empty code field. Triggers run it on
-- every write to the catalog, quotation lines, client requests and PO
-- lines, and the rows stored before are cleaned once here. Invoice lines
-- are left as they were filed with DJP.
-- A query that is an IMPA code now finds only the product holding it, and
-- no search matches a code by trigram similarity any more.

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_impa_code(p_code text)
 RETURNS text
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  v_raw  text := regexp_replace(p_code, '^\s+|\s+$', '', 'g');
  v_code text;
BEGIN
  -- Blank or the shown placeholder is no code.
  IF v_raw IS NULL OR translate(v_raw, '-' || chr(8211) || chr(8212), '') = '' THEN
    RETURN NULL;
  END IF;
  v_code := upper(v_raw);
  IF v_code ~ '^\(.*\)$' THEN
    v_code := regexp_replace(substr(v_code, 2, length(v_code) - 2), '^\s+|\s+$', '', 'g');
  END IF;
  v_code := regexp_replace(v_code, '^IMPA\s*[:.#]?\s*', '');
  IF v_code ~ '^[0-9][0-9 .-]*[0-9]$'
     AND length(regexp_replace(v_code, '[^0-9]', '', 'g')) = 6 THEN
    RETURN regexp_replace(v_code, '[^0-9]', '', 'g');
  END IF;
  -- Anything else is kept as typed, so a CHECK refuses it.
  RETURN v_raw;
END;
$function$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_impa_split(p_name text, p_code text, p_move boolean DEFAULT true, OUT name text, OUT code text)
 RETURNS record
 LANGUAGE plpgsql
 IMMUTABLE
AS $function$
DECLARE
  v_mark  constant text := chr(1);
  v_after constant text := '(?![0-9A-Za-z])(?![-/.][0-9A-Za-z])';
  v_found text[];
  v_text  text;
  v_line  text;
  v_lines text[] := '{}';
BEGIN
  name := p_name;
  code := fn_impa_code(p_code);
  IF p_name IS NULL THEN
    RETURN;
  END IF;
  -- Only a code marked IMPA moves: bare digits may be a model number.
  IF code IS NULL AND p_move THEN
    SELECT array_agg(DISTINCT m[1]) INTO v_found
      FROM regexp_matches(p_name, '\mIMPA\s*[:.#]?\s*([0-9]{6})' || v_after, 'gi') m;
    IF cardinality(v_found) = 1 THEN
      code := v_found[1];
    END IF;
  END IF;
  IF code IS NULL OR code !~ '^[0-9]{6}$' THEN
    RETURN;
  END IF;

  -- The own code, bracketed, marked or bare, never inside a longer token.
  v_text := regexp_replace(p_name, '\(\s*(IMPA\s*[:.#]?\s*)?' || code || '\s*\)', v_mark, 'gi');
  v_text := regexp_replace(v_text, '\mIMPA\s*[:.#]?\s*' || code || v_after, v_mark, 'gi');
  v_text := regexp_replace(v_text,
    '(?<![0-9A-Za-z])(?<![0-9A-Za-z][-/.])' || code || v_after, v_mark, 'g');
  IF strpos(v_text, v_mark) = 0 THEN
    RETURN;
  END IF;

  -- Only the lines that held the code are tidied.
  FOREACH v_line IN ARRAY string_to_array(v_text, E'\n') LOOP
    IF strpos(v_line, v_mark) > 0 THEN
      v_line := regexp_replace(v_line, '[ \t]*-[ \t]*' || v_mark || '[ \t]*-[ \t]*', ' - ', 'g');
      v_line := regexp_replace(v_line, '[ \t]*,[ \t]*' || v_mark || '[ \t]*,[ \t]*', ', ', 'g');
      v_line := regexp_replace(v_line, '[ \t]+-[ \t]+' || v_mark, v_mark, 'g');
      v_line := regexp_replace(v_line, v_mark || '[ \t]+-[ \t]+', v_mark, 'g');
      v_line := regexp_replace(v_line, '[ \t]*' || v_mark || '[ \t]*', ' ', 'g');
      v_line := regexp_replace(v_line, '[ \t]{2,}', ' ', 'g');
      v_line := regexp_replace(v_line, '^[ \t\r,:]+|[ \t\r,:]+$', '', 'g');
      CONTINUE WHEN v_line = '';
    END IF;
    v_lines := v_lines || v_line;
  END LOOP;
  v_text := array_to_string(v_lines, E'\n');
  -- A text that was only the code keeps it.
  IF btrim(v_text, E' \t\r\n') <> '' THEN
    name := v_text;
  END IF;
END;
$function$;
-- +goose StatementEnd

-- +goose StatementBegin
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
$function$;
-- +goose StatementEnd

-- Clean the stored rows. The backfill is no edit, so versions and
-- timestamps stay, the learning cache learns nothing and a filed
-- quotation's requests may change.
ALTER TABLE items DISABLE TRIGGER trg_items_updated_at;
-- A code moves from a name only to a code no other active product holds
-- or claims.
UPDATE items i
   SET name = x.name, impa_code = x.code
  FROM (
    SELECT i2.id, s.name, s.code,
           count(*) FILTER (WHERE i2.is_active) OVER (PARTITION BY s.code) AS claims
      FROM items i2
     CROSS JOIN LATERAL fn_impa_split(i2.name, i2.impa_code) s
  ) x
 WHERE x.id = i.id
   AND (x.name, x.code) IS DISTINCT FROM (i.name::text, i.impa_code::text)
   AND (x.code IS NULL OR x.code IS NOT DISTINCT FROM i.impa_code OR NOT i.is_active OR x.claims = 1);
ALTER TABLE items ENABLE TRIGGER trg_items_updated_at;

ALTER TABLE quotation_items DISABLE TRIGGER trg_quotation_items_updated_at;
ALTER TABLE quotation_items DISABLE TRIGGER trg_learn_match_on_update;
UPDATE quotation_items qi
   SET requested_name = r.name, requested_impa = r.code,
       offered_name = o.name, offered_impa = o.code
  FROM quotation_items q2
 CROSS JOIN LATERAL fn_impa_split(q2.requested_name, q2.requested_impa) r
 CROSS JOIN LATERAL fn_impa_split(q2.offered_name, q2.offered_impa, false) o
 WHERE q2.id = qi.id
   AND (r.name, r.code, o.name, o.code) IS DISTINCT FROM
       (qi.requested_name::text, qi.requested_impa::text, qi.offered_name::text, qi.offered_impa::text);
ALTER TABLE quotation_items ENABLE TRIGGER trg_learn_match_on_update;
ALTER TABLE quotation_items ENABLE TRIGGER trg_quotation_items_updated_at;

ALTER TABLE quotation_item_requests DISABLE TRIGGER trg_qir_updated_at;
ALTER TABLE quotation_item_requests DISABLE TRIGGER trg_qir_lock_parent;
UPDATE quotation_item_requests q
   SET request_text = s.name, request_impa = s.code
  FROM quotation_item_requests q2
 CROSS JOIN LATERAL fn_impa_split(q2.request_text, q2.request_impa) s
 WHERE q2.id = q.id
   AND (s.name, s.code) IS DISTINCT FROM (q.request_text, q.request_impa::text);
ALTER TABLE quotation_item_requests ENABLE TRIGGER trg_qir_lock_parent;
ALTER TABLE quotation_item_requests ENABLE TRIGGER trg_qir_updated_at;

ALTER TABLE purchase_order_items DISABLE TRIGGER trg_purchase_order_items_updated_at;
UPDATE purchase_order_items p
   SET item_name = s.name, item_code = s.code
  FROM purchase_order_items p2
 CROSS JOIN LATERAL fn_impa_split(p2.item_name, p2.item_code, false) s
 WHERE p2.id = p.id
   AND (s.name, s.code) IS DISTINCT FROM (p.item_name::text, p.item_code::text);
ALTER TABLE purchase_order_items ENABLE TRIGGER trg_purchase_order_items_updated_at;

-- Six digits or none. Each check guards every new write at once and is
-- validated when no stored row breaks it. A row that does keeps its code,
-- named in a notice, until someone corrects it, since a filed document's
-- code is history and the catalog's is the owner's call.
ALTER TABLE items
  ADD CONSTRAINT ck_items_impa_code CHECK (impa_code ~ '^[0-9]{6}$') NOT VALID;
ALTER TABLE quotation_items
  ADD CONSTRAINT ck_quotation_items_requested_impa CHECK (requested_impa ~ '^[0-9]{6}$') NOT VALID,
  ADD CONSTRAINT ck_quotation_items_offered_impa CHECK (offered_impa ~ '^[0-9]{6}$') NOT VALID;
ALTER TABLE quotation_item_requests
  ADD CONSTRAINT ck_qir_request_impa CHECK (request_impa ~ '^[0-9]{6}$') NOT VALID;
ALTER TABLE purchase_order_items
  ADD CONSTRAINT ck_purchase_order_items_item_code CHECK (item_code ~ '^[0-9]{6}$') NOT VALID;

-- +goose StatementBegin
DO $$
DECLARE
  r record;
  n bigint;
BEGIN
  FOR r IN
    SELECT * FROM (VALUES
      ('items', 'impa_code', 'ck_items_impa_code'),
      ('quotation_items', 'requested_impa', 'ck_quotation_items_requested_impa'),
      ('quotation_items', 'offered_impa', 'ck_quotation_items_offered_impa'),
      ('quotation_item_requests', 'request_impa', 'ck_qir_request_impa'),
      ('purchase_order_items', 'item_code', 'ck_purchase_order_items_item_code')
    ) v(tbl, col, con)
  LOOP
    EXECUTE format('SELECT count(*) FROM %I WHERE %I !~ %L', r.tbl, r.col, '^[0-9]{6}$') INTO n;
    IF n = 0 THEN
      EXECUTE format('ALTER TABLE %I VALIDATE CONSTRAINT %I', r.tbl, r.con);
    ELSE
      RAISE NOTICE '% rows of %.% keep a code that is not six digits, so % checks new writes only.',
        n, r.tbl, r.col, r.con;
    END IF;
  END LOOP;
END;
$$;
-- +goose StatementEnd

-- One function on every write.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.trg_fn_items_impa()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_code text := fn_impa_code(NEW.impa_code);
  s      record;
BEGIN
  s := fn_impa_split(NEW.name, v_code);
  -- A code named in the text moves only to a code no other active
  -- product holds.
  IF v_code IS NULL AND s.code IS NOT NULL AND EXISTS (
       SELECT 1 FROM items i
        WHERE i.impa_code = s.code AND i.is_active AND i.id IS DISTINCT FROM NEW.id) THEN
    NEW.impa_code := NULL;
    RETURN NEW;
  END IF;
  NEW.name := s.name;
  NEW.impa_code := s.code;
  RETURN NEW;
END;
$function$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.trg_fn_quotation_items_impa()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  s record;
BEGIN
  s := fn_impa_split(NEW.requested_name, NEW.requested_impa);
  NEW.requested_name := s.name;
  NEW.requested_impa := s.code;
  -- The offer copies the catalog, so it never takes a code from its name.
  s := fn_impa_split(NEW.offered_name, NEW.offered_impa, false);
  NEW.offered_name := s.name;
  NEW.offered_impa := s.code;
  RETURN NEW;
END;
$function$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.trg_fn_qir_impa()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  s record;
BEGIN
  s := fn_impa_split(NEW.request_text, NEW.request_impa);
  NEW.request_text := s.name;
  NEW.request_impa := s.code;
  RETURN NEW;
END;
$function$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.trg_fn_po_items_impa()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
DECLARE
  s record;
BEGIN
  -- A PO line copies its quotation's offer.
  s := fn_impa_split(NEW.item_name, NEW.item_code, false);
  NEW.item_name := s.name;
  NEW.item_code := s.code;
  RETURN NEW;
END;
$function$;
-- +goose StatementEnd

CREATE TRIGGER trg_items_impa
  BEFORE INSERT OR UPDATE OF name, impa_code ON items
  FOR EACH ROW EXECUTE FUNCTION trg_fn_items_impa();
CREATE TRIGGER trg_quotation_items_impa
  BEFORE INSERT OR UPDATE OF requested_name, requested_impa, offered_name, offered_impa ON quotation_items
  FOR EACH ROW EXECUTE FUNCTION trg_fn_quotation_items_impa();
CREATE TRIGGER trg_qir_impa
  BEFORE INSERT OR UPDATE OF request_text, request_impa ON quotation_item_requests
  FOR EACH ROW EXECUTE FUNCTION trg_fn_qir_impa();
CREATE TRIGGER trg_purchase_order_items_impa
  BEFORE INSERT OR UPDATE OF item_name, item_code ON purchase_order_items
  FOR EACH ROW EXECUTE FUNCTION trg_fn_po_items_impa();

-- +goose Down
-- Lossy: the codes and marks the Up took out of names and request texts,
-- and the codes it moved out of them, are not put back. Codes stay in their
-- six digit form. Search matches codes by similarity again.
DROP TRIGGER IF EXISTS trg_purchase_order_items_impa ON purchase_order_items;
DROP TRIGGER IF EXISTS trg_qir_impa ON quotation_item_requests;
DROP TRIGGER IF EXISTS trg_quotation_items_impa ON quotation_items;
DROP TRIGGER IF EXISTS trg_items_impa ON items;
DROP FUNCTION IF EXISTS public.trg_fn_po_items_impa();
DROP FUNCTION IF EXISTS public.trg_fn_qir_impa();
DROP FUNCTION IF EXISTS public.trg_fn_quotation_items_impa();
DROP FUNCTION IF EXISTS public.trg_fn_items_impa();

ALTER TABLE purchase_order_items DROP CONSTRAINT IF EXISTS ck_purchase_order_items_item_code;
ALTER TABLE quotation_item_requests DROP CONSTRAINT IF EXISTS ck_qir_request_impa;
ALTER TABLE quotation_items
  DROP CONSTRAINT IF EXISTS ck_quotation_items_offered_impa,
  DROP CONSTRAINT IF EXISTS ck_quotation_items_requested_impa;
ALTER TABLE items DROP CONSTRAINT IF EXISTS ck_items_impa_code;

-- +goose StatementBegin
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
    WHERE (p_is_active IS NULL OR i.is_active = p_is_active)
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

DROP FUNCTION IF EXISTS public.fn_impa_split(text, text, boolean);
DROP FUNCTION IF EXISTS public.fn_impa_code(text);
