-- Replace auto-generated PO data with the 50 real customer POs from
-- D:\quotation\existing_po\ (PDFs + KAS pptx scans + 1 jpeg).
--
-- Runs after 04_demo_po_invoice.sql, which promotes ~60% of quotations to
-- 'accepted' and creates auto-POs via fn_change_quotation_status.
--
-- Strategy per row (quotation_id, po_number, po_date, customer_id):
--   * If a PO already exists for the quotation -> UPDATE po_number/po_date.
--   * Else -> INSERT new PO with status='PENDING'.
--   * Either way -> wipe existing po_items and rebuild them by copying from
--     quotation_items (snapshot the quote contents).
--
-- Auto-POs that exist for un-mapped quotations (and orphans like the offer
-- version Q-547 of V-26-2405-125-E) are left alone.
--
-- Idempotent: safe to re-run alongside 03_historical.sql / 04_demo_po_invoice.sql.

BEGIN;

-- 50 real PO mappings extracted from existing_po/ folder.
-- Format: (quotation_id, po_number, po_date, company_client_id)
CREATE TEMP TABLE _real_po (
  quotation_id      BIGINT       PRIMARY KEY,
  po_number         VARCHAR(50)  NOT NULL,
  po_date           DATE         NOT NULL,
  company_client_id BIGINT       NOT NULL
) ON COMMIT DROP;

