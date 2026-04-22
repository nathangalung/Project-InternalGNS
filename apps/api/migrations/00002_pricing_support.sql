-- +goose Up
-- +goose StatementBegin

-- ============================================================
-- 00002 — PRICING SUPPORT
-- ============================================================
-- 1. Flow 2: writeback cost_price dari quotation_item ke vendor_products
--    via flag column + AFTER INSERT trigger. Opsi C1.
-- 2. Flow 1: fn_suggest_selling_prices untuk rekomendasi harga jual
--    berdasarkan history quotation yang status='sent'/'accepted'.
-- ============================================================


-- ─── FLOW 2: Vendor cost sync (Opsi C1) ───────────────────
ALTER TABLE quotation_items
  ADD COLUMN update_vendor_price BOOLEAN NOT NULL DEFAULT FALSE;

COMMENT ON COLUMN quotation_items.update_vendor_price IS
  'Flag: set TRUE oleh app layer kalau user mau sync vendor_products.cost_price dengan cost_price di baris ini. Trigger trg_sync_vendor_cost fires AFTER INSERT only (bukan UPDATE — draft iterations tidak pollute master).';

-- +goose StatementEnd


-- +goose StatementBegin
CREATE FUNCTION trg_fn_sync_vendor_cost() RETURNS TRIGGER AS $$
BEGIN
  IF NEW.update_vendor_price = TRUE
     AND NEW.vendor_product_id IS NOT NULL
     AND NEW.cost_price IS NOT NULL THEN

    UPDATE vendor_products
    SET cost_price     = NEW.cost_price,
        last_quoted_at = NOW()
    WHERE id = NEW.vendor_product_id;

  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd


-- +goose StatementBegin
COMMENT ON FUNCTION trg_fn_sync_vendor_cost() IS
  'Trigger function: propagate cost_price dari quotation_items ke vendor_products kalau update_vendor_price=TRUE. Juga refresh last_quoted_at.';

CREATE TRIGGER trg_sync_vendor_cost
AFTER INSERT ON quotation_items
FOR EACH ROW
EXECUTE FUNCTION trg_fn_sync_vendor_cost();
-- +goose StatementEnd


-- ─── FLOW 1: Suggest selling prices from history ──────────
-- +goose StatementBegin
CREATE FUNCTION fn_suggest_selling_prices(
  p_item_id BIGINT,
  p_limit   INT DEFAULT 5
) RETURNS TABLE (
  quotation_no     VARCHAR,
  quotation_date   TIMESTAMPTZ,
  client_name      VARCHAR,
  qty              NUMERIC,
  cost_price       NUMERIC,
  selling_price    NUMERIC,
  profit_pct       NUMERIC
) AS $$
  SELECT
    q.quotation_no,
    q.created_at,
    q.company_client_name,
    qi.qty,
    qi.cost_price,
    qi.selling_price,
    qi.profit_pct
  FROM quotation_items qi
  JOIN quotations q ON q.id = qi.quotation_id
  WHERE qi.offered_item_id    = p_item_id
    AND qi.is_available       = TRUE
    AND qi.selling_price      > 0
    AND q.status              IN ('sent','accepted')
  ORDER BY q.created_at DESC
  LIMIT p_limit;
$$ LANGUAGE SQL STABLE;
-- +goose StatementEnd


-- +goose StatementBegin
COMMENT ON FUNCTION fn_suggest_selling_prices(BIGINT, INT) IS
  'Return top-N historical selling prices dari quotation yang status sent/accepted untuk referensi harga jual. Urut terbaru dulu.';
-- +goose StatementEnd


-- +goose Down
-- +goose StatementBegin
DROP FUNCTION IF EXISTS fn_suggest_selling_prices(BIGINT, INT);
DROP TRIGGER IF EXISTS trg_sync_vendor_cost ON quotation_items;
DROP FUNCTION IF EXISTS trg_fn_sync_vendor_cost();
ALTER TABLE quotation_items DROP COLUMN IF EXISTS update_vendor_price;
-- +goose StatementEnd
