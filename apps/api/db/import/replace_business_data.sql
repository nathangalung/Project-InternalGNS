-- Replace every business row with the historical seed, in one transaction.
--
-- Empties the business tables of the reimport plan's table plan
-- (docs/data_reimport_plan.md) and loads ../seeds/03_historical.sql.
-- Users, refresh tokens, countries, units and goose state are kept;
-- doc_counters is set by the seed to the highest loaded number.
-- Refuses to run unless migration 00100 is applied.
--
-- Data users entered in the app is carried over, matched by normalised
-- name (case, spaces and punctuation ignored, a leading PT. or CV. and a
-- trailing Tbk dropped): client tax and contact fields, logos and
-- numbers, contacts, vendor contact fields, products created in the app
-- or holding photos, and PO files. A client the seed lacks that existed
-- before the last historical quotation and owns no document created in
-- the app carries over, with its contacts, as a client with no
-- documents. Rows the test suites created never carry over. What cannot
-- be placed (any other client the seed lacks, documents created in the
-- app) is not loaded; the carry-over
-- report at the end lists it with ids and names only, and counts the
-- test rows left out.
--
-- Run with psql -f (the include path is relative to this file):
--   dev:  make reimport-dev
--   prod: see docs/data_reimport_plan.md (backup first, API stopped)

\set ON_ERROR_STOP on

BEGIN;

DO $$
BEGIN
  IF NOT COALESCE((SELECT is_applied FROM goose_db_version
                   WHERE version_id = 100 ORDER BY id DESC LIMIT 1), FALSE) THEN
    RAISE EXCEPTION 'replace_business_data: migration 00100 is not applied; migrate first';
  END IF;
END $$;

