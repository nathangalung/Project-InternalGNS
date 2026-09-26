-- +goose Up

-- 00051 QUOTATION LINES NEED A QUANTITY
-- A qty 0 line survived create, send and accept, and produced a purchase
-- order line with nothing to deliver. The old CHECK allowed qty >= 0.
-- Added NOT VALID: existing rows are left alone, every insert and update
-- from now on is checked. Validation runs once the historical rows are
-- cleaned up, which is a separate decision.

ALTER TABLE quotation_items DROP CONSTRAINT IF EXISTS quotation_items_qty_check;

ALTER TABLE quotation_items
  ADD CONSTRAINT quotation_items_qty_check CHECK (qty > 0) NOT VALID;

-- +goose Down

ALTER TABLE quotation_items DROP CONSTRAINT IF EXISTS quotation_items_qty_check;

ALTER TABLE quotation_items
  ADD CONSTRAINT quotation_items_qty_check CHECK (qty >= 0);
