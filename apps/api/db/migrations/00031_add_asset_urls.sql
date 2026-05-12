-- +goose Up
-- +goose StatementBegin

-- Per-entity asset object keys (MinIO).
-- Stored as the raw object key, not a URL. Buckets are picked at the handler
-- layer per storage.Bucket* constants. Presigned GET/PUT URLs are minted on
-- demand and never persisted.

ALTER TABLE company_client
  ADD COLUMN logo_object_key TEXT;

COMMENT ON COLUMN company_client.logo_object_key IS
  'MinIO object key inside bucket client-logos. NULL = no logo uploaded.';

ALTER TABLE vendors
  ADD COLUMN logo_object_key TEXT;

COMMENT ON COLUMN vendors.logo_object_key IS
  'MinIO object key inside bucket vendor-logos. NULL = no logo uploaded.';

ALTER TABLE items
  ADD COLUMN image_object_key TEXT;

COMMENT ON COLUMN items.image_object_key IS
  'MinIO object key inside bucket item-images. NULL = no image uploaded.';

ALTER TABLE invoices
  ADD COLUMN attachment_object_key TEXT;

COMMENT ON COLUMN invoices.attachment_object_key IS
  'MinIO object key inside bucket invoice-attachments (e.g. payment receipt). NULL = no attachment.';

-- +goose StatementEnd


-- +goose Down
-- +goose StatementBegin

ALTER TABLE invoices       DROP COLUMN IF EXISTS attachment_object_key;
ALTER TABLE items          DROP COLUMN IF EXISTS image_object_key;
ALTER TABLE vendors        DROP COLUMN IF EXISTS logo_object_key;
ALTER TABLE company_client DROP COLUMN IF EXISTS logo_object_key;

-- +goose StatementEnd
