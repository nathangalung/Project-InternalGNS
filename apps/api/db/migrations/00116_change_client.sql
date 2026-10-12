-- +goose Up
-- 00116 CHANGE CLIENT
-- A quotation or PO can move to another client, typically a company of the
-- same holding. A draft quotation changes in place; one past draft already
-- reached the client, so it changes through Buat Revisi. A PO changes until
-- it is delivered or cancelled, since the invoice copies its buyer at
-- delivery. The quotation keeps its own client.
--
-- The PO already stores its client and contact (company_client_id,
-- contact_id). Its gate, the invoice contact and the payment reminder read
-- the quotation's contact until now, which belongs to the old client once
-- the PO moves. They read the PO's contact from here on, so this first
-- copies the quotation's contact onto every PO still on the quotation's
-- client where the two drifted. What the pages and the gate show stays as
-- it was. The backfill keeps row_version, so no open PO edit goes stale.
-- A delivered PO also moves while its invoice is cancelled and no
-- Pengganti is issued, so the Pengganti bills the right company.
ALTER TABLE purchase_orders DISABLE TRIGGER trg_purchase_orders_updated_at;

UPDATE purchase_orders po
SET contact_id = q.contact_id
FROM quotations q
WHERE q.id = po.quotation_id
  AND po.company_client_id = q.company_client_id
  AND po.contact_id IS DISTINCT FROM q.contact_id;

ALTER TABLE purchase_orders ENABLE TRIGGER trg_purchase_orders_updated_at;

-- A draft's client, with the header claim.
-- The contact belongs to a client, so it is replaced along with it (none
-- when p_contact_id is NULL). The client's reference stays: it is free text
-- the user can still change in the summary step. Lines and prices stay.
-- +goose StatementBegin
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
$function$;
-- +goose StatementEnd

-- A PO's client and contact.
-- Refused once the PO is cancelled, delivered (unless its invoice is
-- cancelled and nothing replaces it yet, as fn_po_lines_locked says), or
-- while it has a live invoice. The PO number must be free under the new client, which the
-- unique index enforces. Each change is a row in the PO's history. Returns
-- the new row_version, or the current one when nothing changed.
-- +goose StatementBegin
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

  IF v_status = 'CANCELLED' THEN
    RAISE EXCEPTION 'Klien PO yang dibatalkan tidak dapat diganti.'
      USING ERRCODE = 'P0013';
  END IF;
  -- The invoice copied the buyer at delivery; the window Ubah PO reopens
  -- (invoice cancelled, no Pengganti yet) lets the Pengganti bill another.
  IF fn_po_lines_locked(p_po_id, v_status) THEN
    RAISE EXCEPTION 'Klien PO yang sudah Dikirim hanya dapat diganti setelah invoicenya dibatalkan dan sebelum invoice pengganti terbit.'
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
$function$;
-- +goose StatementEnd

-- An accepted quotation's contact.
-- Its PO follows while it is still on the quotation's client, since the PO
-- gate now reads the PO's own contact.
-- +goose StatementBegin
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

  IF v_status = 'accepted' THEN
    UPDATE purchase_orders
    SET contact_id = p_contact_id, updated_by = p_user_id
    WHERE quotation_id = p_quotation_id
      AND company_client_id = v_company
      AND contact_id IS DISTINCT FROM p_contact_id;
  END IF;

  IF v_status = 'draft' THEN
    PERFORM fn_quotation_notify(p_quotation_id, 'header', 'header', p_user_id);
  END IF;
  RETURN 'ok';
END;
$function$;
-- +goose StatementEnd

-- +goose Down
DROP FUNCTION IF EXISTS public.fn_quotation_update_client(bigint, bigint, bigint, bigint);
DROP FUNCTION IF EXISTS public.fn_po_update_client(bigint, integer, bigint, bigint, bigint);

-- +goose StatementBegin
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
$function$;
-- +goose StatementEnd
