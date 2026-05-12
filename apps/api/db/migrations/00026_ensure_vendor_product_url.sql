-- +goose Up
-- +goose StatementBegin

-- Idempotent reapply when drifted.
ALTER TABLE vendor_products
  ADD COLUMN IF NOT EXISTS product_url TEXT;

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

-- Down is a no-op.
SELECT 1;

-- +goose StatementEnd
