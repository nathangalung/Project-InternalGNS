-- +goose Up
-- 00119 PROFIT PCT RANGE
-- A line's profit_pct is (harga jual - harga beli) / harga beli, generated
-- on quotation_items and purchase_order_items. NUMERIC(7,4) since 00001
-- holds less than 1000, so any line whose harga jual is more than 1001 times
-- its harga beli failed its save with SQLSTATE 22003 (cost 1.000 against
-- harga jual 1.100.000, or a harga beli typed 400.000 that an older web read
-- as 400). Both prices are NUMERIC(15,2), so the ratio stays below 10^15:
-- NUMERIC(19,4) holds every value the prices can make. No view or function
-- depends on the column type, and every stored value keeps its digits.
-- Both tables are rewritten under an exclusive lock.

ALTER TABLE quotation_items ALTER COLUMN profit_pct TYPE NUMERIC(19,4);
ALTER TABLE purchase_order_items ALTER COLUMN profit_pct TYPE NUMERIC(19,4);

-- +goose Down
-- Refused while a stored line needs the wider range.
ALTER TABLE purchase_order_items ALTER COLUMN profit_pct TYPE NUMERIC(7,4);
ALTER TABLE quotation_items ALTER COLUMN profit_pct TYPE NUMERIC(7,4);
