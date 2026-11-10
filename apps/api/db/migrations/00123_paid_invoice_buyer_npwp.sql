-- +goose Up
-- 00123 BUYER NPWP OF PAID INVOICES
-- Invoices imported before the buyer snapshot kept no buyer NPWP, so the
-- Coretax export refuses them and they can no longer be cancelled. A paid
-- one takes its client's NPWP only when that client is certainly the buyer
-- as invoiced: an Indonesian client with a 16 digit NPWP, whose name
-- (ignoring case, spacing and punctuation) is the invoice's buyer name, and
-- none of whose invoices stores another NPWP, so it never changed. Any other
-- row keeps none, and a notice counts both. Open invoices are left to a
-- Pengganti, which copies the client as it is then.

-- +goose StatementBegin
DO $$
DECLARE
  v_filled INT;
  v_left   INT;
BEGIN
  UPDATE invoices i
     SET buyer_npwp = c.npwp
    FROM company_client c
   WHERE c.id = i.company_client_id
     AND i.status = 'paid'
     AND i.buyer_npwp IS NULL
     AND c.npwp ~ '^[0-9]{16}$'
     AND COALESCE(NULLIF(c.country_code, ''), 'IDN') = 'IDN'
     AND regexp_replace(lower(c.name), '[^a-z0-9]', '', 'g')
       = regexp_replace(lower(i.buyer_name), '[^a-z0-9]', '', 'g')
     AND NOT EXISTS (
       SELECT 1 FROM invoices o
       WHERE o.company_client_id = c.id
         AND o.buyer_npwp IS NOT NULL
         AND o.buyer_npwp <> c.npwp);
  GET DIAGNOSTICS v_filled = ROW_COUNT;
  SELECT count(*) INTO v_left FROM invoices WHERE status = 'paid' AND buyer_npwp IS NULL;
  RAISE NOTICE '% paid invoices took their client NPWP, % keep none.', v_filled, v_left;
END $$;
-- +goose StatementEnd

-- +goose Down
-- The filled NPWP stays: it is the buyer the invoice already names, and
-- nothing records which rows were empty before.
SELECT 1;
