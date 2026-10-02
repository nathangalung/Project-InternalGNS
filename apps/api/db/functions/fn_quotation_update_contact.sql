-- Canonical current body of fn_quotation_update_contact (deployed by migration 00083).
CREATE OR REPLACE FUNCTION public.fn_quotation_update_contact(p_quotation_id bigint, p_contact_id bigint, p_user_id bigint)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_status  VARCHAR(20);
  v_company BIGINT;
  v_name    TEXT;
BEGIN
  SELECT status, company_client_id INTO v_status, v_company
  FROM quotations WHERE id = p_quotation_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN 'not_found';
  END IF;
  IF v_status NOT IN ('draft', 'accepted') THEN
    RETURN 'status_locked';
  END IF;
  IF v_status = 'draft' THEN
    PERFORM fn_quotation_part_free(p_quotation_id, 'header', p_user_id);
  END IF;

  SELECT name INTO v_name FROM company_contacts
  WHERE id = p_contact_id AND company_id = v_company AND is_active;
  IF NOT FOUND THEN
    RETURN 'contact_invalid';
  END IF;

  UPDATE quotations
  SET contact_id = p_contact_id, contact_name = v_name, updated_by = p_user_id, updated_at = NOW()
  WHERE id = p_quotation_id;

  IF v_status = 'draft' THEN
    PERFORM fn_quotation_notify(p_quotation_id, 'header', 'header', p_user_id);
  END IF;
  RETURN 'ok';
END;
$function$
