-- Canonical current body of fn_next_doc_no (deployed by migration 00101).
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
$function$
