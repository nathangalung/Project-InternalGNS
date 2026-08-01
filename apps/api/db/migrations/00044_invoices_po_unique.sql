-- +goose NO TRANSACTION

-- +goose Up
-- One invoice per PO was enforced only by fn_change_po_status taking FOR UPDATE
-- before fn_create_invoice's unlocked idempotency SELECT — a property of one
-- call path, not of the data. Make it a schema invariant. Partial (po_id may be
-- NULL). Drop-then-create so a retry after an interrupted CONCURRENTLY build
-- repairs an INVALID leftover instead of skipping it by name. The plain
-- idx_invoices_po is then redundant (the unique index serves po_id lookups).
DROP INDEX IF EXISTS uq_invoices_po_id;
CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_invoices_po_id
  ON invoices (po_id) WHERE po_id IS NOT NULL;
DROP INDEX CONCURRENTLY IF EXISTS idx_invoices_po;

-- +goose Down
DROP INDEX CONCURRENTLY IF EXISTS uq_invoices_po_id;
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_po ON invoices (po_id);