INSERT INTO _real_po VALUES
  -- Karunia Aman Sentosa (id=4)
  (544, 'JKT-PO/031.034/A01/0226',         '2026-02-02', 4),  -- Siemens UVR / TB AMAN 01
  (526, 'JKT-PO/018.017/A01/0126',         '2026-01-20', 4),  -- Rudder Seafirst / TB AMAN 01
  (556, 'JKT-PO/055.069/OFFICE/0226',      '2026-02-20', 4),  -- Coil Selenoid / OFFICE
  (605, 'JKT-PO/075.112/A06/0326',         '2026-03-11', 4),  -- Power Supply Diamond / TB AMAN 06
  (569, 'JKT-PO/057.077/A01/0226',         '2026-02-23', 4),  -- Modul Sirex GC250 / TB AMAN 01
  (593, 'JKT-PO/065.086/M12/0326',         '2026-03-02', 4),  -- Nozzle Cleaner Gun / TB MARINA 12
  -- Karunia Aman Selalu (id=5) — best-guess PO numbers where pptx scan was blurry
  (611, 'JKT-PO/046.123/KAS/IV/26/M25',    '2026-04-07', 5),  -- Breaker MCCB / TB MARINA 25
  (614, 'JKT-PO/053.115/KAS/III/26/M18',   '2026-03-31', 5),  -- Racor 2040+2010 / TB MARINA 18
  (640, 'JKT-PO/069.145/KAS/IV/26/OFFICE', '2026-04-16', 5),  -- Magnaflux Spot Check / OFFICE
  (654, 'JKT-PO/075.182/KAS/IV/26/M01',    '2026-04-29', 5),  -- Vbelt / TB MORA 01
  (486, 'JKT-PO/158.376/KAS/XII/25/M18',   '2025-12-31', 5),  -- Hose BBM + Racor / TB MARINA 18
  (478, 'JKT-PO/153.018/KAS/I/26/OFFICE',  '2026-01-13', 5),  -- Relay Schneider / OFFICE
  (481, 'JKT-PO/021.011/KAS/I/26/M25',     '2026-01-12', 5),  -- Rudder Stator / TB MARINA 25  (PO# best-guess)
  (571, 'JKT-PO/033.073/KAS/II/26/M01',    '2026-02-25', 5),  -- Relay / TB MORA 01
  (645, 'JKT-PO/043.131/KAS/IV/26/M04',    '2026-04-01', 5),  -- Vbelt / TB MORA 04         (PO# best-guess)
  (619, 'JKT-PO/059.122/KAS/IV/26/OFFICE', '2026-04-09', 5),  -- Dial Bore Gauge / OFFICE   (PO# best-guess)
  -- IMC Ship Management (id=1)
  (555, '8404/O-0165/P026',                '2026-02-11', 1),  -- Compressor United / Yuxin Satu (replacement)
  (643, '8404/O-0198/P026',                '2026-04-17', 1),  -- PUMA Kompresor / Yuxin Satu
  -- Niterra Mobility Indonesia (id=6)
  (552, 'ID-000016764',                    '2026-02-19', 6),  -- O-Ring NOK x3
  (589, 'ID-000017257',                    '2026-04-17', 6),  -- Seal Set Cylinder New Era
  -- Transcoal Pasific (id=12)
  (490, 'PO-TCP/I/2026-00026',             '2026-01-05', 12), -- Rubber Hose Maxxflex / DLS FC 01
  (489, 'PO-TCP/XII/2025-00540',           '2025-12-30', 12), -- Reducer Stainless / TCP Pioneer
  -- Sentra Makmur Lines (id=2)
  (530, 'PO-SML/II/2026-00004',            '2026-02-03', 2),  -- Gland Packing Pilar 6501L / Aliyah Permata
  (576, 'PO-SML/III/2026-00008',           '2026-03-03', 2),  -- O-ring Viton / Aliyah Permata
  -- Pelita Global Logistik (id=3)
  (624, 'V-26-2403-039-D/05/01',           '2026-04-16', 3),  -- Binocular Nikon Oceanpro
  (565, 'V-26-2403-040-D/01/01',           '2026-02-12', 3),  -- Cardboard
  (649, 'V-26-2402-274-D/05/02',           '2026-04-23', 3),  -- Obat
  (647, 'O-26-2402-041-D/01/01',           '2026-04-17', 3),  -- Service: Delivery + Boat
  (641, 'V-26-2402-056-D/06/01',           '2026-04-13', 3),  -- Wharf Ladder + Pilot Ladder
  (568, 'V-26-2402-054-D/05/01',           '2026-02-19', 3),  -- Hatch Cover Tape
  (537, 'V-26-2405-086-E/03/01',           '2026-01-27', 3),  -- FL Lamp Holder + Ceiling Lights
  (548, 'V-26-2405-082-D/03/01',           '2026-01-29', 3),  -- Marine Hand Radio Entel
  (573, 'V-26-2405-191-E/01/01',           '2026-02-18', 3),  -- Vacuum Pump + Gauge Manifold (chose Q-573 over Q-574)
  (492, 'V-26-2405-002-E/02/01',           '2026-01-05', 3),  -- Inkjet Printer Epson
  (575, 'V-26-2405-149-E/01/01',           '2026-02-18', 3),  -- Freon R.407
  (528, 'V-26-2405-070-E/01/01',           '2026-01-26', 3),  -- Angle Valve F-7308 125mm
  (523, 'V-26-2405-056-E/01/02',           '2026-01-20', 3),  -- Butterfly Valve Wafer DN150
  (509, 'V-26-2405-029-E/05/01',           '2026-01-12', 3),  -- Butterfly DIN PN10 400mm
  (512, 'V-25-2405-292-D/05/01',           '2026-01-08', 3),  -- Mini Roller / Demolition Hammer / etc
  (543, 'V-26-2405-085-E/07/01',           '2026-01-28', 3),  -- Check Valve DIN Bronze 125mm
  (491, 'V-26-2405-005-E/02/01',           '2026-01-05', 3),  -- LED Floodlight 100W
  (519, 'V-26-2405-062-E/01/01',           '2026-01-15', 3),  -- Impeller Emergency Fire Pump
  (524, 'V-26-2405-063-E/02/01',           '2026-01-20', 3),  -- Angle/Globe Valve Bronze
  (522, 'V-26-2405-051-E/01/01',           '2026-01-18', 3),  -- Butterfly Valve 8" Wafer
  (500, 'V-26-2405-010-D/02/01',           '2026-01-06', 3),  -- Impact Wrench Cordless
  (506, 'V-25-2405-087-E/02/01',           '2026-01-09', 3),  -- 48-item ENGINE STORE bundle
  (498, 'V-25-2405-376-D/02/01',           '2026-01-05', 3),  -- Boilersuit Cotton x4 sizes
  (542, 'V-26-2405-044-E/06/01',           '2026-01-29', 3),  -- 33-item bundle (Pressure Gauge etc)
  (549, 'V-26-2405-125-E/01/02',           '2026-02-02', 3),  -- Gate Valve / FINAL revision (linked to Q-549, not Q-547 offer)
  (520, 'V-26-2405-030-E/03/01',           '2026-01-15', 3); -- Gate Valve F-7363 250mm

-- 1. UPDATE existing auto-POs with real PO data.
UPDATE purchase_orders po
   SET po_number  = r.po_number,
       po_date    = r.po_date,
       updated_by = po.created_by
  FROM _real_po r
 WHERE po.quotation_id = r.quotation_id;

-- 2. INSERT real POs for quotations that don't have one yet
--    (i.e. not promoted to 'accepted' by 04_demo_po_invoice.sql).
INSERT INTO purchase_orders
  (po_number, quotation_id, company_client_id, po_date, status,
   created_by, updated_by, discount_pct)
SELECT r.po_number, r.quotation_id, r.company_client_id, r.po_date, 'PENDING',
       q.created_by, q.created_by, 0.00
  FROM _real_po r
  JOIN quotations q ON q.id = r.quotation_id
 WHERE NOT EXISTS (
   SELECT 1 FROM purchase_orders po WHERE po.quotation_id = r.quotation_id
 );

-- 3. Rebuild po_items: wipe + repopulate from quotation_items snapshot.
DELETE FROM purchase_order_items
 WHERE po_id IN (
   SELECT po.id FROM purchase_orders po
    JOIN _real_po r ON r.quotation_id = po.quotation_id
 );

INSERT INTO purchase_order_items
  (po_id, quotation_item_id, line_number, item_type, offered_item_id,
   qty, unit_id, selling_price, cost_price, is_available,
   created_by, updated_by, discount_pct)
SELECT po.id, qi.id, qi.line_number, qi.item_type, qi.offered_item_id,
       qi.qty, qi.unit_id, qi.selling_price, qi.cost_price, qi.is_available,
       po.created_by, po.created_by, qi.discount_pct
  FROM purchase_orders po
  JOIN _real_po r        ON r.quotation_id = po.quotation_id
  JOIN quotation_items qi ON qi.quotation_id = po.quotation_id
 ORDER BY po.id, qi.line_number;

COMMIT;
