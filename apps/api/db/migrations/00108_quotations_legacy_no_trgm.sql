-- +goose NO TRANSACTION

-- The quotation list search ORs the client name, the number and, since
-- 00099, legacy_no. With no index on legacy_no the planner cannot combine
-- the other two trigram indexes (00034) and scans the whole table.

-- +goose Up
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_quotations_legacy_no_trgm
  ON quotations USING GIN (legacy_no gin_trgm_ops);

-- +goose Down
DROP INDEX CONCURRENTLY IF EXISTS idx_quotations_legacy_no_trgm;
