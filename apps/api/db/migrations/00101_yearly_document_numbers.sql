-- +goose Up
-- 00101 YEARLY DOCUMENT NUMBERS
-- Quotation, invoice and delivery-note numbers restart at 00001 every
-- year. The running number is per document type and per year of the WIB
-- date the number prints, so Q-00001/GNS/I/2027 follows
-- Q-00412/GNS/XII/2026. doc_counters is keyed by (doc_type, year), and
-- fn_next_doc_no takes the row of CURRENT_DATE's year under its row lock,
-- creating it with the year's first number: callers still queue, and a
-- rollback still leaves no gap. The signature is unchanged, so
-- fn_create_quotation still draws the number before any other row lock,
-- and fn_create_invoice and fn_change_po_status are untouched.
--
-- Every number issued in the 00098 format is renumbered within the year it
-- prints, in the order of its old running number, keeping its Roman month
-- and year; a revision keeps its base number and its Rev.n. A note or a
-- status-history note that copies a renumbered number follows it. Older
-- format numbers, legacy_no, legacy_dn_no and a number in a note that no
-- document carries stay as they are.

-- Old number to new.
-- Base numbers only: a revision shares its base's row.
CREATE TEMP TABLE doc_renumber (
  old_no TEXT PRIMARY KEY,
  new_no TEXT NOT NULL
);

INSERT INTO doc_renumber (old_no, new_no)
SELECT old_no,
       doc_type || '-' || lpad(n::TEXT, GREATEST(5, length(n::TEXT)), '0')
       || '/GNS/' || roman || '/' || year
FROM (
  SELECT d.doc_type, d.old_no, m[2] AS roman, m[3] AS year,
         row_number() OVER (PARTITION BY d.doc_type, m[3] ORDER BY m[1]::INTEGER, d.old_no) AS n
  FROM (
    SELECT 'Q' AS doc_type, regexp_replace(quotation_no, ' Rev\.[0-9]+$', '') AS old_no
    FROM quotations
    UNION
    SELECT 'INV', invoice_no FROM invoices
    UNION
    SELECT 'DN', delivery_note_number FROM purchase_orders
    WHERE delivery_note_number IS NOT NULL
  ) d
  CROSS JOIN LATERAL
    regexp_match(d.old_no, '^' || d.doc_type || '-([0-9]{5,6})/GNS/([IVX]+)/([0-9]{4})$') AS m
  WHERE m IS NOT NULL
) x;

-- Copied numbers follow.
-- A token counts only as a whole number some document carries, so
-- XQ-00001/... and the six-digit legacy numbers the import noted stay.
-- +goose StatementBegin
CREATE OR REPLACE FUNCTION pg_temp.renumbered(p_text TEXT)
 RETURNS TEXT
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_re    CONSTANT TEXT := '(?<![A-Za-z0-9])(?:Q|INV|DN)-[0-9]+/GNS/[IVX]+/[0-9]{4}(?![0-9])';
  v_parts TEXT[];
  v_out   TEXT;
  v_tok   TEXT;
  v_new   TEXT;
  v_i     INTEGER := 1;
BEGIN
  IF p_text IS NULL OR p_text !~ v_re THEN
    RETURN p_text;
  END IF;
  v_parts := regexp_split_to_array(p_text, v_re);
  v_out := v_parts[1];
  FOR v_tok IN
    SELECT r.m[1] FROM regexp_matches(p_text, '(' || v_re || ')', 'g') WITH ORDINALITY AS r (m, n)
    ORDER BY r.n
  LOOP
    v_i := v_i + 1;
    SELECT new_no INTO v_new FROM doc_renumber WHERE old_no = v_tok;
    v_out := v_out || COALESCE(v_new, v_tok) || v_parts[v_i];
  END LOOP;
  RETURN v_out;
END;
$function$;
-- +goose StatementEnd

-- Keep row_version and updated_at.
-- No open edit goes stale.
ALTER TABLE quotations DISABLE TRIGGER trg_quotations_updated_at;
ALTER TABLE invoices DISABLE TRIGGER trg_invoices_updated_at;
ALTER TABLE purchase_orders DISABLE TRIGGER trg_purchase_orders_updated_at;

