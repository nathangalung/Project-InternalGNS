-- +goose Up
-- +goose StatementBegin

-- Optimistic-lock wrappers over fn_update_quotation / fn_update_po_items.
-- Take expected row_version as p_if_match; verify under FOR UPDATE lock;
-- delegate to inner fn which UPDATEs header row (trigger bumps row_version).
-- Custom SQLSTATEs let Go map to HTTP codes:
--   P0010 -> 409 Conflict (version mismatch)
--   P0011 -> 404 Not Found
-- Inner-fn P0001 errors (draft-only, validation) propagate unchanged.

CREATE OR REPLACE FUNCTION fn_update_quotation_versioned(
  p_id                 BIGINT,
  p_if_match           INT,
  p_client_ref_no      TEXT,
  p_vessel_name        TEXT,
  p_payment_terms      TEXT,
  p_validity_days      INT,
  p_discount_pct       NUMERIC(5,2),
  p_shipping_address   TEXT,
  p_shipping_days      INT,
  p_shipping_cost      NUMERIC(15,2),
  p_items              JSONB,
  p_user_id            BIGINT,
  p_notes              TEXT DEFAULT NULL
) RETURNS INT AS $$
DECLARE
  v_current INT;
  v_new     INT;
BEGIN
  SELECT row_version INTO v_current
  FROM quotations
  WHERE id = p_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'quotation % not found', p_id USING ERRCODE = 'P0011';
  END IF;

  IF v_current <> p_if_match THEN
    RAISE EXCEPTION 'row_version mismatch (expected %, got %)', v_current, p_if_match
      USING ERRCODE = 'P0010';
  END IF;

  PERFORM fn_update_quotation(
    p_id, p_client_ref_no, p_vessel_name, p_payment_terms,
    p_validity_days, p_discount_pct, p_shipping_address,
    p_shipping_days, p_shipping_cost, p_items, p_user_id, p_notes
  );

  SELECT row_version INTO v_new FROM quotations WHERE id = p_id;
  RETURN v_new;
END;
$$ LANGUAGE plpgsql;

-- +goose StatementEnd


-- +goose StatementBegin
COMMENT ON FUNCTION fn_update_quotation_versioned(
  BIGINT, INT, TEXT, TEXT, TEXT, INT, NUMERIC(5,2),
  TEXT, INT, NUMERIC(15,2), JSONB, BIGINT, TEXT
) IS
  'Optimistic-lock wrapper over fn_update_quotation. Returns new row_version. SQLSTATE P0010 mismatch, P0011 not found.';
-- +goose StatementEnd


-- +goose StatementBegin
CREATE OR REPLACE FUNCTION fn_update_po_items_versioned(
  p_po_id            BIGINT,
  p_if_match         INT,
  p_user_id          BIGINT,
  p_discount_pct     NUMERIC,
  p_notes            TEXT,
  p_shipping_address TEXT,
  p_shipping_days    INT,
  p_shipping_cost    NUMERIC,
  p_items            JSONB
) RETURNS INT AS $$
DECLARE
  v_current INT;
  v_new     INT;
BEGIN
  SELECT row_version INTO v_current
  FROM purchase_orders
  WHERE id = p_po_id
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'purchase order % not found', p_po_id USING ERRCODE = 'P0011';
  END IF;

  IF v_current <> p_if_match THEN
    RAISE EXCEPTION 'row_version mismatch (expected %, got %)', v_current, p_if_match
      USING ERRCODE = 'P0010';
  END IF;

  PERFORM fn_update_po_items(
    p_po_id, p_user_id, p_discount_pct, p_notes,
    p_shipping_address, p_shipping_days, p_shipping_cost, p_items
  );

  SELECT row_version INTO v_new FROM purchase_orders WHERE id = p_po_id;
  RETURN v_new;
END;
$$ LANGUAGE plpgsql;

-- +goose StatementEnd


-- +goose StatementBegin
COMMENT ON FUNCTION fn_update_po_items_versioned(
  BIGINT, INT, BIGINT, NUMERIC, TEXT, TEXT, INT, NUMERIC, JSONB
) IS
  'Optimistic-lock wrapper over fn_update_po_items. Returns new row_version. SQLSTATE P0010 mismatch, P0011 not found.';
-- +goose StatementEnd


-- +goose Down
-- +goose StatementBegin
DROP FUNCTION IF EXISTS fn_update_quotation_versioned(
  BIGINT, INT, TEXT, TEXT, TEXT, INT, NUMERIC(5,2),
  TEXT, INT, NUMERIC(15,2), JSONB, BIGINT, TEXT
);
-- +goose StatementEnd

-- +goose StatementBegin
DROP FUNCTION IF EXISTS fn_update_po_items_versioned(
  BIGINT, INT, BIGINT, NUMERIC, TEXT, TEXT, INT, NUMERIC, JSONB
);
-- +goose StatementEnd
