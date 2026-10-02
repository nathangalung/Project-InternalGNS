-- +goose Up

-- 00080 NUMERIC INPUT CHECKS
-- Postgres sorts NaN above every number, so NaN passes the >= 0 and > 0
-- CHECKs the line tables already carry, and one NaN line turns every total
-- of its quotation, PO and invoice into NaN. Infinity needs no check: a
-- numeric(p,s) column cannot hold it. A negative harga beli books a profit
-- nobody made, and a validity below one day lets the expiry job end a sent
-- quotation at once. NULL passes every CHECK, so optional values stay
-- optional. The handlers screen all of this first (shared/validate); these
-- keep every other writer out.

ALTER TABLE quotation_items
  ADD CONSTRAINT quotation_items_qty_not_nan CHECK (qty <> 'NaN'),
  ADD CONSTRAINT quotation_items_selling_price_not_nan CHECK (selling_price <> 'NaN'),
  ADD CONSTRAINT quotation_items_cost_price_check CHECK (cost_price >= 0 AND cost_price <> 'NaN'),
  ADD CONSTRAINT quotation_items_shipping_days_check CHECK (shipping_days > 0);

ALTER TABLE purchase_order_items
  ADD CONSTRAINT purchase_order_items_qty_not_nan CHECK (qty <> 'NaN'),
  ADD CONSTRAINT purchase_order_items_selling_price_not_nan CHECK (selling_price <> 'NaN'),
  ADD CONSTRAINT purchase_order_items_cost_price_check CHECK (cost_price >= 0 AND cost_price <> 'NaN'),
  ADD CONSTRAINT purchase_order_items_shipping_days_check CHECK (shipping_days > 0);

ALTER TABLE invoice_items
  ADD CONSTRAINT invoice_items_qty_not_nan CHECK (qty <> 'NaN'),
  ADD CONSTRAINT invoice_items_unit_price_not_nan CHECK (unit_price <> 'NaN'),
  ADD CONSTRAINT invoice_items_gross_unit_price_check CHECK (gross_unit_price >= 0 AND gross_unit_price <> 'NaN'),
  ADD CONSTRAINT invoice_items_cost_price_check CHECK (cost_price >= 0 AND cost_price <> 'NaN');

-- fn_prepare_quotation_lines copies a line's harga beli here.
ALTER TABLE vendor_products
  ADD CONSTRAINT vendor_products_cost_price_not_nan CHECK (cost_price <> 'NaN');

ALTER TABLE quotations
  ADD CONSTRAINT quotations_validity_days_check CHECK (validity_days > 0);

-- +goose Down

ALTER TABLE quotations DROP CONSTRAINT quotations_validity_days_check;
ALTER TABLE vendor_products DROP CONSTRAINT vendor_products_cost_price_not_nan;
ALTER TABLE invoice_items
  DROP CONSTRAINT invoice_items_cost_price_check,
  DROP CONSTRAINT invoice_items_gross_unit_price_check,
  DROP CONSTRAINT invoice_items_unit_price_not_nan,
  DROP CONSTRAINT invoice_items_qty_not_nan;
ALTER TABLE purchase_order_items
  DROP CONSTRAINT purchase_order_items_shipping_days_check,
  DROP CONSTRAINT purchase_order_items_cost_price_check,
  DROP CONSTRAINT purchase_order_items_selling_price_not_nan,
  DROP CONSTRAINT purchase_order_items_qty_not_nan;
ALTER TABLE quotation_items
  DROP CONSTRAINT quotation_items_shipping_days_check,
  DROP CONSTRAINT quotation_items_cost_price_check,
  DROP CONSTRAINT quotation_items_selling_price_not_nan,
  DROP CONSTRAINT quotation_items_qty_not_nan;
