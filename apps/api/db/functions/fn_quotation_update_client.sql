-- Canonical current body of fn_quotation_update_client (deployed by migration 00116).
CREATE OR REPLACE FUNCTION public.fn_quotation_update_client(p_quotation_id bigint, p_client_id bigint, p_contact_id bigint, p_user_id bigint)
 RETURNS void
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_status       VARCHAR(20);
  v_old_client   BIGINT;
  v_old_name     TEXT;
  v_name         TEXT;
  v_contact_name TEXT;
BEGIN
  SELECT status, company_client_id, company_client_name
    INTO v_status, v_old_client, v_old_name
  FROM quotations WHERE id = p_quotation_id FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Quotation tidak ditemukan. Muat ulang halaman.' USING ERRCODE = 'P0011';
  END IF;
  -- A quotation past draft already reached the client.
  IF v_status <> 'draft' THEN
    RAISE EXCEPTION 'Klien hanya dapat diganti saat quotation berstatus Draf. Untuk quotation yang sudah dikirim, buat revisi lalu ganti kliennya di draf revisi.'
      USING ERRCODE = 'P0013';
  END IF;
  PERFORM fn_quotation_part_held(p_quotation_id, 'header', p_user_id);

  SELECT name INTO v_name FROM company_client
  WHERE id = p_client_id AND is_active
  FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Klien tidak ditemukan atau sudah nonaktif. Pilih klien lain.'
      USING ERRCODE = 'P0014', COLUMN = 'clientId';
  END IF;

  IF p_contact_id IS NOT NULL THEN
    SELECT name INTO v_contact_name FROM company_contacts
    WHERE id = p_contact_id AND company_id = p_client_id AND is_active;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Narahubung tidak ditemukan, sudah nonaktif, atau bukan milik klien ini.'
        USING ERRCODE = 'P0014', COLUMN = 'contactId';
    END IF;
  END IF;

  UPDATE quotations
  SET company_client_id   = p_client_id,
      company_client_name = v_name,
      contact_id          = p_contact_id,
      contact_name        = v_contact_name,
      updated_by          = p_user_id
  WHERE id = p_quotation_id;

  IF p_client_id <> v_old_client THEN
    INSERT INTO quotation_status_history (quotation_id, from_status, to_status, note, changed_by)
    VALUES (p_quotation_id, v_status, v_status,
            'Klien diganti dari ' || v_old_name || ' menjadi ' || v_name, p_user_id);
  END IF;

  PERFORM fn_quotation_notify(p_quotation_id, 'header', 'header', p_user_id);
END;
$function$
