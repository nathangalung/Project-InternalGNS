-- +goose Up
-- 00096 INVOICE BUYER FIXED AT CREATION
-- 00095 let a draft invoice follow client edits through a trigger. The PO
-- gate already refuses DELIVERED without a valid NPWP and an address, so
-- the client is complete when fn_create_invoice copies it, and the trigger
-- only bumped row_version on every draft of an edited client, failing an
-- open invoice date edit with a 409. Every invoice now keeps the buyer it
-- was created with; a Pengganti copies the client again.

DROP TRIGGER IF EXISTS trg_company_client_refresh_draft_invoices ON company_client;
DROP FUNCTION IF EXISTS public.trg_fn_refresh_draft_invoice_buyer();

COMMENT ON COLUMN invoices.buyer_name IS
  'Client name the invoice is addressed to, copied when the invoice is created.';
COMMENT ON COLUMN invoices.buyer_npwp IS
  'Client NPWP the invoice is addressed to, copied when the invoice is created.';
COMMENT ON COLUMN invoices.buyer_address IS
  'Client address the invoice is addressed to, copied when the invoice is created.';

-- +goose Down

COMMENT ON COLUMN invoices.buyer_name IS
  'Client name the invoice is addressed to; follows the client only while draft.';
COMMENT ON COLUMN invoices.buyer_npwp IS
  'Client NPWP the invoice is addressed to; follows the client only while draft.';
COMMENT ON COLUMN invoices.buyer_address IS
  'Client address the invoice is addressed to; follows the client only while draft.';

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.trg_fn_refresh_draft_invoice_buyer()
 RETURNS trigger
 LANGUAGE plpgsql
AS $function$
BEGIN
  UPDATE invoices
  SET buyer_name    = NEW.name,
      buyer_npwp    = NEW.npwp,
      buyer_address = NEW.address
  WHERE company_client_id = NEW.id
    AND status = 'draft'
    AND (buyer_name, buyer_npwp, buyer_address)
        IS DISTINCT FROM (NEW.name, NEW.npwp, NEW.address);
  RETURN NULL;
END;
$function$
;
-- +goose StatementEnd

CREATE TRIGGER trg_company_client_refresh_draft_invoices
  AFTER UPDATE OF name, npwp, address ON company_client
  FOR EACH ROW
  WHEN ((OLD.name, OLD.npwp, OLD.address) IS DISTINCT FROM (NEW.name, NEW.npwp, NEW.address))
  EXECUTE FUNCTION trg_fn_refresh_draft_invoice_buyer();
