-- DEMO: PO + invoice lifecycle on top of the historical 2026 seed.
-- Re-runs are no-ops because each step filters by the source state.
--
-- Distribution targets (deterministic via mod(id, 100)):
--   * Quotations: 60% of leaf 'sent' rows -> 'accepted' (auto-creates PO via
--                 the trigger added in migration 00015). 40% stay 'sent'.
--                 Non-leaf revisions are untouched.
--   * PO status:  15% PENDING, 20% UPLOADED, 25% ON_PROGRESS, 40% DELIVERED.
--                 Only DELIVERED auto-creates an invoice (also via 00015).
--   * Invoice:    30% draft, 30% sent, 30% paid, 10% overdue.
--                 Overdue rows get due_date pushed 15 days into the past.

BEGIN;

-- 1. Promote ~60% of leaf 'sent' quotations to 'accepted'.
--    fn_change_quotation_status validates the transition, logs status_history,
--    and (per migration 00015) calls fn_create_purchase_order on 'accepted'.
DO $$
DECLARE
  r RECORD;
BEGIN
  FOR r IN
    SELECT q.id, q.created_by
    FROM quotations q
    WHERE q.status = 'sent'
      AND mod(q.id, 100) < 60
      AND NOT EXISTS (SELECT 1 FROM quotations c WHERE c.parent_id = q.id)
  LOOP
    PERFORM fn_change_quotation_status(r.id, 'accepted', r.created_by, 'Demo seed');
  END LOOP;
END $$;

-- 2. Advance PO state machine.
--    fn_change_po_status enforces the chain PENDING -> UPLOADED -> ON_PROGRESS
--    -> DELIVERED, and creates an invoice draft on the DELIVERED transition.
DO $$
DECLARE
  r RECORD;
  bucket INT;
BEGIN
  FOR r IN
    SELECT po.id, po.created_by
    FROM purchase_orders po
    WHERE po.status = 'PENDING'
  LOOP
    bucket := mod(r.id, 100);
    IF bucket >= 15 THEN PERFORM fn_change_po_status(r.id, 'UPLOADED',    r.created_by); END IF;
    IF bucket >= 35 THEN PERFORM fn_change_po_status(r.id, 'ON_PROGRESS', r.created_by); END IF;
    IF bucket >= 60 THEN PERFORM fn_change_po_status(r.id, 'DELIVERED',   r.created_by); END IF;
  END LOOP;
END $$;

-- 3. Vary invoice status (default is 'draft' on auto-create).
UPDATE invoices SET status = 'sent', updated_by = created_by
 WHERE status = 'draft' AND mod(id, 100) BETWEEN 30 AND 59;

UPDATE invoices SET status = 'paid', updated_by = created_by
 WHERE status = 'draft' AND mod(id, 100) BETWEEN 60 AND 89;

UPDATE invoices
   SET status     = 'overdue',
       due_date   = CURRENT_DATE - INTERVAL '15 days',
       updated_by = created_by
 WHERE status = 'draft' AND mod(id, 100) >= 90;

COMMIT;
