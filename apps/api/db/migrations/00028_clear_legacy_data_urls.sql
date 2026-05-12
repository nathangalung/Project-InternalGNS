-- +goose Up
-- +goose StatementBegin

-- Pre-MinIO rows stored base64 data URLs in file_url.
-- After object-key reinterpretation those bytes are meaningless;
-- null them so downloads return 404 instead of corrupted blobs.
UPDATE purchase_orders
   SET file_url = NULL
 WHERE file_url LIKE 'data:%';

-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin

-- No-op. Data URLs cannot be reconstructed once nulled.
SELECT 1;

-- +goose StatementEnd
