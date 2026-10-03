-- Canonical current body of fn_quotation_request_add (deployed by migration 00090).
CREATE OR REPLACE FUNCTION public.fn_quotation_request_add(p_quotation_id bigint, p_line_no integer, p_request_text text, p_request_impa text, p_requested_qty numeric, p_requested_uom text, p_matched_item_id bigint, p_match_status text, p_source_type text, p_source_ref text, p_notes text, p_user_id bigint)
 RETURNS quotation_item_requests
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_row quotation_item_requests;
BEGIN
  PERFORM fn_quotation_lock_draft(p_quotation_id);

  INSERT INTO quotation_item_requests (
    quotation_id, line_no, request_text, request_impa,
    requested_qty, requested_uom,
    matched_item_id, match_status, source_type, source_ref, notes,
    created_by, updated_by
  ) VALUES (
    p_quotation_id, p_line_no, p_request_text, p_request_impa,
    p_requested_qty, p_requested_uom,
    p_matched_item_id, COALESCE(p_match_status, 'pending'), COALESCE(p_source_type, 'manual'),
    p_source_ref, p_notes,
    p_user_id, p_user_id
  )
  RETURNING * INTO v_row;

  PERFORM fn_quotation_notify(p_quotation_id, 'requests', NULL, p_user_id);
  RETURN v_row;
END;
$function$
