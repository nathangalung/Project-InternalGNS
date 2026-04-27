-- +goose Up
-- +goose StatementBegin

-- 00011 — company_contacts: phone CHECK + country_code FK
-- 1. company_contacts.country_code (new) — same as
-- company_client.country_code (CHAR(3) DEFAULT 'IDN'), plus FK
-- to countries(code) for referential integrity.
---- 2. company_contacts.phone — restrict to 9..12 digits (digit count
-- only, formatting like dashes/spaces ignored via REGEXP_REPLACE).
-- Matches ITU-T E.164 for local numbers after dial code.
---- 3. Bonus: company_client.country_code, previously a "FK candidate"
-- (00006 line 9), is now formally a FK for consistency.


-- 1. Add country_code to company_contacts.
ALTER TABLE company_contacts
  ADD COLUMN country_code CHAR(3) NOT NULL DEFAULT 'IDN'
  REFERENCES countries(code) ON DELETE RESTRICT;

COMMENT ON COLUMN company_contacts.country_code IS
  'ISO 3166 alpha-3 country code for phone dial code prefix. FK to countries(code). Default IDN. Same format as company_client.country_code.';


-- 2. CHECK phone digit count 9..12-- Strip non-digits (spaces, dashes, +) then count. NULL phone allowed.
ALTER TABLE company_contacts
  ADD CONSTRAINT company_contacts_phone_check
  CHECK (
    phone IS NULL
    OR LENGTH(REGEXP_REPLACE(phone, '\D', '', 'g')) BETWEEN 9 AND 12
  );

COMMENT ON CONSTRAINT company_contacts_phone_check ON company_contacts IS
  'Phone must be 9..12 digits (digit count only, formatting ignored). Matches ITU-T E.164 local number after dial code. NULL allowed.';


-- 3. Belated FK for company_client.country_code-- (00006 noted "FK candidate" but never added. Adding now
-- for consistency with company_contacts.)
ALTER TABLE company_client
  ADD CONSTRAINT company_client_country_code_fkey
  FOREIGN KEY (country_code) REFERENCES countries(code) ON DELETE RESTRICT;

-- +goose StatementEnd


-- +goose Down
-- +goose StatementBegin

ALTER TABLE company_client
  DROP CONSTRAINT IF EXISTS company_client_country_code_fkey;

ALTER TABLE company_contacts
  DROP CONSTRAINT IF EXISTS company_contacts_phone_check;

ALTER TABLE company_contacts
  DROP COLUMN IF EXISTS country_code;

-- +goose StatementEnd
