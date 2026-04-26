-- +goose Up
-- +goose StatementBegin

-- ============================================================
-- 00011 — company_contacts: phone CHECK + country_code FK
-- ============================================================
-- 1. company_contacts.country_code (baru) — sama persis kayak
--    company_client.country_code (CHAR(3) DEFAULT 'IDN'), plus FK
--    ke countries(code) untuk integritas referensial.
--
-- 2. company_contacts.phone — restrict 9..12 digit (count digit
--    saja, formatting seperti dash/spasi diabaikan via REGEXP_REPLACE).
--    Match standar ITU-T E.164 untuk nomor lokal setelah dial code.
--
-- 3. Bonus: company_client.country_code yang selama ini "FK candidate"
--    (00006 line 9) sekarang resmi dijadikan FK, supaya konsisten.
-- ============================================================


-- ─── 1. ADD country_code ke company_contacts ──
ALTER TABLE company_contacts
  ADD COLUMN country_code CHAR(3) NOT NULL DEFAULT 'IDN'
  REFERENCES countries(code) ON DELETE RESTRICT;

COMMENT ON COLUMN company_contacts.country_code IS
  'Kode negara ISO 3166 alpha-3 untuk dial code prefix nomor HP. FK ke countries(code). Default IDN. Sama format dengan company_client.country_code.';


-- ─── 2. CHECK phone digit count 9..12 ──
-- Strip non-digit (spasi, dash, +) lalu hitung. NULL phone diizinkan.
ALTER TABLE company_contacts
  ADD CONSTRAINT company_contacts_phone_check
  CHECK (
    phone IS NULL
    OR LENGTH(REGEXP_REPLACE(phone, '\D', '', 'g')) BETWEEN 9 AND 12
  );

COMMENT ON CONSTRAINT company_contacts_phone_check ON company_contacts IS
  'Nomor HP harus 9..12 digit (digit count saja, formatting diabaikan). Cocok dengan format ITU-T E.164 lokal setelah dial code. NULL diizinkan.';


-- ─── 3. Belated FK untuk company_client.country_code ──
-- (00006 menyebut "FK candidate" tapi belum dipasang. Pasang sekarang
--  untuk konsistensi dengan company_contacts.)
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
