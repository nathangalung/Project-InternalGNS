-- +goose Up
-- +goose StatementBegin

-- 00007 — DOC SEQUENCES (race-safe running number generator)
-- Sequence table per (doc_type, company_id, year). UPSERT atomic
-- via ON CONFLICT ensures no duplicate sequence under concurrency.
---- Format quotation/PO/invoice number:
-- {prefix}-{YY}{company_number}{seq}/GNS/{Roman month}/{YYYY}
---- Example: Q-26264101/GNS/IV/2026
-- prefix         = Q
-- YY             = 26 (year 2-digit)
-- company_number = 2641 (company_client.number)
-- seq            = 1 (running per company per year, no padding)
-- Roman          = IV (April)
-- YYYY           = 2026

CREATE TABLE doc_sequences (
  doc_type    VARCHAR(10) NOT NULL CHECK (doc_type IN ('Q','PO','INV','DN')),
  company_id  BIGINT NOT NULL REFERENCES company_client(id) ON DELETE RESTRICT,
  year        INT    NOT NULL,
  last_seq    INT    NOT NULL DEFAULT 0,
  updated_at  TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  PRIMARY KEY (doc_type, company_id, year)
);

COMMENT ON TABLE doc_sequences IS
  'Running sequence per (doc_type, company, year). UPSERT atomic via fn_next_doc_no for race-safe number generation.';

-- +goose StatementEnd


-- +goose StatementBegin
-- Helper: convert month INT (1-12) → Roman numeral
CREATE FUNCTION fn_month_to_roman(p_month INT) RETURNS TEXT AS $$
  SELECT CASE p_month
    WHEN 1  THEN 'I'    WHEN 2  THEN 'II'   WHEN 3  THEN 'III'
    WHEN 4  THEN 'IV'   WHEN 5  THEN 'V'    WHEN 6  THEN 'VI'
    WHEN 7  THEN 'VII'  WHEN 8  THEN 'VIII' WHEN 9  THEN 'IX'
    WHEN 10 THEN 'X'    WHEN 11 THEN 'XI'   WHEN 12 THEN 'XII'
  END;
$$ LANGUAGE SQL IMMUTABLE;
-- +goose StatementEnd


-- +goose StatementBegin
-- Atomic next sequence + format full doc_no
CREATE FUNCTION fn_next_doc_no(
  p_doc_type   VARCHAR(10),
  p_company_id BIGINT
) RETURNS TEXT AS $$
DECLARE
  v_seq            INT;
  v_company_no     VARCHAR(10);
  v_year           INT := EXTRACT(YEAR FROM NOW());
  v_yy             VARCHAR(2);
  v_month          INT := EXTRACT(MONTH FROM NOW());
BEGIN
  -- Get company number for formatting
  SELECT number INTO v_company_no
  FROM company_client WHERE id = p_company_id;

  IF v_company_no IS NULL OR v_company_no = '' THEN
    RAISE EXCEPTION 'Company % does not have number set — required for doc_no generation', p_company_id;
  END IF;

  -- UPSERT atomic: increment seq or insert new row
  INSERT INTO doc_sequences (doc_type, company_id, year, last_seq, updated_at)
  VALUES (p_doc_type, p_company_id, v_year, 1, NOW())
  ON CONFLICT (doc_type, company_id, year)
  DO UPDATE SET
    last_seq   = doc_sequences.last_seq + 1,
    updated_at = NOW()
  RETURNING last_seq INTO v_seq;

  v_yy := TO_CHAR(NOW(), 'YY');

  RETURN p_doc_type || '-' || v_yy || v_company_no || v_seq::TEXT ||
         '/GNS/' || fn_month_to_roman(v_month) || '/' || v_year::TEXT;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd


-- +goose StatementBegin
COMMENT ON FUNCTION fn_next_doc_no(VARCHAR, BIGINT) IS
  'Atomic next doc number for Q/PO/INV/DN. Format: {prefix}-{YY}{company_no}{seq}/GNS/{Roman}/{YYYY}. Race-safe via UPSERT on doc_sequences.';
-- +goose StatementEnd


-- +goose Down
-- +goose StatementBegin
DROP FUNCTION IF EXISTS fn_next_doc_no(VARCHAR, BIGINT);
DROP FUNCTION IF EXISTS fn_month_to_roman(INT);
DROP TABLE    IF EXISTS doc_sequences;
-- +goose StatementEnd