-- Two phases under unique keys.
-- A changing number is first marked with #, then rewritten, so no
-- intermediate row takes a number another row still holds.
UPDATE quotations q SET quotation_no = '#' || q.quotation_no
FROM doc_renumber r
WHERE r.old_no = regexp_replace(q.quotation_no, ' Rev\.[0-9]+$', '') AND r.new_no <> r.old_no;
UPDATE quotations q SET quotation_no = r.new_no || substr(q.quotation_no, length(r.old_no) + 2)
FROM doc_renumber r
WHERE q.quotation_no LIKE '#%'
  AND r.old_no = regexp_replace(substr(q.quotation_no, 2), ' Rev\.[0-9]+$', '');

UPDATE invoices i SET invoice_no = '#' || i.invoice_no
FROM doc_renumber r
WHERE r.old_no = i.invoice_no AND r.new_no <> r.old_no;
UPDATE invoices i SET invoice_no = r.new_no
FROM doc_renumber r
WHERE i.invoice_no LIKE '#%' AND r.old_no = substr(i.invoice_no, 2);

UPDATE purchase_orders p SET delivery_note_number = '#' || p.delivery_note_number
FROM doc_renumber r
WHERE r.old_no = p.delivery_note_number AND r.new_no <> r.old_no;
UPDATE purchase_orders p SET delivery_note_number = r.new_no
FROM doc_renumber r
WHERE p.delivery_note_number LIKE '#%' AND r.old_no = substr(p.delivery_note_number, 2);

UPDATE quotations SET notes = pg_temp.renumbered(notes)
WHERE notes IS DISTINCT FROM pg_temp.renumbered(notes);
UPDATE purchase_orders SET notes = pg_temp.renumbered(notes)
WHERE notes IS DISTINCT FROM pg_temp.renumbered(notes);
UPDATE quotation_status_history SET note = pg_temp.renumbered(note)
WHERE note IS DISTINCT FROM pg_temp.renumbered(note);
UPDATE po_status_history SET note = pg_temp.renumbered(note)
WHERE note IS DISTINCT FROM pg_temp.renumbered(note);
UPDATE invoice_status_history SET note = pg_temp.renumbered(note)
WHERE note IS DISTINCT FROM pg_temp.renumbered(note);

ALTER TABLE quotations ENABLE TRIGGER trg_quotations_updated_at;
ALTER TABLE invoices ENABLE TRIGGER trg_invoices_updated_at;
ALTER TABLE purchase_orders ENABLE TRIGGER trg_purchase_orders_updated_at;

DROP FUNCTION pg_temp.renumbered(TEXT);
DROP TABLE doc_renumber;

