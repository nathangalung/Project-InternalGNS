-- +goose Up

-- 1. Case-fold stored user emails.
--
-- 00045 added the UNIQUE index on LOWER(email) but backfilled nothing, and
-- users.Repo now case-folds every address it writes (normalizeEmail). A
-- mixed-case SUPERADMIN_EMAIL therefore stopped matching its own row as soon
-- as an admin edited that user: the boot-time re-seed inserted the original
-- mixed-case value, users_email_lower_idx rejected it, SeedSuperadmin failed
-- and the API never started. Fold the stored values so configuration and
-- storage agree on one canonical form.
--
-- This also supersedes the note in 00045 ("users_email_key stays:
-- SeedSuperadmin uses ON CONFLICT (email), which can infer that constraint but
-- not an expression index"): SeedSuperadmin now normalizes the address and
-- targets ON CONFLICT (LOWER(email)), which infers users_email_lower_idx.
-- 00045 is immutable, so the correction lives here.
--
-- The guard below can only fire if users_email_lower_idx was dropped or was
-- left INVALID by an interrupted CONCURRENTLY build: while it is valid,
-- duplicate LOWER(email) values cannot exist, so the UPDATE cannot collide.

-- +goose StatementBegin
DO $$
DECLARE
  v_collisions BIGINT;
BEGIN
  SELECT COUNT(*) INTO v_collisions FROM (
    SELECT LOWER(email) FROM users GROUP BY LOWER(email) HAVING COUNT(*) > 1
  ) d;

  IF v_collisions > 0 THEN
    RAISE EXCEPTION
      'cannot case-fold users.email: % address(es) collide when lower-cased; merge them and re-run',
      v_collisions;
  END IF;
END
$$;
-- +goose StatementEnd

UPDATE users SET email = LOWER(email) WHERE email <> LOWER(email);

-- 2. Backfill the invoice presentation columns 00042 added but never filled.
--
-- 00042 added invoice_items.gross_unit_price and invoices.total_discount and
-- taught fn_create_invoice to snapshot them, but left historical rows NULL/0.
-- The PDF then coalesces gross to the NET unit_price, so TotalProduk sums
-- qty * ROUND(net) while DPP sums ROUND(qty * gross * (1 - d/100)) and no
-- Diskon row explains the gap: a discounted line printed a totals block that
-- contradicted the invariant it claims (33.33 @ 5% x 1000 prints 31.660 next
-- to a DPP of 31.663).
--
-- dpp, dpp_nilai_lain, ppn_amount and total are NOT touched: nothing filed
-- with DJP is restated, only the presentation columns gain their historical
-- values.
--
-- Join key: (po_id, line_number), not quotation_item_id. fn_create_invoice
-- builds invoice_items with a single INSERT ... SELECT over
-- purchase_order_items carrying pi.line_number across, and
-- (po_id, line_number) is UNIQUE there. quotation_item_id is nullable and has
-- no uniqueness, so it cannot identify the originating row on its own; it is
-- kept as a corroborating predicate instead. Rows that do not match -- no
-- po_id, no line_number, or disagreeing quotation_item_id -- are left alone.
-- Shipping lines usually carry quotation_item_id NULL on both sides, which
-- IS NOT DISTINCT FROM matches, and gross = net for them anyway.

-- total_discount first: its scope predicate reads the gross_unit_price NULLs
-- that the next statement fills in. Restricting to invoices that still have a
-- NULL gross line keeps this a fill of never-set values -- a post-00042
-- snapshot is never restated from today's (possibly edited) PO state.
UPDATE invoices inv
SET total_discount = calc.discount
FROM (
  SELECT i.id,
         COALESCE(SUM(ROUND(pi.qty * pi.selling_price, 2)) - SUM(pi.subtotal), 0) AS discount
  FROM invoices i
  JOIN purchase_order_items pi ON pi.po_id = i.po_id
  WHERE i.po_id IS NOT NULL
    AND i.total_discount = 0
    AND EXISTS (
      SELECT 1 FROM invoice_items ii
      WHERE ii.invoice_id = i.id AND ii.gross_unit_price IS NULL
    )
  GROUP BY i.id
) calc
WHERE inv.id = calc.id;

UPDATE invoice_items ii
SET gross_unit_price = pi.selling_price
FROM invoices inv, purchase_order_items pi
WHERE ii.invoice_id = inv.id
  AND ii.gross_unit_price IS NULL
  AND ii.line_number IS NOT NULL
  AND inv.po_id IS NOT NULL
  AND pi.po_id = inv.po_id
  AND pi.line_number = ii.line_number
  AND pi.quotation_item_id IS NOT DISTINCT FROM ii.quotation_item_id;

-- +goose Down

-- Deliberately empty: neither half has an exact inverse.
--
-- 1. The pre-fold casing of each email is not recorded anywhere, so it cannot
--    be restored. Leaving the addresses lower-cased is also the only state
--    consistent with users.Repo and users_email_lower_idx.
--
-- 2. After the backfill, a filled gross_unit_price is indistinguishable from
--    one fn_create_invoice wrote at creation time -- the provenance of the
--    former NULL is gone. Blanking every value would corrupt post-00042
--    invoices, and blanking a guessed subset would corrupt some of them.
--    Reverting correct values would also reinstate the contradictory totals
--    block this migration exists to fix.
--
-- Rolling back to 00046 therefore restores the 00046 schema (this migration
-- changes none) but keeps the repaired data. Nothing here is load-bearing for
-- the 00046 code path: 00046 tolerates lower-cased emails and the PDF's
-- COALESCE tolerates a non-NULL gross_unit_price.
