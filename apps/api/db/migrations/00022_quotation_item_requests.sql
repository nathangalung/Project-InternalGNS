-- +goose Up
-- +goose StatementBegin

-- 00022 — QUOTATION ITEM REQUESTS (pre-quotation review log)
--
-- New workflow stage: capture klien RFQ requests BEFORE building line items.
-- Sales/staff input each requested line (manual or via OCR), match to items DB,
-- review, then build quotation_items from confirmed requests.
--
-- Adds:
-- * quotation_item_requests — request log (1 row per RFQ line)
-- * quotation_items.request_id — FK back-pointer (1 request → N items)
-- * trg_qir_lock_parent — block edit when parent quotation status is terminal
-- * v_quotation_request_audit — owner-facing side-by-side view
--
-- NOT touched:
-- * trg_learn_match (existing on quotation_items) — still the canonical
--   sync to item_request_matches (cache learns from confirmed quotes,
--   not speculative request matches).
--
-- Backfill: none. Existing quotation_items.request_id remains NULL.

-- 1. Table.
CREATE TABLE quotation_item_requests (
  id              BIGSERIAL    PRIMARY KEY,
  quotation_id    BIGINT       NOT NULL REFERENCES quotations(id) ON DELETE CASCADE,
  line_no         INT          NOT NULL,
  request_text    TEXT         NOT NULL,
  request_impa    VARCHAR(20),
  requested_qty   NUMERIC(15,3),
  requested_uom   VARCHAR(20),
  matched_item_id BIGINT       REFERENCES items(id) ON DELETE RESTRICT,
  match_status    VARCHAR(20)  NOT NULL DEFAULT 'pending'
                    CHECK (match_status IN ('pending','matched','substituted','unavailable')),
  source_type     VARCHAR(20)  NOT NULL DEFAULT 'manual'
                    CHECK (source_type IN ('manual','ocr','import')),
  source_ref      TEXT,
  notes           TEXT,
  reviewed_by     BIGINT       REFERENCES users(id),
  reviewed_at     TIMESTAMPTZ,
  row_version     INTEGER      NOT NULL DEFAULT 0,
  created_by      BIGINT       NOT NULL REFERENCES users(id),
  updated_by      BIGINT       REFERENCES users(id),
  created_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  updated_at      TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
  CONSTRAINT uq_qir_quotation_line UNIQUE (quotation_id, line_no),
  CONSTRAINT ck_qir_qty_positive   CHECK (requested_qty IS NULL OR requested_qty > 0)
);

CREATE INDEX idx_qir_quotation    ON quotation_item_requests (quotation_id, line_no);
CREATE INDEX idx_qir_matched_item ON quotation_item_requests (matched_item_id) WHERE matched_item_id IS NOT NULL;
CREATE INDEX idx_qir_text_trgm    ON quotation_item_requests USING GIN (request_text gin_trgm_ops);
CREATE INDEX idx_qir_status       ON quotation_item_requests (match_status);
CREATE INDEX idx_qir_source       ON quotation_item_requests (source_type) WHERE source_type <> 'manual';

COMMENT ON TABLE quotation_item_requests IS
  'Pre-quotation request log. Each row = one RFQ line from klien (manual input or OCR). Goes through pending→matched/substituted/unavailable review, then 0..N quotation_items rows are built from it. Owner-facing audit via v_quotation_request_audit.';

COMMENT ON COLUMN quotation_item_requests.match_status IS
  'pending=awaiting review, matched=item identified 1:1, substituted=offered item differs from matched, unavailable=cannot fulfill (no quotation_items created). "confirmed" is derived from EXISTS quotation_items.request_id.';

COMMENT ON COLUMN quotation_item_requests.source_type IS
  'manual=staff typed it in, ocr=extracted from klien document via OCR, import=batch loaded from external file.';

-- +goose StatementEnd


-- 2. ALTER quotation_items: add request_id back-pointer (1:N from request).
-- +goose StatementBegin
ALTER TABLE quotation_items
  ADD COLUMN request_id BIGINT REFERENCES quotation_item_requests(id) ON DELETE SET NULL;

CREATE INDEX idx_quotation_items_request
  ON quotation_items (request_id) WHERE request_id IS NOT NULL;

