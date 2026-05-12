-- +goose Up
-- +goose StatementBegin

-- Refine the match_status COMMENT to clarify semantics for historical /
-- reverse-engineered backfills. Edit-in-place on migration 00022 would not
-- re-run via goose; this migration carries the comment update for already-
-- applied DBs.

COMMENT ON COLUMN quotation_item_requests.match_status IS
  'pending=awaiting review; matched=catalog item identified, offer text matches client request text; substituted=catalog item identified, but offer text differs from client request text (e.g. "Cement High Temperature" offered for "Semen cor tahan api" request); unavailable=cannot fulfill from current catalog (either RFQ rejected, or historical/reverse-engineered quote where matched_item_id is NULL because the item was never added to master). "confirmed" is derived from EXISTS quotation_items.request_id.';

-- +goose StatementEnd


-- +goose Down
-- +goose StatementBegin

-- Restore the original (less precise) wording from migration 00022.
COMMENT ON COLUMN quotation_item_requests.match_status IS
  'pending=awaiting review, matched=item identified 1:1, substituted=offered item differs from matched, unavailable=cannot fulfill (no quotation_items created). "confirmed" is derived from EXISTS quotation_items.request_id.';

-- +goose StatementEnd