-- Name matching
-- The legal form (a leading PT. or CV., a trailing Tbk) is not the name.
CREATE FUNCTION pg_temp.gns_norm(p TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(regexp_replace(
           regexp_replace(
             regexp_replace(COALESCE(p, ''), '^\s*(pt|cv)(\.|\s)\s*', '', 'i'),
             '[\s,]+tbk\.?\s*$', '', 'i'),
           '[^[:alnum:]]+', '', 'g'))
$$;

-- A person's name without a leading honorific.
CREATE FUNCTION pg_temp.gns_person(p TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT lower(regexp_replace(
           regexp_replace(COALESCE(p, ''),
                          '^\s*(bapak|bpk|bp|pak|ibu|bu|mr|mrs|ms|miss)(\.|\s)\s*', '', 'i'),
           '[^[:alnum:]]+', '', 'g'))
$$;

-- An entered email without stray separators, or NULL when it is not one
-- plain mailbox (validate.Email's pattern), so the contact stays savable.
CREATE FUNCTION pg_temp.gns_mail(p TEXT) RETURNS TEXT
LANGUAGE sql IMMUTABLE AS $$
  SELECT m FROM (SELECT regexp_replace(btrim(p), '[\s,;]+$', '') AS m) x
  WHERE m ~ ('^[A-Za-z0-9!#$%&''*+/=?^_`{|}~-]+(\.[A-Za-z0-9!#$%&''*+/=?^_`{|}~-]+)*' ||
             '@([A-Za-z0-9]([A-Za-z0-9-]*[A-Za-z0-9])?\.)+[A-Za-z]{2,}$')
$$;

-- Test data
-- Rows the e2e and acceptance suites create carry their run prefix in a
-- name (apps/web/e2e: E2E<hex>, E2E-FA-, the word E2E, Qzvx <hex>; the
-- godog suites: ATDD, BDD AutoCreate Unknown, RFQ Kabel, Qzvx <digits>;
-- testutil: Test Fixture) or a test mail domain (test.local,
-- example.test), or were created by their users. They never carry over;
-- the report counts them.
CREATE FUNCTION pg_temp.gns_test_name(p TEXT) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(p ~ '(^|[^[:alnum:]])E2E([0-9A-F]{8}|[^[:alnum:]]|$)'
                  OR p ~ '^(ATDD |BDD AutoCreate Unknown)'
                  OR p ~ '^RFQ Kabel [0-9]{6}$'
                  OR p ~ '^Qzvx ([0-9a-f]{8}|[0-9]{6}) [a-z]+$'
                  OR p ~ '^Test Fixture ', FALSE)
$$;

CREATE FUNCTION pg_temp.gns_test_mail(p TEXT) RETURNS BOOLEAN
LANGUAGE sql IMMUTABLE AS $$
  SELECT COALESCE(p ~* '^e2e[0-9a-f]{8}\.' OR p ~* '@(test\.local|example\.test)$', FALSE)
$$;

CREATE TEMP TABLE test_user ON COMMIT DROP AS
SELECT id FROM users
WHERE email ~* '^e2e[.-][^@]*@globalsakti\.com$' OR pg_temp.gns_test_mail(email);

-- What users entered, read before the tables are emptied
CREATE TEMP TABLE carry_client ON COMMIT DROP AS
SELECT id, number, name, pg_temp.gns_norm(name) AS norm, npwp, address, country_code,
       tku_id, email, logo_object_key, is_active, created_by, created_at, updated_at,
       pg_temp.gns_test_name(name) OR created_by IN (SELECT id FROM test_user) AS test
FROM company_client;

CREATE TEMP TABLE carry_contact ON COMMIT DROP AS
SELECT ct.id, cl.norm AS client_norm, ct.name, pg_temp.gns_person(ct.name) AS person,
       ct.email, pg_temp.gns_mail(ct.email) AS mail, ct.phone, ct.title, ct.is_active, ct.country_code, ct.created_by, ct.created_at,
       cl.test OR pg_temp.gns_test_name(ct.name)
         OR pg_temp.gns_test_mail(ct.email)
         OR ct.created_by IN (SELECT id FROM test_user) AS test
FROM company_contacts ct
JOIN carry_client cl ON cl.id = ct.company_id;

CREATE TEMP TABLE carry_vendor ON COMMIT DROP AS
SELECT id, name, pg_temp.gns_norm(name) AS norm, location, contact_info, logo_object_key,
       is_active, created_by, created_at, updated_at > created_at AS edited,
       pg_temp.gns_test_name(name) OR created_by IN (SELECT id FROM test_user) AS test
FROM vendors;

CREATE TEMP TABLE carry_item ON COMMIT DROP AS
SELECT i.id, i.name, pg_temp.gns_norm(i.name) AS norm, i.impa_code, i.description,
       i.default_unit_id, i.is_active, i.image_object_key, i.created_by, i.updated_by,
       i.created_at, i.updated_at,
       pg_temp.gns_test_name(i.name) OR i.created_by IN (SELECT id FROM test_user) AS test
FROM items i;

CREATE TEMP TABLE carry_image ON COMMIT DROP AS
SELECT m.item_id, m.object_key, m.created_by, m.created_at,
       i.test OR COALESCE(m.created_by IN (SELECT id FROM test_user), FALSE) AS test
FROM item_images m
JOIN carry_item i ON i.id = m.item_id;

CREATE TEMP TABLE carry_link ON COMMIT DROP AS
SELECT k.vendor_id, k.item_id, k.vendor_sku, k.cost_price, k.last_quoted_at, k.is_active,
       k.product_url, k.created_by, k.created_at,
       i.test OR v.test OR k.created_by IN (SELECT id FROM test_user) AS test
FROM vendor_products k
JOIN carry_item i ON i.id = k.item_id
JOIN carry_vendor v ON v.id = k.vendor_id;

CREATE TEMP TABLE carry_po_file ON COMMIT DROP AS
SELECT po.id, cl.norm AS client_norm, cl.name AS client_name, po.po_number, po.file_url,
       po.file_name, po.file_size, po.uploaded_at,
       cl.test OR pg_temp.gns_test_name(po.po_number)
         OR po.created_by IN (SELECT id FROM test_user) AS test
FROM purchase_orders po
JOIN carry_client cl ON cl.id = po.company_client_id
WHERE po.file_url IS NOT NULL;

-- Documents an import wrote carry its number or its import note; the rest
-- were created in the app.
CREATE TEMP TABLE carry_quotation ON COMMIT DROP AS
SELECT q.id, q.quotation_no, q.company_client_id, q.company_client_name, q.status,
       q.created_at,
       (q.legacy_no IS NOT NULL
        OR COALESCE(q.notes LIKE 'Imported from Excel%', FALSE)
        OR COALESCE(q.notes LIKE 'Reverse-engineered from%', FALSE)
        OR COALESCE(q.notes LIKE 'Dibuat ulang dari baris PO klien%', FALSE)) AS imported,
       cl.test OR q.created_by IN (SELECT id FROM test_user) AS test
FROM quotations q
JOIN carry_client cl ON cl.id = q.company_client_id;

CREATE TEMP TABLE carry_po ON COMMIT DROP AS
SELECT p.id, p.po_number, p.status, q.quotation_no, q.company_client_name, q.imported,
       q.test OR pg_temp.gns_test_name(p.po_number)
         OR p.created_by IN (SELECT id FROM test_user) AS test
FROM purchase_orders p
JOIN carry_quotation q ON q.id = p.quotation_id;

CREATE TEMP TABLE carry_invoice ON COMMIT DROP AS
SELECT i.id, i.invoice_no, i.status, i.buyer_name, i.total, q.imported,
       q.test OR i.created_by IN (SELECT id FROM test_user) AS test
FROM invoices i
JOIN carry_quotation q ON q.id = i.quotation_id;

-- Set the test rows aside, counted.
CREATE TEMP TABLE carry_test (kind TEXT, n BIGINT) ON COMMIT DROP;
DO $$
DECLARE
  t TEXT;
  n BIGINT;
BEGIN
  FOREACH t IN ARRAY ARRAY['client', 'contact', 'vendor', 'item', 'image', 'link', 'po_file',
                           'quotation', 'po', 'invoice'] LOOP
    EXECUTE format('WITH d AS (DELETE FROM carry_%s WHERE test RETURNING 1) '
                   'SELECT count(*) FROM d', t) INTO n;
    INSERT INTO carry_test VALUES (t, n);
  END LOOP;
END $$;

TRUNCATE TABLE
  invoice_status_history, invoice_items, invoices,
  po_status_history, purchase_order_items, purchase_orders,
  quotation_edit_locks, quotation_status_history, quotation_item_requests,
  quotation_items, quotations,
  item_request_matches, item_images, vendor_products, items, vendors,
  company_contacts, company_client
RESTART IDENTITY;

-- The seed runs inside this transaction and leaves COMMIT to it.
\set gns_outer_tx 1
\ir ../seeds/03_historical.sql

-- Carry-over
CREATE TEMP TABLE carry_log (kind TEXT, old_id BIGINT, new_id BIGINT, label TEXT)
ON COMMIT DROP;

-- Each old client's seeded client.
CREATE TEMP TABLE client_map ON COMMIT DROP AS
SELECT DISTINCT ON (o.id) o.id AS old_id, c.id AS new_id
FROM carry_client o
JOIN company_client c ON pg_temp.gns_norm(c.name) = o.norm
ORDER BY o.id, c.id;

-- The old client with the most data fills each seeded client's gaps.
WITH best AS (
  SELECT DISTINCT ON (m.new_id) m.new_id, o.*
  FROM client_map m
  JOIN carry_client o ON o.id = m.old_id
  ORDER BY m.new_id, (o.npwp IS NOT NULL) DESC, (o.address IS NOT NULL) DESC, o.id
), filled AS (
  UPDATE company_client c
  SET npwp            = COALESCE(c.npwp, b.npwp),
      address         = COALESCE(c.address, b.address),
      country_code    = COALESCE(b.country_code, c.country_code),
      tku_id          = COALESCE(c.tku_id, b.tku_id),
      email           = COALESCE(c.email, b.email),
      logo_object_key = COALESCE(c.logo_object_key, b.logo_object_key)
  FROM best b
  WHERE c.id = b.new_id
  RETURNING c.id, b.id AS old_id, c.name
)
INSERT INTO carry_log SELECT 'client matched', old_id, id, name FROM filled;

-- An old four-digit number stays when no other client holds it.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT DISTINCT ON (m.new_id) m.new_id, o.id AS old_id, o.number
    FROM client_map m
    JOIN carry_client o ON o.id = m.old_id
    WHERE o.number ~ '^[0-9]{4}$'
    ORDER BY m.new_id, (o.npwp IS NOT NULL) DESC, (o.address IS NOT NULL) DESC, o.id
  LOOP
    IF NOT EXISTS (SELECT 1 FROM company_client WHERE number = r.number) THEN
      UPDATE company_client SET number = r.number WHERE id = r.new_id;
      INSERT INTO carry_log VALUES ('client number kept', r.old_id, r.new_id, r.number);
    END IF;
  END LOOP;
  PERFORM setval('company_client_number_seq', (SELECT max(number::INTEGER) FROM company_client));
END $$;

-- A client the seed lacks that existed before the last historical
-- quotation (the cutoff the products use) is kept, without documents;
-- its contacts follow below. One created in the app after it is not, nor
-- one owning a quotation created in the app (with its PO and invoice):
-- those documents are not loaded, so neither is their client. Its number
-- stays when free, else it takes the next one.
DO $$
DECLARE
  v_cutoff TIMESTAMPTZ := (SELECT max(created_at) FROM quotations);
  r        RECORD;
  v_id     BIGINT;
  v_number TEXT;
BEGIN
  FOR r IN
    SELECT DISTINCT ON (o.norm) o.*
    FROM carry_client o
    WHERE o.created_at <= v_cutoff
      AND NOT EXISTS (SELECT 1 FROM client_map m WHERE m.old_id = o.id)
      AND NOT EXISTS (SELECT 1 FROM carry_client s
                      JOIN carry_quotation q ON q.company_client_id = s.id
                      WHERE s.norm = o.norm AND NOT q.imported)
    ORDER BY o.norm, (o.npwp IS NOT NULL) DESC, (o.address IS NOT NULL) DESC, o.id
  LOOP
    v_number := CASE
      WHEN r.number ~ '^[0-9]{4}$'
           AND NOT EXISTS (SELECT 1 FROM company_client WHERE number = r.number)
      THEN r.number
      ELSE fn_next_client_number()
    END;
    INSERT INTO company_client
      (number, name, npwp, address, country_code, tku_id, email, logo_object_key, is_active,
       created_by, updated_by, created_at, updated_at)
    VALUES
      (v_number, r.name, r.npwp, r.address, r.country_code, r.tku_id, r.email,
       r.logo_object_key, r.is_active, r.created_by, r.created_by, r.created_at, r.updated_at)
    RETURNING id INTO v_id;
    INSERT INTO client_map
    SELECT o.id, v_id FROM carry_client o
    WHERE o.norm = r.norm AND NOT EXISTS (SELECT 1 FROM client_map m WHERE m.old_id = o.id);
    INSERT INTO carry_log VALUES ('client kept without documents', r.id, v_id, r.name);
  END LOOP;
  PERFORM setval('company_client_number_seq', (SELECT max(number::INTEGER) FROM company_client));
END $$;

-- Contacts: fill a seeded one's gaps, or add the old one.
DO $$
DECLARE
  r      RECORD;
  v_id   BIGINT;
  v_mail TEXT;
BEGIN
  FOR r IN
    SELECT DISTINCT ON (c.id, cc.person) c.id AS new_client, cc.*
    FROM carry_contact cc
    JOIN company_client c ON pg_temp.gns_norm(c.name) = cc.client_norm
    WHERE cc.person <> ''
    ORDER BY c.id, cc.person, cc.is_active DESC, cc.id
  LOOP
    SELECT id INTO v_id
    FROM company_contacts
    WHERE company_id = r.new_client
      AND (pg_temp.gns_person(name) = r.person
           OR (r.mail IS NOT NULL AND lower(email) = lower(r.mail)))
    ORDER BY id LIMIT 1;
    -- A shorter name for one seeded person ('Bapak Wawan') is that person.
    IF v_id IS NULL AND length(r.person) >= 4 THEN
      SELECT CASE WHEN count(*) = 1 THEN min(id) END INTO v_id
      FROM company_contacts
      WHERE company_id = r.new_client AND starts_with(pg_temp.gns_person(name), r.person);
    END IF;
    -- An active contact's email is unique among active contacts.
    v_mail := CASE
      WHEN r.mail IS NULL THEN NULL
      WHEN NOT r.is_active THEN r.mail
      WHEN EXISTS (SELECT 1 FROM company_contacts
                   WHERE is_active AND lower(email) = lower(r.mail)
                     AND id IS DISTINCT FROM v_id) THEN NULL
      ELSE r.mail
    END;
    IF v_id IS NOT NULL THEN
      UPDATE company_contacts
      SET email = COALESCE(email, v_mail),
          phone = COALESCE(phone, r.phone),
          title = COALESCE(title, r.title)
      WHERE id = v_id
        AND ((email IS NULL AND v_mail IS NOT NULL)
             OR (phone IS NULL AND r.phone IS NOT NULL)
             OR (title IS NULL AND r.title IS NOT NULL));
      IF FOUND THEN
        INSERT INTO carry_log VALUES ('contact filled', r.id, v_id, r.name);
      END IF;
    ELSE
      INSERT INTO company_contacts
        (company_id, name, email, phone, title, is_active, country_code,
         created_by, updated_by, created_at, updated_at)
      VALUES
        (r.new_client, r.name, v_mail, r.phone, r.title, r.is_active, r.country_code,
         r.created_by, r.created_by, r.created_at, r.created_at)
      RETURNING id INTO v_id;
      INSERT INTO carry_log VALUES ('contact added', r.id, v_id, r.name);
    END IF;
    IF r.email IS NOT NULL AND r.mail IS NULL THEN
      INSERT INTO carry_log VALUES ('contact email left out (invalid)', r.id, v_id, r.name);
    ELSIF r.mail IS NOT NULL AND v_mail IS NULL THEN
      INSERT INTO carry_log VALUES ('contact email left out (in use)', r.id, v_id, r.name);
    END IF;
  END LOOP;
END $$;

-- Vendor contact fields users edited.
WITH edited AS (
  SELECT DISTINCT ON (norm) * FROM carry_vendor WHERE edited ORDER BY norm, id
), filled AS (
  UPDATE vendors v
  SET location        = COALESCE(v.location, e.location),
      contact_info    = COALESCE(v.contact_info, e.contact_info),
      logo_object_key = COALESCE(v.logo_object_key, e.logo_object_key)
  FROM edited e
  WHERE pg_temp.gns_norm(v.name) = e.norm
    AND ((v.location IS NULL AND e.location IS NOT NULL)
         OR (v.contact_info IS NULL AND e.contact_info IS NOT NULL)
         OR (v.logo_object_key IS NULL AND e.logo_object_key IS NOT NULL))
  RETURNING v.id, e.id AS old_id, v.name
)
INSERT INTO carry_log SELECT 'vendor filled', old_id, id, name FROM filled;

-- Products created in the app after the last historical quotation, or
-- holding photos: a seeded product they match (IMPA code, then name)
-- takes their photos; one they do not match is added again with its
-- photos and vendor links.
CREATE TEMP TABLE item_key ON COMMIT DROP AS
SELECT id, upper(impa_code) AS impa, is_active, pg_temp.gns_norm(name) AS norm FROM items;
CREATE INDEX ON item_key (impa);
CREATE INDEX ON item_key (norm);

CREATE TEMP TABLE vendor_key ON COMMIT DROP AS
SELECT id, pg_temp.gns_norm(name) AS norm FROM vendors;
CREATE INDEX ON vendor_key (norm);

DO $$
DECLARE
  -- MaxItemImages, enforced by fn_item_image_add.
  c_max_images CONSTANT INTEGER := 8;
  v_cutoff     TIMESTAMPTZ := (SELECT max(created_at) FROM quotations);
  r            RECORD;
  l            RECORD;
  v_id         BIGINT;
  v_vendor     BIGINT;
  v_key        TEXT;
  v_count      INTEGER;
BEGIN
  FOR r IN
    SELECT ci.* FROM carry_item ci
    WHERE ci.created_at > v_cutoff
       OR ci.image_object_key IS NOT NULL
       OR EXISTS (SELECT 1 FROM carry_image m WHERE m.item_id = ci.id)
    ORDER BY ci.id
  LOOP
    v_id := NULL;
    IF r.impa_code IS NOT NULL THEN
      SELECT id INTO v_id FROM item_key
      WHERE is_active AND impa = upper(r.impa_code) ORDER BY id LIMIT 1;
    END IF;
    IF v_id IS NULL AND r.norm <> '' THEN
      SELECT id INTO v_id FROM item_key WHERE norm = r.norm ORDER BY id LIMIT 1;
    END IF;

    IF v_id IS NOT NULL THEN
      INSERT INTO carry_log VALUES ('product matched', r.id, v_id, r.name);
    ELSE
      INSERT INTO items
        (name, impa_code, description, default_unit_id, is_active, image_object_key,
         created_by, updated_by, created_at, updated_at)
      VALUES
        (r.name, r.impa_code, r.description, r.default_unit_id, r.is_active,
         r.image_object_key, r.created_by, r.updated_by, r.created_at, r.updated_at)
      RETURNING id INTO v_id;
      INSERT INTO item_key VALUES (v_id, upper(r.impa_code), r.is_active, r.norm);
      INSERT INTO carry_log VALUES ('product added', r.id, v_id, r.name);

      FOR l IN
        SELECT k.*, o.norm AS vendor_norm
        FROM carry_link k JOIN carry_vendor o ON o.id = k.vendor_id
        WHERE k.item_id = r.id ORDER BY k.vendor_id
      LOOP
        SELECT id INTO v_vendor FROM vendor_key WHERE norm = l.vendor_norm ORDER BY id LIMIT 1;
        IF v_vendor IS NULL THEN
          INSERT INTO vendors
            (name, location, contact_info, logo_object_key, is_active,
             created_by, updated_by, created_at, updated_at)
          SELECT name, location, contact_info, logo_object_key, is_active,
                 created_by, created_by, created_at, created_at
          FROM carry_vendor WHERE id = l.vendor_id
          RETURNING id INTO v_vendor;
          INSERT INTO vendor_key VALUES (v_vendor, l.vendor_norm);
          INSERT INTO carry_log
          SELECT 'vendor added', l.vendor_id, v_vendor, name FROM carry_vendor
          WHERE id = l.vendor_id;
        END IF;
        INSERT INTO vendor_products
          (vendor_id, item_id, vendor_sku, cost_price, last_quoted_at, is_active, product_url,
           created_by, updated_by, created_at, updated_at)
        VALUES
          (v_vendor, v_id, l.vendor_sku, l.cost_price, l.last_quoted_at, l.is_active,
           l.product_url, l.created_by, l.created_by, l.created_at, l.created_at)
        ON CONFLICT (vendor_id, item_id) DO NOTHING;
        IF FOUND THEN
          INSERT INTO carry_log VALUES ('vendor link added', l.vendor_id, v_id, r.name);
        END IF;
      END LOOP;
    END IF;

    -- The cover first, then the gallery in upload order.
    FOR v_key IN
      SELECT k FROM (
        SELECT r.image_object_key AS k, NULL::TIMESTAMPTZ AS at, 0 AS pos
        WHERE r.image_object_key IS NOT NULL
        UNION ALL
        SELECT object_key, created_at, 1 FROM carry_image WHERE item_id = r.id
      ) keys
      GROUP BY k ORDER BY min(pos), min(at), k
    LOOP
      CONTINUE WHEN EXISTS (SELECT 1 FROM item_images
                            WHERE item_id = v_id AND object_key = v_key);
      SELECT count(*) INTO v_count FROM item_images WHERE item_id = v_id;
      IF v_count >= c_max_images THEN
        INSERT INTO carry_log VALUES ('photo left out (8 per product)', r.id, v_id, v_key);
        CONTINUE;
      END IF;
      INSERT INTO item_images (item_id, object_key, created_by, created_at)
      SELECT v_id, v_key, COALESCE(m.created_by, r.created_by),
             COALESCE(m.created_at, r.updated_at)
      FROM (SELECT 1) one
      LEFT JOIN carry_image m ON m.item_id = r.id AND m.object_key = v_key;
      INSERT INTO carry_log VALUES ('photo attached', r.id, v_id, r.name);
    END LOOP;
    UPDATE items
    SET image_object_key = (SELECT object_key FROM item_images
                            WHERE item_id = v_id ORDER BY id LIMIT 1)
    WHERE id = v_id AND image_object_key IS NULL
      AND EXISTS (SELECT 1 FROM item_images WHERE item_id = v_id);
  END LOOP;
END $$;

-- PO files, on the seeded PO with the same client and PO number. The
-- updated_at trigger would stamp NOW(); it stays the last status move.
ALTER TABLE purchase_orders DISABLE TRIGGER trg_purchase_orders_updated_at;
WITH files AS (
  SELECT DISTINCT ON (p.id) p.id, f.id AS old_id, f.file_url, f.file_name, f.file_size,
         f.uploaded_at
  FROM carry_po_file f
  JOIN company_client c ON pg_temp.gns_norm(c.name) = f.client_norm
  JOIN purchase_orders p ON p.company_client_id = c.id
                        AND upper(btrim(p.po_number)) = upper(btrim(f.po_number))
  WHERE p.file_url IS NULL
  ORDER BY p.id, f.uploaded_at DESC NULLS LAST, f.id
), attached AS (
  UPDATE purchase_orders p
  SET file_url = f.file_url, file_name = f.file_name, file_size = f.file_size,
      uploaded_at = f.uploaded_at
  FROM files f
  WHERE p.id = f.id
  RETURNING p.id, f.old_id, p.po_number
)
INSERT INTO carry_log SELECT 'PO file attached', old_id, id, po_number FROM attached;
ALTER TABLE purchase_orders ENABLE TRIGGER trg_purchase_orders_updated_at;

-- An invoice keeps the buyer it printed. One billed to its own client
-- takes the NPWP and address users entered when it printed none; one
-- billed to another company is left alone.
ALTER TABLE invoices DISABLE TRIGGER trg_invoices_updated_at;
UPDATE invoices i
SET buyer_npwp = COALESCE(i.buyer_npwp, c.npwp),
    buyer_address = COALESCE(i.buyer_address, c.address)
FROM company_client c
WHERE c.id = i.company_client_id
  AND pg_temp.gns_norm(i.buyer_name) = pg_temp.gns_norm(c.name)
  AND ((i.buyer_npwp IS NULL AND c.npwp IS NOT NULL)
       OR (i.buyer_address IS NULL AND c.address IS NOT NULL));
ALTER TABLE invoices ENABLE TRIGGER trg_invoices_updated_at;

-- Carry-over report (ids and names only)
\echo
\echo 'Carry-over: what was kept'
SELECT kind, count(*) AS rows FROM carry_log GROUP BY kind ORDER BY kind;

\echo 'Carry-over: products added again (old id, new id)'
SELECT old_id, new_id, label AS name FROM carry_log WHERE kind = 'product added' ORDER BY old_id;

\echo 'Carried over: clients the seed lacks, kept without documents (new id)'
SELECT c.id, c.number, c.name,
       (SELECT count(*) FROM company_contacts ct WHERE ct.company_id = c.id) AS contacts
FROM carry_log l
JOIN company_client c ON c.id = l.new_id
WHERE l.kind = 'client kept without documents'
ORDER BY c.id;

\echo 'Not loaded: clients the seed lacks, created after the historical data or owning documents created in the app, with their contacts and those documents'
SELECT o.id, o.number, o.name,
       (SELECT count(*) FROM carry_quotation q
        WHERE q.company_client_id = o.id AND NOT q.imported) AS app_quotations,
       (SELECT count(*) FROM carry_contact cc WHERE cc.client_norm = o.norm) AS contacts
FROM carry_client o
WHERE NOT EXISTS (SELECT 1 FROM client_map m WHERE m.old_id = o.id)
ORDER BY o.id;

\echo 'Not loaded: vendors users edited that match no vendor'
SELECT o.id, o.name
FROM carry_vendor o
WHERE o.edited AND NOT EXISTS (SELECT 1 FROM vendor_key k WHERE k.norm = o.norm)
ORDER BY o.id;

\echo 'Not loaded: PO files with no seeded PO of that client and number'
SELECT f.id, f.client_name, f.po_number, f.file_name
FROM carry_po_file f
WHERE NOT EXISTS (SELECT 1 FROM carry_log l WHERE l.kind = 'PO file attached' AND l.old_id = f.id)
ORDER BY f.id;

\echo 'Not loaded: quotations created in the app'
SELECT id, quotation_no, company_client_name AS client, status, created_at::DATE AS created
FROM carry_quotation WHERE NOT imported ORDER BY id;

\echo 'Not loaded: purchase orders created in the app'
SELECT id, po_number, quotation_no, company_client_name AS client, status
FROM carry_po WHERE NOT imported ORDER BY id;

\echo 'Not loaded: invoices created in the app'
SELECT id, invoice_no, buyer_name AS client, status, total
FROM carry_invoice WHERE NOT imported ORDER BY id;

\echo 'Left out as test data (e2e and acceptance rows)'
SELECT kind, n AS rows FROM carry_test ORDER BY kind;

\echo 'Replaced by the seed: documents of the old import'
SELECT (SELECT count(*) FROM carry_quotation WHERE imported) AS quotations,
       (SELECT count(*) FROM carry_po WHERE imported) AS purchase_orders,
       (SELECT count(*) FROM carry_invoice WHERE imported) AS invoices;

COMMIT;
