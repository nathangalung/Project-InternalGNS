-- +goose Up
-- 00111 UNIT ALIASES FROM THE IMPORT
-- The spellings the old workbooks use for units the catalog has, so the
-- import (db/import/unit_map.py reads the master seed) and the app resolve
-- them alike: a C/T carton is a box, a DZN a dozen, C/L a coil, M a metre,
-- PAIRS a pair.
-- A unit missing from a database without master data yet is skipped, as
-- in 00109.

-- Unit aliases
INSERT INTO unit_aliases (alias, unit_id)
SELECT v.alias, u.id
FROM (VALUES
  ('M', 'MTR'),
  ('DUZ', 'BOX'), ('CTN', 'BOX'), ('CASE', 'BOX'), ('CARTON', 'BOX'), ('C/T', 'BOX'),
  ('DZN', 'DOZ'), ('DOSEN', 'DOZ'),
  ('C/L', 'COIL'),
  ('PAIRS', 'PRS')
) v(alias, code)
JOIN units u ON u.code = v.code
ON CONFLICT (alias) DO NOTHING;

-- +goose Down
DELETE FROM unit_aliases
WHERE alias IN ('M', 'DUZ', 'CTN', 'CASE', 'CARTON', 'C/T', 'DZN', 'DOSEN', 'C/L', 'PAIRS');