-- Yearly counters.
DROP TABLE doc_counters;
CREATE TABLE doc_counters (
  doc_type   VARCHAR(3)  NOT NULL CHECK (doc_type IN ('Q', 'INV', 'DN')),
  year       INTEGER     NOT NULL CHECK (year BETWEEN 1000 AND 9999),
  last_seq   INTEGER     NOT NULL CHECK (last_seq >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (doc_type, year)
);

COMMENT ON TABLE doc_counters IS
  'Last running number per document type (Q, INV, DN) and year; fn_next_doc_no takes the next one of the current WIB year under the row lock.';

-- Resume after each year's highest.
INSERT INTO doc_counters (doc_type, year, last_seq)
SELECT m[1], m[3]::INTEGER, max(m[2]::INTEGER)
FROM (
  SELECT regexp_match(no, '^(Q|INV|DN)-([0-9]{5,6})/GNS/[IVX]+/([0-9]{4})( Rev\.[0-9]+)?$') AS m
  FROM (
    SELECT quotation_no AS no FROM quotations
    UNION ALL SELECT invoice_no FROM invoices
    UNION ALL SELECT delivery_note_number FROM purchase_orders
  ) a
) b
WHERE m IS NOT NULL
GROUP BY 1, 2;

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_next_doc_no(p_doc_type character varying)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_year INTEGER := EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER;
  v_seq  INTEGER;
BEGIN
  IF p_doc_type IS NULL OR p_doc_type NOT IN ('Q', 'INV', 'DN') THEN
    RAISE EXCEPTION 'unknown document type %', p_doc_type
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- The row lock serialises callers; a rollback returns the number.
  -- The year's first caller creates the row, and a concurrent second
  -- waits on that insert, then takes the next number or, after a
  -- rollback, the first.
  INSERT INTO doc_counters AS c (doc_type, year, last_seq)
  VALUES (p_doc_type, v_year, 1)
  ON CONFLICT (doc_type, year) DO UPDATE
    SET last_seq   = c.last_seq + 1,
        updated_at = NOW()
  RETURNING c.last_seq INTO v_seq;

  -- Pad to five digits; lpad alone would cut a sixth.
  RETURN p_doc_type || '-'
      || lpad(v_seq::TEXT, GREATEST(5, length(v_seq::TEXT)), '0')
      || '/GNS/' || fn_month_to_roman(EXTRACT(MONTH FROM CURRENT_DATE)::INTEGER)
      || '/' || v_year;
END;
$function$;
-- +goose StatementEnd

COMMENT ON FUNCTION fn_next_doc_no(character varying) IS
  'Next number for Q, INV or DN: {type}-{five or more digits}/GNS/{Roman month}/{YYYY} of the WIB date, from the doc_counters row of that type and year.';

-- +goose Down

-- Back to one counter.
-- It resumes above every number of every year and every yearly counter,
-- so the next number cannot repeat one already issued. The numbers keep
-- their yearly values; the documented production rollback restores a
-- snapshot instead (docs/deploy_vps.md).
CREATE TEMP TABLE doc_counters_down AS
SELECT t.doc_type, GREATEST(COALESCE(c.hi, 0), COALESCE(n.hi, 0)) AS last_seq
FROM (VALUES ('Q'), ('INV'), ('DN')) AS t (doc_type)
LEFT JOIN (
  SELECT doc_type::TEXT AS doc_type, max(last_seq) AS hi FROM doc_counters GROUP BY 1
) c USING (doc_type)
LEFT JOIN (
  SELECT m[1] AS doc_type, max(m[2]::INTEGER) AS hi
  FROM (
    SELECT regexp_match(no, '^(Q|INV|DN)-([0-9]{5,6})/GNS/[IVX]+/[0-9]{4}') AS m
    FROM (
      SELECT quotation_no AS no FROM quotations
      UNION ALL SELECT invoice_no FROM invoices
      UNION ALL SELECT delivery_note_number FROM purchase_orders
    ) a
  ) b
  WHERE m IS NOT NULL
  GROUP BY 1
) n USING (doc_type);

DROP TABLE doc_counters;
CREATE TABLE doc_counters (
  doc_type   VARCHAR(3)  PRIMARY KEY CHECK (doc_type IN ('Q', 'INV', 'DN')),
  last_seq   INTEGER     NOT NULL CHECK (last_seq >= 0),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

COMMENT ON TABLE doc_counters IS
  'Last running number per document type (Q, INV, DN); fn_next_doc_no takes the next one under the row lock.';

INSERT INTO doc_counters (doc_type, last_seq)
SELECT doc_type, last_seq FROM doc_counters_down;
DROP TABLE doc_counters_down;

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_next_doc_no(p_doc_type character varying)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_seq INTEGER;
BEGIN
  -- The row lock serialises callers; a rollback returns the number.
  UPDATE doc_counters
     SET last_seq   = last_seq + 1,
         updated_at = NOW()
   WHERE doc_type = p_doc_type
  RETURNING last_seq INTO v_seq;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'unknown document type %', p_doc_type
      USING ERRCODE = 'invalid_parameter_value';
  END IF;

  -- Pad to five digits; lpad alone would cut a sixth.
  RETURN p_doc_type || '-'
      || lpad(v_seq::TEXT, GREATEST(5, length(v_seq::TEXT)), '0')
      || '/GNS/' || fn_month_to_roman(EXTRACT(MONTH FROM CURRENT_DATE)::INTEGER)
      || '/' || EXTRACT(YEAR FROM CURRENT_DATE)::INTEGER;
END;
$function$;
-- +goose StatementEnd

COMMENT ON FUNCTION fn_next_doc_no(character varying) IS
  'Next number for Q, INV or DN: {type}-{five or more digits}/GNS/{Roman month}/{YYYY} of the WIB date, from doc_counters.';
