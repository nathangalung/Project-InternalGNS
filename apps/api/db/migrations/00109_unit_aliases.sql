-- +goose Up
-- 00109 UNIT ALIASES
-- One unit per thing, whatever people call it. A unit keeps the short code
-- every document prints, and the other ways a client or vendor writes it
-- (PC, Pieces, EA, Can, Sheet) are aliases that resolve to that unit, so
-- nobody adds a second unit because the abbreviation differs. One text
-- names one unit: an alias never equals a code, and a code never equals an
-- alias. A database without master data yet takes the units and aliases
-- from the seed, so every statement below names units by code and skips
-- the ones it does not find. The section is safe to run again.

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_unit_text(p_text text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT NULLIF(btrim(regexp_replace(
           btrim(regexp_replace(upper(p_text), '\s+', ' ', 'g')),
           '\.+$', '')), '')
$function$;
-- +goose StatementEnd

CREATE TABLE IF NOT EXISTS unit_aliases (
  alias   VARCHAR(30) PRIMARY KEY,
  unit_id SMALLINT NOT NULL REFERENCES units(id) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_unit_aliases_unit_id ON unit_aliases (unit_id);

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.trg_fn_unit_alias_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  NEW.alias := fn_unit_text(NEW.alias);
  IF NEW.alias IS NULL THEN
    RAISE EXCEPTION 'Alias satuan tidak boleh kosong.'
      USING ERRCODE = 'check_violation';
  END IF;
  IF EXISTS (SELECT 1 FROM units WHERE fn_unit_text(code) = NEW.alias) THEN
    RAISE EXCEPTION 'Alias satuan % sudah dipakai sebagai kode satuan.', NEW.alias
      USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END;
$function$;
-- +goose StatementEnd

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.trg_fn_unit_code_guard()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  IF EXISTS (SELECT 1 FROM unit_aliases WHERE alias = fn_unit_text(NEW.code)) THEN
    RAISE EXCEPTION 'Kode satuan % sudah dipakai sebagai alias satuan.', NEW.code
      USING ERRCODE = 'unique_violation';
  END IF;
  RETURN NEW;
END;
$function$;
-- +goose StatementEnd

CREATE OR REPLACE TRIGGER trg_unit_alias_guard
  BEFORE INSERT OR UPDATE ON unit_aliases
  FOR EACH ROW EXECUTE FUNCTION trg_fn_unit_alias_guard();

CREATE OR REPLACE TRIGGER trg_unit_code_guard
  BEFORE INSERT OR UPDATE OF code ON units
  FOR EACH ROW EXECUTE FUNCTION trg_fn_unit_code_guard();

-- Two containers the team buys in.
INSERT INTO units (code, name, coretax_code)
SELECT v.code, v.name, 'UM.0033'
FROM (VALUES ('PAIL', 'Pail'), ('DRUM', 'Drum')) v(code, name)
WHERE EXISTS (SELECT 1 FROM units WHERE code = 'OTH')
ON CONFLICT (code) DO NOTHING;

-- Ship-supply units take the long form of their code. Units 1 to 33 keep
-- the Coretax names.
UPDATE units u SET name = v.name
FROM (VALUES
  ('TIN', 'Tin'), ('TUB', 'Tube'), ('PKT', 'Packet'), ('BTL', 'Bottle'),
  ('PRS', 'Pairs'), ('RLS', 'Rolls'), ('SPL', 'Spool'), ('LGH', 'Length'),
  ('COIL', 'Coil'), ('PAIL', 'Pail'), ('DRUM', 'Drum')
) v(code, name)
WHERE u.code = v.code AND u.name IS DISTINCT FROM v.name;

-- PACK is PKT. Its references move first, so the delete fails loudly on
-- RESTRICT rather than lose one if PKT were missing. A filed invoice keeps
-- the code it printed in unit_code.
UPDATE items i SET default_unit_id = pkt.id
FROM units pack, units pkt
WHERE pack.code = 'PACK' AND pkt.code = 'PKT' AND i.default_unit_id = pack.id;

UPDATE quotation_items qi SET unit_id = pkt.id
FROM units pack, units pkt
WHERE pack.code = 'PACK' AND pkt.code = 'PKT' AND qi.unit_id = pack.id;

UPDATE purchase_order_items poi SET unit_id = pkt.id
FROM units pack, units pkt
WHERE pack.code = 'PACK' AND pkt.code = 'PKT' AND poi.unit_id = pack.id;

UPDATE invoice_items ii SET unit_id = pkt.id, unit_code = COALESCE(ii.unit_code, pack.code)
FROM units pack, units pkt
WHERE pack.code = 'PACK' AND pkt.code = 'PKT' AND ii.unit_id = pack.id;

DELETE FROM units WHERE code = 'PACK';

-- Unit aliases
-- An ambiguous text stays out (MT is Metrik Ton, LB is also the pound),
-- so the user picks its unit instead of getting a wrong one.
INSERT INTO unit_aliases (alias, unit_id)
SELECT v.alias, u.id
FROM (VALUES
  ('PC', 'PCS'), ('PCE', 'PCS'), ('PIECE', 'PCS'), ('PIECES', 'PCS'),
  ('EA', 'PCS'), ('EACH', 'PCS'), ('BUAH', 'PCS'), ('BH', 'PCS'),
  ('UNITS', 'UNIT'),
  ('SETS', 'SET'),
  ('SHEET', 'LBR'), ('SHEETS', 'LBR'), ('SHT', 'LBR'), ('LEMBAR', 'LBR'),
  ('BOXES', 'BOX'), ('BX', 'BOX'), ('KOTAK', 'BOX'), ('DUS', 'BOX'),
  ('DZ', 'DOZ'), ('DOZEN', 'DOZ'), ('LUSIN', 'DOZ'), ('LSN', 'DOZ'),
  ('KGS', 'KG'), ('KILO', 'KG'), ('KILOGRAM', 'KG'),
  ('G', 'GR'), ('GRAM', 'GR'),
  ('L', 'LTR'), ('LT', 'LTR'), ('LITER', 'LTR'), ('LITRE', 'LTR'), ('LITERS', 'LTR'),
  ('METER', 'MTR'), ('METRE', 'MTR'), ('METERS', 'MTR'), ('MTRS', 'MTR'),
  ('CAN', 'TIN'), ('CANS', 'TIN'), ('KALENG', 'TIN'), ('TINS', 'TIN'),
  ('TUBE', 'TUB'), ('TUBES', 'TUB'),
  ('PACK', 'PKT'), ('PACKS', 'PKT'), ('PAX', 'PKT'), ('PAC', 'PKT'), ('PCK', 'PKT'),
  ('PK', 'PKT'), ('PAK', 'PKT'), ('PACKET', 'PKT'), ('PACKETS', 'PKT'), ('BUNGKUS', 'PKT'),
  ('BOTTLE', 'BTL'), ('BOTTLES', 'BTL'), ('BOTOL', 'BTL'),
  ('PR', 'PRS'), ('PAIR', 'PRS'), ('PASANG', 'PRS'), ('PSG', 'PRS'),
  ('ROLL', 'RLS'), ('ROLLS', 'RLS'), ('RL', 'RLS'), ('ROL', 'RLS'), ('GULUNG', 'RLS'),
  ('SPOOL', 'SPL'), ('SPOOLS', 'SPL'),
  ('LENGTH', 'LGH'), ('LENGTHS', 'LGH'), ('BATANG', 'LGH'), ('BTG', 'LGH'),
  ('COILS', 'COIL'),
  ('PAILS', 'PAIL'), ('EMBER', 'PAIL'),
  ('DRUMS', 'DRUM'), ('DRM', 'DRUM'),
  ('DAYS', 'DAY'), ('HARI', 'DAY'),
  ('HOUR', 'HR'), ('HOURS', 'HR'), ('JAM', 'HR')
) v(alias, code)
JOIN units u ON u.code = v.code
ON CONFLICT (alias) DO NOTHING;

-- +goose Down
DROP TABLE IF EXISTS unit_aliases;
DROP TRIGGER IF EXISTS trg_unit_code_guard ON units;
DROP FUNCTION IF EXISTS public.trg_fn_unit_code_guard();
DROP FUNCTION IF EXISTS public.trg_fn_unit_alias_guard();
DROP FUNCTION IF EXISTS public.fn_unit_text(text);

INSERT INTO units (code, name, coretax_code) VALUES ('PACK', 'Pack', 'UM.0033')
ON CONFLICT (code) DO NOTHING;

UPDATE units u SET name = v.name
FROM (VALUES
  ('TIN', 'Tin/Can'), ('PKT', 'Pack/Packet'), ('BTL', 'Botol/Bottle'),
  ('PRS', 'Pairs/Pasang'), ('RLS', 'Roll/Gulung'), ('LGH', 'Length/Batang')
) v(code, name)
WHERE u.code = v.code;

DELETE FROM units u WHERE u.code IN ('PAIL', 'DRUM')
  AND NOT EXISTS (SELECT 1 FROM quotation_items qi WHERE qi.unit_id = u.id)
  AND NOT EXISTS (SELECT 1 FROM purchase_order_items pi WHERE pi.unit_id = u.id)
  AND NOT EXISTS (SELECT 1 FROM invoice_items ii WHERE ii.unit_id = u.id)
  AND NOT EXISTS (SELECT 1 FROM items i WHERE i.default_unit_id = u.id);
