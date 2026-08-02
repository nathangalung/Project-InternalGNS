-- One-time purge of acceptance-suite leftovers (DEV ONLY).
--
-- Godog suites under internal/*/acceptance used to run against the shared dev
-- database without teardown, so every run left master data behind. Suites now
-- delete the ids they create (internal/testutil/cleanup.go); this script clears
-- the backlog that accumulated before that fix.
--
-- Matching is by the name/email prefixes the suites generate, which is the only
-- handle left for rows nobody recorded:
--   company_client  'ATDD CLIENT%'  / 'ATDD CLIENT UPDATED%'
--   items           'ATDD ITEM%'    / 'BDD AutoCreate Unknown%'
--   vendors         'ATDD VENDOR%'
--   users           'atdd_<unix-nanos>@example.test'
-- Every generated name carries a '_<unix-nanos>' suffix, so a hand-typed row
-- cannot collide. Contacts are named by the feature file ("Budi") and are
-- reached through their parent client id, never by prefix.
--
-- Sequences are left alone on purpose: deleting rows cannot leave a sequence
-- behind max(id), so nothing needs resetting.
--
-- Run through `make db-clean-testdata`, which refuses non-local databases.
-- Never wire this into tests or migrations.

BEGIN;

\echo '-- before'
SELECT 'company_client'   AS table_name, count(*) AS test_rows FROM company_client WHERE name LIKE 'ATDD %'
UNION ALL SELECT 'company_contacts', count(*) FROM company_contacts c
    JOIN company_client cc ON cc.id = c.company_id WHERE cc.name LIKE 'ATDD %'
UNION ALL SELECT 'items',   count(*) FROM items   WHERE name LIKE 'ATDD %' OR name LIKE 'BDD AutoCreate Unknown%'
UNION ALL SELECT 'vendors', count(*) FROM vendors WHERE name LIKE 'ATDD %'
UNION ALL SELECT 'users',   count(*) FROM users   WHERE email LIKE 'atdd\_%@example.test';

-- Children first: vendor_products and company_contacts are ON DELETE RESTRICT.
DELETE FROM vendor_products vp USING items i
  WHERE vp.item_id = i.id AND (i.name LIKE 'ATDD %' OR i.name LIKE 'BDD AutoCreate Unknown%');
DELETE FROM vendor_products vp USING vendors v
  WHERE vp.vendor_id = v.id AND v.name LIKE 'ATDD %';
DELETE FROM company_contacts c USING company_client cc
  WHERE c.company_id = cc.id AND cc.name LIKE 'ATDD %';
DELETE FROM refresh_tokens rt USING users u
  WHERE rt.user_id = u.id AND u.email LIKE 'atdd\_%@example.test';

DELETE FROM company_client WHERE name LIKE 'ATDD %';
DELETE FROM items          WHERE name LIKE 'ATDD %' OR name LIKE 'BDD AutoCreate Unknown%';
DELETE FROM vendors        WHERE name LIKE 'ATDD %';
DELETE FROM users          WHERE email LIKE 'atdd\_%@example.test';

\echo '-- after'
SELECT 'company_client'   AS table_name, count(*) AS test_rows FROM company_client WHERE name LIKE 'ATDD %'
UNION ALL SELECT 'company_contacts', count(*) FROM company_contacts c
    JOIN company_client cc ON cc.id = c.company_id WHERE cc.name LIKE 'ATDD %'
UNION ALL SELECT 'items',   count(*) FROM items   WHERE name LIKE 'ATDD %' OR name LIKE 'BDD AutoCreate Unknown%'
UNION ALL SELECT 'vendors', count(*) FROM vendors WHERE name LIKE 'ATDD %'
UNION ALL SELECT 'users',   count(*) FROM users   WHERE email LIKE 'atdd\_%@example.test';

COMMIT;
