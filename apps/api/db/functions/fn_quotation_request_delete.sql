-- Canonical current body of fn_quotation_request_delete (deployed by migration 00090).
CREATE OR REPLACE FUNCTION public.fn_quotation_request_delete(p_quotation_id bigint, p_id bigint, p_user_id bigint)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_line RECORD;
BEGIN
  PERFORM fn_quotation_lock_draft(p_quotation_id);
  IF NOT EXISTS (
    SELECT 1 FROM quotation_item_requests WHERE id = p_id AND quotation_id = p_quotation_id
  ) THEN
    RAISE EXCEPTION 'Permintaan tidak ditemukan di quotation ini. Muat ulang halaman.'
      USING ERRCODE = 'P0011';
  END IF;

  -- The delete clears request_id on these lines; none may be held.
  FOR v_line IN
    SELECT id, quotation_id FROM quotation_items WHERE request_id = p_id
  LOOP
    PERFORM fn_quotation_part_free(v_line.quotation_id, 'line:' || v_line.id, p_user_id);
  END LOOP;

  DELETE FROM quotation_item_requests WHERE id = p_id;

  PERFORM fn_quotation_notify(p_quotation_id, 'requests', NULL, p_user_id);
END;
$function$
