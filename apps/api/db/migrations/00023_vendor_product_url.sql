-- +goose Up
-- +goose StatementBegin

ALTER TABLE vendor_products
  ADD COLUMN product_url TEXT;

COMMENT ON COLUMN vendor_products.product_url IS
  'Optional URL to the product page on the vendor site (e.g. catalog listing, quote reference). NULL = not provided.';

-- +goose StatementEnd


-- +goose Down
-- +goose StatementBegin

ALTER TABLE vendor_products
  DROP COLUMN IF EXISTS product_url;

-- +goose StatementEnd
