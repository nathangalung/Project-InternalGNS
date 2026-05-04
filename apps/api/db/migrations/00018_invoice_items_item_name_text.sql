-- +goose Up
-- +goose StatementBegin

-- 00018 INVOICE_ITEMS.ITEM_NAME -> TEXT
-- fn_create_invoice (00015) snapshots quotation_items.requested_name (TEXT)
-- into invoice_items.item_name (VARCHAR(500)). Historical client requests
-- exceed 500 chars (max observed 3005), so PO transitions to DELIVERED fail
-- on auto-invoice creation. Widen the column to TEXT to match the source.

ALTER TABLE invoice_items ALTER COLUMN item_name TYPE TEXT;

-- +goose StatementEnd


-- +goose Down
-- +goose StatementBegin

ALTER TABLE invoice_items ALTER COLUMN item_name TYPE VARCHAR(500);

-- +goose StatementEnd
