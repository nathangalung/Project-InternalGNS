-- Canonical current body of fn_next_doc_no (deployed by migration 00098).
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
$function$
