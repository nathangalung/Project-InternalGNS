-- +goose Up

-- 00072 CLIENT NUMBER LOCK
-- Every document number embeds the client number, and a client's number is
-- locked once a quotation uses it. The lock was a NOT EXISTS test in the
-- client UPDATE, which runs on the statement's snapshot: a quotation being
-- numbered in a concurrent transaction was invisible to it, so the number
-- could change after the quotation had embedded the old one. And
-- fn_next_doc_no read the number without a lock, so a quotation could embed
-- a number another transaction was replacing.
--
-- fn_next_doc_no now reads the number FOR SHARE, which a number change has
-- to wait for, and a BEFORE UPDATE OF number trigger refuses the change with
-- P0013 once any quotation references the client. A trigger's query takes a
-- fresh snapshot after the row lock is granted, so it sees a quotation that
-- committed while the change waited. The missing-number raise is typed and
-- Indonesian.

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_next_doc_no(p_doc_type character varying, p_company_id bigint)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_seq            INT;
  v_company_no     VARCHAR(10);
  v_year           INT := EXTRACT(YEAR FROM NOW());
  v_yy             VARCHAR(2);
  v_month          INT := EXTRACT(MONTH FROM NOW());
BEGIN
  -- The share lock holds the number until this document commits.
  SELECT number INTO v_company_no
  FROM company_client WHERE id = p_company_id
  FOR SHARE;

  IF v_company_no IS NULL OR v_company_no = '' THEN
    RAISE EXCEPTION 'Klien belum memiliki nomor. Isi Nomor Klien lalu coba lagi.'
      USING ERRCODE = 'P0014';
  END IF;

  -- UPSERT atomic: increment seq or insert new row
  INSERT INTO doc_sequences (doc_type, company_id, year, last_seq, updated_at)
  VALUES (p_doc_type, p_company_id, v_year, 1, NOW())
  ON CONFLICT (doc_type, company_id, year)
  DO UPDATE SET
    last_seq   = doc_sequences.last_seq + 1,
    updated_at = NOW()
  RETURNING last_seq INTO v_seq;

  v_yy := TO_CHAR(NOW(), 'YY');

  RETURN p_doc_type || '-' || v_yy || v_company_no || v_seq::TEXT ||
         '/GNS/' || fn_month_to_roman(v_month) || '/' || v_year::TEXT;
END;
$function$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.trg_fn_lock_client_number()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF NEW.number IS DISTINCT FROM OLD.number
     AND EXISTS (SELECT 1 FROM quotations WHERE company_client_id = OLD.id) THEN
    RAISE EXCEPTION 'Nomor klien tidak dapat diubah karena sudah dipakai pada penawaran.'
      USING ERRCODE = 'P0013';
  END IF;
  RETURN NEW;
END;
$function$;
-- +goose StatementEnd

CREATE TRIGGER trg_company_client_number_lock
  BEFORE UPDATE OF number ON company_client
  FOR EACH ROW EXECUTE FUNCTION trg_fn_lock_client_number();

-- +goose Down

DROP TRIGGER IF EXISTS trg_company_client_number_lock ON company_client;
DROP FUNCTION IF EXISTS public.trg_fn_lock_client_number();

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_next_doc_no(p_doc_type character varying, p_company_id bigint)
 RETURNS text
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_seq            INT;
  v_company_no     VARCHAR(10);
  v_year           INT := EXTRACT(YEAR FROM NOW());
  v_yy             VARCHAR(2);
  v_month          INT := EXTRACT(MONTH FROM NOW());
BEGIN
  -- Get company number for formatting
  SELECT number INTO v_company_no
  FROM company_client WHERE id = p_company_id;

  IF v_company_no IS NULL OR v_company_no = '' THEN
    RAISE EXCEPTION 'Company % does not have number set — required for doc_no generation', p_company_id;
  END IF;

  -- UPSERT atomic: increment seq or insert new row
  INSERT INTO doc_sequences (doc_type, company_id, year, last_seq, updated_at)
  VALUES (p_doc_type, p_company_id, v_year, 1, NOW())
  ON CONFLICT (doc_type, company_id, year)
  DO UPDATE SET
    last_seq   = doc_sequences.last_seq + 1,
    updated_at = NOW()
  RETURNING last_seq INTO v_seq;

  v_yy := TO_CHAR(NOW(), 'YY');

  RETURN p_doc_type || '-' || v_yy || v_company_no || v_seq::TEXT ||
         '/GNS/' || fn_month_to_roman(v_month) || '/' || v_year::TEXT;
END;
$function$;
-- +goose StatementEnd
