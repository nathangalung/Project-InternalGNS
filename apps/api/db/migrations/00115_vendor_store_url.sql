-- +goose Up
-- 00115 VENDOR STORE LINK
-- A vendor keeps its own shop address (Link Toko), apart from the product
-- link each vendor and product pair keeps in vendor_products.product_url
-- (Link Produk). The API stores only an http or https address.
ALTER TABLE vendors ADD COLUMN store_url TEXT;

COMMENT ON COLUMN vendors.store_url IS
  'The vendor''s own shop address (Link Toko). NULL when none is known.';

-- +goose Down
ALTER TABLE vendors DROP COLUMN IF EXISTS store_url;
