-- +goose Up
-- 00105 CASH ENTRIES
-- Kas Lain: money in and out beyond the sales and purchases the documents
-- already record, entered by finance. Each row is one movement on one day;
-- its category is free text the team keeps consistent from suggestions.
CREATE TABLE cash_entries (
  id BIGSERIAL PRIMARY KEY,
  entry_date DATE NOT NULL,
  direction VARCHAR(3) NOT NULL CHECK (direction IN ('in', 'out')),
  category VARCHAR(60) NOT NULL CHECK (BTRIM(category) <> ''),
  amount NUMERIC(18,2) NOT NULL CHECK (amount > 0),
  description VARCHAR(500) NOT NULL CHECK (BTRIM(description) <> ''),
  row_version INT NOT NULL DEFAULT 0,
  created_by BIGINT NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  updated_by BIGINT REFERENCES users(id) ON DELETE RESTRICT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX idx_cash_entries_date ON cash_entries (entry_date DESC, id DESC);
CREATE TRIGGER trg_cash_entries_updated_at BEFORE UPDATE ON cash_entries
  FOR EACH ROW EXECUTE FUNCTION set_updated_at();

-- +goose Down
DROP TABLE IF EXISTS cash_entries;
