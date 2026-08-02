-- Canonical current body of fn_next_doc_no (deployed by migration 00007).
CREATE OR REPLACE FUNCTION public.fn_next_doc_no(p_doc_type character varying, p_company_id bigint)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
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
$function$
