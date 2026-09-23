-- +goose Up

-- 00052 CLIENT NUMBER IS A FIXED FOUR DIGIT KEY
-- fn_next_doc_no builds 'Q-' || YY || number || seq with no delimiter, so a
-- variable-width number is ambiguous: client 'SQA' on sequence 11 and client
-- 'SQA1' on sequence 1 both render 'Q-25SQA11/...'. The unique index on
-- quotation_no then blocks the second client for good.
-- Two fixed-width parts (YY, number) make the split unambiguous, so no two
-- clients can produce the same document number in a year. The customer-facing
-- number format is unchanged.

-- Backfill, in this order, so the unique index can be built at the end.
-- 1. Left pad anything that is already digits but too short.
UPDATE company_client
SET number = LPAD(number, 4, '0')
WHERE number ~ '^[0-9]{1,3}$';

-- 2. Give every remaining non-conforming row a free number, lowest first.
-- +goose StatementBegin
DO $$
DECLARE
  v_row     RECORD;
  v_next    INT := 1;
  v_number  TEXT;
BEGIN
  FOR v_row IN
    SELECT id FROM company_client
    WHERE number IS NULL OR number !~ '^[0-9]{4}$'
    ORDER BY id
  LOOP
    LOOP
      v_number := LPAD(v_next::TEXT, 4, '0');
      v_next := v_next + 1;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM company_client WHERE number = v_number);
      IF v_next > 10000 THEN
        RAISE EXCEPTION 'no free four digit client number left';
      END IF;
    END LOOP;
    UPDATE company_client SET number = v_number WHERE id = v_row.id;
  END LOOP;
END $$;
-- +goose StatementEnd

-- 3. Keep the lowest id on a duplicated number and move the rest.
-- +goose StatementBegin
DO $$
DECLARE
  v_row     RECORD;
  v_next    INT := 1;
  v_number  TEXT;
BEGIN
  FOR v_row IN
    SELECT id FROM (
      SELECT id, ROW_NUMBER() OVER (PARTITION BY number ORDER BY id) AS rn
      FROM company_client
    ) d WHERE d.rn > 1
    ORDER BY id
  LOOP
    LOOP
      v_number := LPAD(v_next::TEXT, 4, '0');
      v_next := v_next + 1;
      EXIT WHEN NOT EXISTS (SELECT 1 FROM company_client WHERE number = v_number);
      IF v_next > 10000 THEN
        RAISE EXCEPTION 'no free four digit client number left';
      END IF;
    END LOOP;
    UPDATE company_client SET number = v_number WHERE id = v_row.id;
  END LOOP;
END $$;
-- +goose StatementEnd

ALTER TABLE company_client ALTER COLUMN number SET NOT NULL;

ALTER TABLE company_client
  ADD CONSTRAINT company_client_number_format_check CHECK (number ~ '^[0-9]{4}$');

CREATE UNIQUE INDEX uq_company_client_number ON company_client (number);

-- +goose Down

DROP INDEX IF EXISTS uq_company_client_number;

ALTER TABLE company_client DROP CONSTRAINT IF EXISTS company_client_number_format_check;

ALTER TABLE company_client ALTER COLUMN number DROP NOT NULL;
