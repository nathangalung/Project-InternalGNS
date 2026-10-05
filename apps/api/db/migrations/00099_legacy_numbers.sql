-- +goose Up
-- 00099 LEGACY NUMBERS
-- A document re-imported from the old spreadsheets carries the number it
-- was first issued under, so it can still be found by it: legacy_no on
-- quotations and invoices, and legacy_dn_no on purchase orders for the
-- delivery-note number printed on the original DO. Only an import writes
-- them; app-created documents and revisions leave them NULL.

ALTER TABLE quotations ADD COLUMN legacy_no TEXT
  CONSTRAINT quotations_legacy_no_not_blank CHECK (legacy_no IS NULL OR BTRIM(legacy_no) <> '');
ALTER TABLE invoices ADD COLUMN legacy_no TEXT
  CONSTRAINT invoices_legacy_no_not_blank CHECK (legacy_no IS NULL OR BTRIM(legacy_no) <> '');
ALTER TABLE purchase_orders ADD COLUMN legacy_dn_no TEXT
  CONSTRAINT purchase_orders_legacy_dn_no_not_blank CHECK (legacy_dn_no IS NULL OR BTRIM(legacy_dn_no) <> '');

COMMENT ON COLUMN quotations.legacy_no IS
  'Number the quotation was first issued under before re-import; NULL for app-created quotations.';
COMMENT ON COLUMN invoices.legacy_no IS
  'Number the invoice was first issued under before re-import; NULL for app-created invoices.';
COMMENT ON COLUMN purchase_orders.legacy_dn_no IS
  'Delivery-note number printed on the original DO before re-import; NULL for app-created POs.';

-- +goose Down

ALTER TABLE purchase_orders DROP COLUMN legacy_dn_no;
ALTER TABLE invoices DROP COLUMN legacy_no;
ALTER TABLE quotations DROP COLUMN legacy_no;
