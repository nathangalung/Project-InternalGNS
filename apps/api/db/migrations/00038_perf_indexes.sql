-- +goose NO TRANSACTION

-- Result-preserving indexes for predicates the existing composite indexes
-- cannot serve: they all lead with status, so the status-less list sorts and
-- dashboard timeseries fall back to a sequential scan.

-- +goose Up

-- Dashboard invoice-count timeseries filters invoice_date with no status.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_invoices_invoice_date
  ON invoices (invoice_date);

-- Default quotation list sorts by created_at with no status filter.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_quotations_created_at
  ON quotations (created_at DESC);

-- Purchase order list/date-range queries sort by po_date with no status filter.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_po_po_date
  ON purchase_orders (po_date DESC);

-- Vendor SKU search uses lower(vendor_sku) LIKE '%..%'; a trigram index on the
-- lowered expression serves the arbitrary-substring pattern.
CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_vendor_products_sku_trgm
  ON vendor_products USING gin (lower(vendor_sku) gin_trgm_ops);

-- +goose Down
DROP INDEX CONCURRENTLY IF EXISTS idx_invoices_invoice_date;
DROP INDEX CONCURRENTLY IF EXISTS idx_quotations_created_at;
DROP INDEX CONCURRENTLY IF EXISTS idx_po_po_date;
DROP INDEX CONCURRENTLY IF EXISTS idx_vendor_products_sku_trgm;
