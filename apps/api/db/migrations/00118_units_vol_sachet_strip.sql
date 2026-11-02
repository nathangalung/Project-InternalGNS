-- +goose Up
-- 00118 VOLUME, SACHET AND STRIP
-- Three units the team buys in: a volume of a publication (tide tables,
-- almanacs, log books), a sachet, and a strip of tablets. Each keeps a
-- short printed code and maps to UM.0033 like the other ship-supply units.
-- A database without master data yet takes them from the seed, so every
-- statement names units by code and skips what it does not find.

INSERT INTO units (code, name, coretax_code)
SELECT v.code, v.name, 'UM.0033'
FROM (VALUES ('VOL', 'Volume'), ('SCT', 'Sachet'), ('STRP', 'Strip')) v(code, name)
WHERE EXISTS (SELECT 1 FROM units WHERE code = 'OTH')
ON CONFLICT (code) DO NOTHING;

-- Unit aliases
INSERT INTO unit_aliases (alias, unit_id)
SELECT v.alias, u.id
FROM (VALUES
  ('VOLUME', 'VOL'), ('VOLS', 'VOL'),
  ('SACHET', 'SCT'), ('SACHETS', 'SCT'), ('SACH', 'SCT'),
  ('STRIP', 'STRP'), ('STRIPS', 'STRP'), ('STIP', 'STRP')
) v(alias, code)
JOIN units u ON u.code = v.code
ON CONFLICT (alias) DO NOTHING;

-- +goose Down
DELETE FROM unit_aliases
WHERE alias IN ('VOLUME', 'VOLS', 'SACHET', 'SACHETS', 'SACH', 'STRIP', 'STRIPS', 'STIP');
DELETE FROM units WHERE code IN ('VOL', 'SCT', 'STRP');
