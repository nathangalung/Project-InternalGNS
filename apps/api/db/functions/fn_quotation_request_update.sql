-- Canonical current body of fn_quotation_request_update (deployed by migration 00090).
CREATE OR REPLACE FUNCTION public.fn_quotation_request_update(p_quotation_id bigint, p_id bigint, p_if_match integer, p_line_no integer, p_request_text text, p_request_impa text, p_requested_qty numeric, p_requested_uom text, p_matched_item_id bigint, p_match_status text, p_source_type text, p_source_ref text, p_notes text, p_user_id bigint)
 RETURNS quotation_item_requests
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_version INT;
  v_row     quotation_item_requests;
BEGIN
  PERFORM fn_quotation_lock_draft(p_quotation_id);

  SELECT row_version INTO v_version
  FROM quotation_item_requests
  WHERE id = p_id AND quotation_id = p_quotation_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Permintaan tidak ditemukan di quotation ini. Muat ulang halaman.'
      USING ERRCODE = 'P0011';
  END IF;
  -- Lines keep their own copy of the request text, so a save touches no
  -- line and needs no claim; the version stops a stale overwrite.
  IF v_version <> p_if_match THEN
    RAISE EXCEPTION 'Permintaan ini sudah diubah pengguna lain. Muat ulang halaman.'
      USING ERRCODE = 'P0010';
  END IF;

  UPDATE quotation_item_requests SET
    line_no         = p_line_no,
    request_text    = p_request_text,
    request_impa    = p_request_impa,
    requested_qty   = p_requested_qty,
    requested_uom   = p_requested_uom,
    matched_item_id = p_matched_item_id,
    match_status    = p_match_status,
    source_type     = p_source_type,
    source_ref      = p_source_ref,
    notes           = p_notes,
    reviewed_by     = CASE
      WHEN p_match_status <> 'pending' AND reviewed_by IS NULL THEN p_user_id
      ELSE reviewed_by
    END,
    reviewed_at     = CASE
      WHEN p_match_status <> 'pending' AND reviewed_at IS NULL THEN NOW()
      ELSE reviewed_at
    END,
    updated_by      = p_user_id,
    row_version     = row_version + 1
  WHERE id = p_id
  RETURNING * INTO v_row;

  PERFORM fn_quotation_notify(p_quotation_id, 'requests', NULL, p_user_id);
  RETURN v_row;
END;
$function$
