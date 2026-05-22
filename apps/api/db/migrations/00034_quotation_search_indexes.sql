-- +goose NO TRANSACTION

-- +goose Up
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_quotations_client_name_trgm
  ON quotations USING GIN (company_client_name gin_trgm_ops);

CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_quotations_no_trgm
  ON quotations USING GIN (quotation_no gin_trgm_ops);

-- +goose Down
DROP INDEX CONCURRENTLY IF EXISTS idx_quotations_client_name_trgm;
DROP INDEX CONCURRENTLY IF EXISTS idx_quotations_no_trgm;