COMMENT ON COLUMN quotation_items.request_id IS
  'Back-pointer to quotation_item_requests row that this line was built from. NULL = legacy row or admin-added line without an explicit klien request log.';
-- +goose StatementEnd


-- 3. Trigger: lock request edits when parent quotation is in terminal state.
-- +goose StatementBegin
CREATE FUNCTION trg_fn_qir_lock_parent() RETURNS TRIGGER AS $$
DECLARE
  v_qid       BIGINT;
  v_status    VARCHAR(20);
BEGIN
  v_qid := COALESCE(NEW.quotation_id, OLD.quotation_id);

  SELECT status INTO v_status
  FROM quotations
  WHERE id = v_qid;

  IF v_status IS NULL THEN
    RAISE EXCEPTION 'Parent quotation % not found', v_qid;
  END IF;

  IF v_status NOT IN ('draft', 'revision') THEN
    RAISE EXCEPTION
      'Cannot modify quotation_item_requests: parent quotation % has status "%". Only draft/revision allow request edits.',
      v_qid, v_status
      USING ERRCODE = 'check_violation';
  END IF;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql;
-- +goose StatementEnd


-- +goose StatementBegin
CREATE TRIGGER trg_qir_lock_parent
  BEFORE INSERT OR UPDATE OR DELETE ON quotation_item_requests
  FOR EACH ROW
  EXECUTE FUNCTION trg_fn_qir_lock_parent();
-- +goose StatementEnd


-- +goose StatementBegin
CREATE TRIGGER trg_qir_updated_at
  BEFORE UPDATE ON quotation_item_requests
  FOR EACH ROW
  EXECUTE FUNCTION set_updated_at();
-- +goose StatementEnd


-- 4. Owner-facing audit view: side-by-side request vs matched vs offered.
-- +goose StatementBegin
CREATE OR REPLACE VIEW v_quotation_request_audit AS
SELECT
  q.id                AS quotation_id,
  q.quotation_no,
  q.status            AS quotation_status,
  qir.id              AS request_id,
  qir.line_no,
  qir.request_text    AS client_requested,
  qir.request_impa,
  qir.requested_qty,
  qir.requested_uom,
  qir.match_status,
  qir.source_type,
  qir.source_ref,
  i_match.id          AS matched_item_id,
  i_match.name        AS matched_item_name,
  i_match.impa_code   AS matched_item_impa,
  qi.id               AS quotation_item_id,
  qi.line_number      AS quoted_line_number,
  qi.qty              AS quoted_qty,
  qi.selling_price    AS quoted_selling_price,
  qi.is_available     AS quoted_is_available,
  i_offer.id          AS offered_item_id,
  i_offer.name        AS offered_item_name,
  qir.notes,
  qir.reviewed_by,
  qir.reviewed_at,
  qir.created_at,
  qir.updated_at
FROM quotations q
LEFT JOIN quotation_item_requests qir ON qir.quotation_id = q.id
LEFT JOIN items i_match               ON i_match.id = qir.matched_item_id
LEFT JOIN quotation_items qi          ON qi.request_id = qir.id
LEFT JOIN items i_offer               ON i_offer.id = qi.offered_item_id;

COMMENT ON VIEW v_quotation_request_audit IS
  'Owner-facing side-by-side: client_requested | matched_item_name | quoted_qty/price. One row per request line, repeated when 1 request maps to N quotation_items (1:N case). Quotations without requests still appear (LEFT JOIN, qir.* NULL). Order via ORDER BY quotation_id, line_no, quoted_line_number in queries.';
-- +goose StatementEnd


-- +goose Down
-- +goose StatementBegin

DROP VIEW IF EXISTS v_quotation_request_audit;

DROP TRIGGER IF EXISTS trg_qir_updated_at  ON quotation_item_requests;
DROP TRIGGER IF EXISTS trg_qir_lock_parent ON quotation_item_requests;
DROP FUNCTION IF EXISTS trg_fn_qir_lock_parent();

DROP INDEX IF EXISTS idx_quotation_items_request;
ALTER TABLE quotation_items DROP COLUMN IF EXISTS request_id;

DROP TABLE IF EXISTS quotation_item_requests;

-- +goose StatementEnd
