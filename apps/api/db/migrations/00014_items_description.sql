-- +goose Up
-- +goose StatementBegin
ALTER TABLE items
  ADD COLUMN description TEXT;
-- +goose StatementEnd

-- +goose Down
-- +goose StatementBegin
ALTER TABLE items
  DROP COLUMN description;
-- +goose StatementEnd
