-- +goose Up
-- 00091 DROP REDUNDANT LINE INDEXES
-- Each index repeats one a unique constraint already keeps:
-- idx_qir_quotation is uq_qir_quotation_line column for column, and
-- idx_quotation_items_quotation and idx_po_items_po are the leading column
-- of the (quotation_id, line_number) and (po_id, line_number) keys. EXPLAIN
-- of the line reads, the whole-draft and PO line rewrites and the PO list
-- totals lateral shows the unique indexes serving every lookup once these
-- are gone, while each line insert and delete still paid for a third btree.
DROP INDEX IF EXISTS idx_qir_quotation;
DROP INDEX IF EXISTS idx_quotation_items_quotation;
DROP INDEX IF EXISTS idx_po_items_po;

-- +goose Down
CREATE INDEX IF NOT EXISTS idx_po_items_po ON public.purchase_order_items USING btree (po_id);
CREATE INDEX IF NOT EXISTS idx_quotation_items_quotation ON public.quotation_items USING btree (quotation_id);
CREATE INDEX IF NOT EXISTS idx_qir_quotation ON public.quotation_item_requests USING btree (quotation_id, line_no);
