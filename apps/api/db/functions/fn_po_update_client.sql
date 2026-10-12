-- Canonical current body of fn_po_update_client (deployed by migration 00116).
CREATE OR REPLACE FUNCTION public.fn_po_update_client(p_po_id bigint, p_if_match integer, p_client_id bigint, p_contact_id bigint, p_user_id bigint)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_current      INT;
  v_status       VARCHAR(20);
  v_old_client   BIGINT;
  v_old_contact  BIGINT;
  v_old_name     TEXT;
  v_name         TEXT;
  v_contact_name TEXT;
  v_note         TEXT;
  v_new          INT;
BEGIN
  SELECT row_version, status, company_client_id, contact_id
    INTO v_current, v_status, v_old_client, v_old_contact
  FROM purchase_orders
  WHERE id = p_po_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'PO tidak ditemukan. Muat ulang halaman.'
      USING ERRCODE = 'P0011';
  END IF;

  IF p_if_match IS NOT NULL AND v_current <> p_if_match THEN
    RAISE EXCEPTION 'Data ini baru saja diubah pengguna lain. Muat ulang lalu coba lagi.'
      USING ERRCODE = 'P0010';
  END IF;

  -- The invoice copied the buyer at delivery.
  IF v_status IN ('DELIVERED', 'CANCELLED') THEN
    RAISE EXCEPTION 'Klien PO yang sudah Dikirim atau Dibatalkan tidak dapat diganti.'
      USING ERRCODE = 'P0013';
  END IF;
  IF EXISTS (SELECT 1 FROM invoices WHERE po_id = p_po_id AND status <> 'cancelled') THEN
    RAISE EXCEPTION 'Klien PO ini tidak dapat diganti karena invoicenya sudah terbit.'
      USING ERRCODE = 'P0013';
  END IF;

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

  IF p_client_id = v_old_client AND p_contact_id IS NOT DISTINCT FROM v_old_contact THEN
    RETURN v_current;
  END IF;

  IF p_client_id <> v_old_client THEN
    SELECT name INTO v_old_name FROM company_client WHERE id = v_old_client;
    v_note := 'Klien diganti dari ' || v_old_name || ' menjadi ' || v_name;
  ELSIF v_contact_name IS NULL THEN
    v_note := 'Narahubung dikosongkan';
  ELSE
    v_note := 'Narahubung diganti menjadi ' || v_contact_name;
  END IF;

  UPDATE purchase_orders
  SET company_client_id = p_client_id,
      contact_id        = p_contact_id,
      updated_by        = p_user_id
  WHERE id = p_po_id
  RETURNING row_version INTO v_new;

  INSERT INTO po_status_history (po_id, from_status, to_status, note, changed_by)
  VALUES (p_po_id, v_status, v_status, v_note, p_user_id);

  RETURN v_new;
END;
$function$
