-- +goose Up
-- 00102 CONTACT EMAIL PER CLIENT
-- One person may be the contact of several clients of one group (IMC and
-- Pelita share staff), so an active contact's email is unique within its
-- client only. The old index spanned every client, which made the import
-- and the contact form drop the address from the second client.

DROP INDEX IF EXISTS idx_company_contacts_email;
CREATE UNIQUE INDEX idx_company_contacts_email
    ON company_contacts (company_id, LOWER(email))
    WHERE email IS NOT NULL AND is_active;

-- +goose Down
-- Fails while two clients share an active email; clear one first.
DROP INDEX IF EXISTS idx_company_contacts_email;
CREATE UNIQUE INDEX idx_company_contacts_email
    ON company_contacts (LOWER(email))
    WHERE email IS NOT NULL AND is_active;
