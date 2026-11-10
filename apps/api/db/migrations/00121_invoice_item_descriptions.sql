-- +goose Up
-- 00121 INVOICE ITEM DESCRIPTIONS
-- The invoice's Description column printed each line's destination and
-- nothing else. Each line now keeps its own description, typed when the
-- invoice is downloaded, the way the delivery note keeps its row notes
-- (00114). NULL means none was saved yet, so the line prints its
-- destination as before. An empty description prints nothing. It is printed
-- text only: Coretax, the amounts and the snapshot are untouched, and a
-- paid or cancelled invoice keeps what it was filed with, like its dates.
ALTER TABLE invoice_items ADD COLUMN description VARCHAR(500);

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_update_invoice_descriptions(p_invoice_id bigint, p_if_match integer, p_lines jsonb, p_user_id bigint)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_current INT;
  v_status  VARCHAR(20);
  v_new     INT;
BEGIN
  SELECT row_version, status INTO v_current, v_status
  FROM invoices
  WHERE id = p_invoice_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Invoice tidak ditemukan. Muat ulang halaman.'
      USING ERRCODE = 'P0011';
  END IF;

  IF p_if_match IS NOT NULL AND v_current <> p_if_match THEN
    RAISE EXCEPTION 'Data ini baru saja diubah pengguna lain. Muat ulang lalu coba lagi.'
      USING ERRCODE = 'P0010';
  END IF;

  -- A filed invoice prints as it was filed.
  IF v_status IN ('paid', 'cancelled') THEN
    RAISE EXCEPTION 'Deskripsi invoice yang sudah lunas atau dibatalkan tidak dapat diubah.'
      USING ERRCODE = 'P0013';
  END IF;

  IF p_lines IS NULL OR jsonb_typeof(p_lines) <> 'array' OR jsonb_array_length(p_lines) = 0 THEN
    RAISE EXCEPTION 'Daftar deskripsi invoice kosong.'
      USING ERRCODE = 'P0014';
  END IF;

  -- Each description is for a line of this invoice.
  IF EXISTS (
    SELECT 1 FROM jsonb_array_elements(p_lines) AS e
    WHERE NOT EXISTS (
      SELECT 1 FROM invoice_items ii
      WHERE ii.id = (e->>'lineId')::BIGINT
        AND ii.invoice_id = p_invoice_id
    )
  ) THEN
    RAISE EXCEPTION 'Baris ini bukan baris invoice ini. Muat ulang halaman.'
      USING ERRCODE = 'P0014';
  END IF;

  UPDATE invoice_items ii
  SET description = COALESCE(e->>'description', ''),
      updated_by  = p_user_id
  FROM jsonb_array_elements(p_lines) AS e
  WHERE ii.id = (e->>'lineId')::BIGINT
    AND ii.invoice_id = p_invoice_id;

  UPDATE invoices
  SET updated_by = p_user_id
  WHERE id = p_invoice_id
  RETURNING row_version INTO v_new;

  RETURN v_new;
END;
$function$;
-- +goose StatementEnd

-- +goose Down
DROP FUNCTION IF EXISTS public.fn_update_invoice_descriptions(bigint, integer, jsonb, bigint);
ALTER TABLE invoice_items DROP COLUMN IF EXISTS description;
