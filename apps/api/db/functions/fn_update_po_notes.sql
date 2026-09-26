-- Canonical current body of fn_update_po_notes (deployed by migration 00053).
CREATE OR REPLACE FUNCTION public.fn_update_po_notes(p_po_id bigint, p_if_match integer, p_notes text, p_user_id bigint)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_current INT;
  v_new     INT;
BEGIN
  SELECT row_version INTO v_current
  FROM purchase_orders
  WHERE id = p_po_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Purchase order % not found', p_po_id
      USING ERRCODE = 'P0011';
  END IF;

  IF p_if_match IS NOT NULL AND v_current <> p_if_match THEN
    RAISE EXCEPTION 'row_version mismatch (expected %, got %)', v_current, p_if_match
      USING ERRCODE = 'P0010';
  END IF;

  UPDATE purchase_orders
  SET notes      = p_notes,
      updated_by = p_user_id
  WHERE id = p_po_id
  RETURNING row_version INTO v_new;

  RETURN v_new;
END;
$function$
