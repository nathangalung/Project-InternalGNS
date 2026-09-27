-- +goose Up

-- 00075 CONTACT EMAIL TRAILING COMMA
-- The production survey found one active contact whose email fails the
-- server rule (shared/validate) only because it ends in a comma, so the
-- contact cannot be saved without retyping it. Strip one trailing comma,
-- with the whitespace around it, where the result then passes the rule.
--
-- The pattern below is validate.emailPattern; the migration test runs every
-- case in contact_rules.json against it. Anything else stays as it is: two
-- commas, a value that still fails the rule, or a result that would collide
-- with another active address on idx_company_contacts_email (unique on
-- LOWER(email) among active rows), including two rows that would collapse
-- onto one. A second run finds nothing to change.

WITH candidate AS (
  SELECT id, is_active,
         regexp_replace(email, '[[:space:]]*,[[:space:]]*$', '') AS fixed
  FROM company_contacts
  WHERE email ~ ',[[:space:]]*$'
), passing AS (
  SELECT id, is_active, fixed
  FROM candidate
  WHERE fixed ~ '^[A-Za-z0-9!#$%&''*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&''*+/=?^_`{|}~-]+)*@([A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$'
)
UPDATE company_contacts c
SET email = p.fixed
FROM passing p
WHERE c.id = p.id
  AND NOT (p.is_active AND (
    EXISTS (SELECT 1 FROM company_contacts o
            WHERE o.is_active AND o.id <> p.id
              AND LOWER(o.email) = LOWER(p.fixed))
    OR EXISTS (SELECT 1 FROM passing q
               WHERE q.is_active AND q.id <> p.id
                 AND LOWER(q.fixed) = LOWER(p.fixed))));

-- +goose Down

-- No-op. The stripped comma was a typo, not data; putting it back would
-- only make the address fail the rule again.
