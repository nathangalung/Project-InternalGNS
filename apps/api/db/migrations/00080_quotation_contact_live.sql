-- +goose Up

-- 00080 QUOTATION CONTACT LIVE
-- The contact (narahubung) of a draft is part of its header. Changing it
-- follows the live-edit contract of migration 00078: the quotation row is
-- taken FOR UPDATE first, so the status is read after any concurrent move
-- commits; another user's header claim refuses the change (P0015); and the
-- change is announced on quotation_events. An accepted quotation still takes
-- a new contact for the PO gate, outside live editing.
--
-- Returns 'ok', 'not_found', 'status_locked' or 'contact_invalid', the
-- outcomes the former quotations.update_contact statement reported.

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION fn_quotation_update_contact(p_quotation_id BIGINT, p_contact_id BIGINT, p_user_id BIGINT)
RETURNS TEXT
LANGUAGE plpgsql
AS $$
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
$$;
-- +goose StatementEnd

-- +goose Down

DROP FUNCTION IF EXISTS fn_quotation_update_contact(BIGINT, BIGINT, BIGINT);
