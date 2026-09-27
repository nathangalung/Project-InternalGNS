-- +goose Up

-- 00074 VENDOR CONTACT INFO SHAPE
-- The API reads vendors.contact_info into a struct of three strings (email,
-- phone, sku). The column is plain JSONB, so a row holding a non-object or a
-- non-string value for one of those keys failed to decode, and the vendor
-- list page holding it, and its detail, returned 500.
--
-- Existing rows are normalised first: a non-object (including a JSON null)
-- becomes SQL NULL, and a non-string email, phone or sku becomes its text as
-- a JSON string. A JSON null value is left alone, since it decodes as blank.
-- Then a CHECK makes the database refuse any other shape. Keys outside the
-- three stay unconstrained; the read path ignores them.

UPDATE vendors
SET contact_info = NULL
WHERE contact_info IS NOT NULL
  AND jsonb_typeof(contact_info) <> 'object';

UPDATE vendors v
SET contact_info = (
  SELECT jsonb_object_agg(
           e.key,
           CASE
             WHEN e.key IN ('email', 'phone', 'sku')
                  AND jsonb_typeof(e.value) NOT IN ('string', 'null')
             THEN to_jsonb(e.value #>> '{}')
             ELSE e.value
           END)
  FROM jsonb_each(v.contact_info) e)
WHERE jsonb_typeof(v.contact_info) = 'object'
  AND EXISTS (
    SELECT 1 FROM jsonb_each(v.contact_info) e
    WHERE e.key IN ('email', 'phone', 'sku')
      AND jsonb_typeof(e.value) NOT IN ('string', 'null'));

ALTER TABLE vendors
  ADD CONSTRAINT vendors_contact_info_shape CHECK (
    contact_info IS NULL OR (
      jsonb_typeof(contact_info) = 'object'
      AND coalesce(jsonb_typeof(contact_info -> 'email'), 'string') IN ('string', 'null')
      AND coalesce(jsonb_typeof(contact_info -> 'phone'), 'string') IN ('string', 'null')
      AND coalesce(jsonb_typeof(contact_info -> 'sku'), 'string') IN ('string', 'null')));
