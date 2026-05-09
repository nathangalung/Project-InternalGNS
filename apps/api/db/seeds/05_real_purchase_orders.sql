-- Real customer POs sourced from D:\quotation\existing_po\ (PDFs + KAS pptx
-- scans) and corrected against D:\quotation\invoice_and_do\ when the invoice
-- file confirmed a different PO number than the (often blurry) source scan.
--
-- Runs after 04_quotation_states.sql, which has already:
--   * Promoted these 57 quotations to 'accepted' (auto-creating each one's
--     PO via fn_create_purchase_order, with a placeholder po_number from
--     fn_next_doc_no and po_date = CURRENT_DATE).
--   * Snapshotted quotation_items into purchase_order_items.
--   * Rejected every other quotation.
--
-- This seed simply UPDATEs the placeholder po_number / po_date with the real
-- customer values. po_items remain untouched because they already mirror
-- quotation_items.
--
-- Idempotent: re-runs only re-write the same fields with the same values.

BEGIN;

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
  (605, 'JKT-PO/075.112/A05/0326',         '2026-03-11', 4),  -- Power Supply Diamond GZV4000 / TB AMAN 05  (was A06 in seed; file 042 says A05)
  (557, 'JKT-PO/057.077/A01/0226',         '2026-02-23', 4),  -- Module GC250 Sices / TB AMAN 01            (was Q-569 — wrong qid; Q-557 is the actual Module quotation)
  (593, 'JKT-PO/065.086/M12/0326',         '2026-03-02', 4),  -- Nozzle Cleaner Gun / TB MARINA 12
  (646, 'JKT-PO/126.185/A06/0426',         '2026-04-28', 4),  -- Cummin Vbelt + Hose Long Pit + Bohlam / TB AMAN 06  (file 056)
  (668, 'JKT-PO/005.005/OFFICE/0126',      '2026-01-13', 4),  -- Relay Schneider RXM4AB2P7 / OFFICE          (file 016, Q-668 from 03b)
  (669, 'JKT-PO/022.038/M/12/0226',        '2026-02-03', 4),  -- ComAp Inteli Nano Module bundle / OFFICE    (file 025+026, Q-669 from 03b)
  -- Karunia Aman Selalu (id=5)
  (611, 'JKT-PO/046.123/KAS/IV/26/M25',    '2026-04-07', 5),  -- Breaker MCCB / TB MARINA 25
  (614, 'JKT-PO/053.115/KAS/III/26/M18',   '2026-03-31', 5),  -- Racor 2040+2010 / TB MARINA 18
  (640, 'JKT-PO/069.145/KAS/IV/26/OFFICE', '2026-04-16', 5),  -- Magnaflux Spot Check / OFFICE
  (654, 'JKT-PO/075.162/KAS/IV/26/M01',    '2026-04-29', 5),  -- Vbelt AE 3911588 / TB MORA 01              (was 075.182 best-guess; file 054 says 075.162)
  (486, 'JKT-PO/158.376/KAS/XII/25/M18',   '2025-12-31', 5),  -- Hose BBM + Racor / TB MARINA 18
  (478, 'JKT-PO/153.018/KAS/I/26/OFFICE',  '2026-01-13', 5),  -- Relay Schneider RXM4AB2P7 / OFFICE         (file 015 has typos OOFICE+153.015; canonical from existing_po PDF)
  (481, 'JKT-PO/003.013/KAS/I/26/M25',     '2026-01-12', 5),  -- Roller Stator Danfoss RE-540 / TB MARINA 25 (was 021.011 + "Rudder Stator" — both wrong; file 036 confirms)
  (571, 'JKT-PO/033.073/KAS/II/26/M01',    '2026-02-25', 5),  -- Relay / TB MORA 01
  (645, 'JKT-PO/045.118/KAS/IV/26/M04',    '2026-04-01', 5),  -- Vbelt Ribbed C3911588 / TB MORA 04         (was 043.131 best-guess; file 045 says 045.118)
  (619, 'JKT-PO/061.129/KAS/IV/26/OFFICE', '2026-04-09', 5),  -- Dial Bore Gauge / OFFICE                   (was 059.122 best-guess; file 047 says 061.129)
  -- IMC Ship Management (id=1)
  (555, '8404/O-0165/P026',                '2026-02-11', 1),  -- Compressor United / Yuxin Satu (replacement)
  (643, '8404/O-0198/P026',                '2026-04-17', 1),  -- PUMA Kompresor / Yuxin Satu
  -- Niterra Mobility Indonesia (id=6)
  (552, 'ID-000016764',                    '2026-02-19', 6),  -- O-Ring NOK x3
  (589, 'ID-000017257',                    '2026-04-17', 6),  -- Seal Set Cylinder New Era
  (604, 'ID-000016939',                    '2026-03-10', 6),  -- Oil Seal NOK TC 25x40x7                    (file 044)
  (587, 'ID-000017238',                    '2026-04-14', 6),  -- Ring Kotak 220*233*2                       (file 050)
  -- Transcoal Pasific (id=12)
  (490, 'PO-TCP/I/2026-00026',             '2026-01-05', 12), -- Rubber Hose Maxxflex / DLS FC 01
  (489, 'PO-TCP/XII/2025-00540',           '2025-12-30', 12), -- Reducer Stainless / TCP Pioneer
  (488, 'PO-TCP/XII/2025-00358',           '2025-12-30', 12), -- Service: Transport to Sangatta             (file 10611, service invoice)
  -- Sentra Makmur Lines (id=2)
  (530, 'PO-SML/II/2026-00004',            '2026-02-03', 2),  -- Gland Packing Pilar 6501L / Aliyah Permata
  (576, 'PO-SML/III/2026-00008',           '2026-03-03', 2),  -- O-ring Viton / Aliyah Permata
  -- Kasen Maritim Logistik (id=9)
  (660, 'JKT-PO/033.056/KML/V/26/FCKML',   '2026-05-04', 9),  -- Flow Meter / FCKML                          (file 057)
  -- Pelita Global Logistik (id=3)
  (624, 'V-26-2403-039-D/05/01',           '2026-04-16', 3),  -- Binocular Nikon Oceanpro
  (565, 'V-26-2403-040-D/01/01',           '2026-02-12', 3),  -- Cardboard
  (649, 'V-26-2402-274-D/05/02',           '2026-04-23', 3),  -- Obat
  (647, 'O-26-2402-041-D/01/01',           '2026-04-17', 3),  -- Service: Delivery + Boat Cilegon
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
  (549, 'V-26-2405-125-E/01/02',           '2026-02-02', 3),  -- Gate Valve / FINAL revision (latest = /01/02; file 021 typed /01/01)
  (520, 'V-26-2405-030-E/03/01',           '2026-01-15', 3); -- Gate Valve F-7363 250mm

-- UPDATE the placeholder po_number / po_date that 04_quotation_states.sql
-- got from fn_create_purchase_order with the real customer values.
UPDATE purchase_orders po
   SET po_number  = r.po_number,
       po_date    = r.po_date,
       updated_by = COALESCE(po.updated_by, po.created_by)
  FROM _real_po r
 WHERE po.quotation_id = r.quotation_id;

-- Sanity: every entry in _real_po must match exactly one updated row.
DO $$
DECLARE n_missing INT;
BEGIN
  SELECT count(*) INTO n_missing
    FROM _real_po r
    LEFT JOIN purchase_orders po ON po.quotation_id = r.quotation_id
   WHERE po.id IS NULL;
  IF n_missing > 0 THEN
    RAISE EXCEPTION 'seed 05: % real-PO entries have no corresponding purchase_order (04_quotation_states.sql ran?)', n_missing;
  END IF;
END $$;

COMMIT;
