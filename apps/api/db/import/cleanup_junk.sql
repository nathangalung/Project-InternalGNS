-- One-shot cleanup for known parser artifacts in the historical import.
-- Safe to re-run: each step is idempotent (filters by content, not by id).
--
-- Fixes two issues identified after the initial historical-data load:
--   A. 16 'items' rows that are actually page-2+ header residue from the
--      DATA ENTRI sheet (Q-no, customer name, date, PIC, page markers).
--      None are referenced by any quotation_items.
--   B. Vendor rows with template-residue names ('Rp.' currency prefix, '-',
--      and short stub like 'MD'). Vendor cell at col 13 sometimes captures
--      the literal 'Rp.' string from the template instead of an actual
--      vendor name. quotation_items.vendor_product_id is set to NULL for
--      affected lines (item still keeps its description / sell / cost), and
--      the bad vendor_products + vendors are then deleted.

BEGIN;

-- B. Bad vendors first (so item-junk delete in A doesn't run into FK)
-- ---------------------------------------------------------------
-- 1. Drop vendor_product link from quotation_items (no info loss; the item
--    description, qty, prices stay on the quotation_item itself).
UPDATE quotation_items qi
   SET vendor_product_id = NULL
 WHERE vendor_product_id IN (
       SELECT vp.id FROM vendor_products vp
       JOIN vendors v ON v.id = vp.vendor_id
        WHERE v.name ~ '^Rp\.?$' OR v.name = '-' OR LENGTH(TRIM(v.name)) <= 2
 );

-- 2. Delete vendor_products belonging to bad vendors.
DELETE FROM vendor_products vp USING vendors v
 WHERE vp.vendor_id = v.id
   AND (v.name ~ '^Rp\.?$' OR v.name = '-' OR LENGTH(TRIM(v.name)) <= 2);

-- 3. Delete the bad vendors themselves.
DELETE FROM vendors
 WHERE name ~ '^Rp\.?$' OR name = '-' OR LENGTH(TRIM(name)) <= 2;


-- A. Junk items (orphan, never referenced by quotation_items)
-- ---------------------------------------------------------------
-- 1. Defensive: drop any vendor_product still pointing at junk items
--    (one such row exists from the initial load).
DELETE FROM vendor_products vp USING items i
 WHERE vp.item_id = i.id
   AND NOT EXISTS (
        SELECT 1 FROM quotation_items qi
         WHERE qi.offered_item_id = i.id OR qi.requested_item_id = i.id
   )
   AND (
        i.name ~ '^Q-\d+'                                         -- Q-number
     OR i.name ILIKE 'Jakarta,%'                                  -- date line
     OR i.name ~ '^\d+\s*OF\s*\d+$'                               -- 'X OF Y'
     OR i.name ~ '^[A-Z](\s[A-Z]){3,}'                            -- 'D E S C R I P T I O N'
     OR i.name = 'Ready stock'
     OR i.name LIKE 'PT.%'                                        -- customer name
     OR i.name ILIKE 'Bapak %' OR i.name ILIKE 'Ibu %'
     OR i.name ILIKE 'Bp. %' OR i.name ILIKE 'Bpk %'
     OR i.name ~ '^[\w.+-]+@[\w-]+\.[\w.-]+$'                     -- email
     OR i.name ILIKE 'HAZARD SIGN%'
     OR i.name ILIKE 'Safety shoes brand king%'                   -- one-off junk
     OR i.name = 'No Offer'
   );

-- 2. Delete the junk items.
DELETE FROM items i
 WHERE NOT EXISTS (
        SELECT 1 FROM quotation_items qi
         WHERE qi.offered_item_id = i.id OR qi.requested_item_id = i.id
   )
   AND (
        i.name ~ '^Q-\d+'
     OR i.name ILIKE 'Jakarta,%'
     OR i.name ~ '^\d+\s*OF\s*\d+$'
     OR i.name ~ '^[A-Z](\s[A-Z]){3,}'
     OR i.name = 'Ready stock'
     OR i.name LIKE 'PT.%'
     OR i.name ILIKE 'Bapak %' OR i.name ILIKE 'Ibu %'
     OR i.name ILIKE 'Bp. %' OR i.name ILIKE 'Bpk %'
     OR i.name ~ '^[\w.+-]+@[\w-]+\.[\w.-]+$'
     OR i.name ILIKE 'HAZARD SIGN%'
     OR i.name ILIKE 'Safety shoes brand king%'
     OR i.name = 'No Offer'
   );

COMMIT;
