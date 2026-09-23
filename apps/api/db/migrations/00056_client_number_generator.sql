-- +goose Up

-- 00056 SERVER ASSIGNED CLIENT NUMBER
-- 00052 made company_client.number a required unique four digit key but left
-- nothing to fill it, so a create without a number failed NOT NULL. A cycling
-- sequence hands out candidates and fn_next_client_number skips any already
-- typed in by hand. nextval never returns the same value to two sessions, so
-- concurrent creates draw distinct numbers without a lock.

CREATE SEQUENCE company_client_number_seq
  AS INT MINVALUE 1 MAXVALUE 9999 CYCLE
  OWNED BY company_client.number;

-- Start after the current max; an empty table starts at 1.
SELECT setval('company_client_number_seq',
              GREATEST(COALESCE(MAX(number::INT), 0), 1),
              COALESCE(MAX(number::INT), 0) > 0)
FROM company_client;

-- +goose StatementBegin
CREATE FUNCTION fn_next_client_number()
RETURNS TEXT
LANGUAGE plpgsql
AS $$
DECLARE
  v_number TEXT;
BEGIN
  -- One full cycle visits every number once.
  FOR i IN 1..9999 LOOP
    v_number := LPAD(nextval('company_client_number_seq')::TEXT, 4, '0');
    IF NOT EXISTS (SELECT 1 FROM company_client WHERE number = v_number) THEN
      RETURN v_number;
    END IF;
  END LOOP;
  RAISE EXCEPTION 'Semua nomor klien 4 digit sudah terpakai.'
    USING ERRCODE = 'P0014';
END;
$$;
-- +goose StatementEnd

ALTER TABLE company_client
  ALTER COLUMN number SET DEFAULT fn_next_client_number();

-- +goose Down

ALTER TABLE company_client ALTER COLUMN number DROP DEFAULT;

DROP FUNCTION IF EXISTS fn_next_client_number();

DROP SEQUENCE IF EXISTS company_client_number_seq;
