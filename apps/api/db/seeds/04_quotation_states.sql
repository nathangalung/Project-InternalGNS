-- Quotation state policy. Replaces the earlier 04_demo_po_invoice.sql which
-- generated dummy POs+invoices that 07 had to delete back out.
--
-- Policy:
--   * The 57 quotations referenced by 05_real_purchase_orders.sql become
--     'accepted' here. fn_change_quotation_status walks them through the
--     state machine, which auto-creates a PO via fn_create_purchase_order
--     (po_items snapshot of quotation_items). 05 then UPDATEs po_number /
--     po_date with the real customer values.
--   * Every other quotation becomes 'rejected'. Direct UPDATE bypasses the
--     state machine because 'accepted' is otherwise terminal and 'draft' has
--     no legal path to 'rejected' — seed-time policy is the legitimate
--     exception. quotation_status_history captures the demotion for audit.
--
-- Idempotent. Re-runs only touch rows whose state still differs.

BEGIN;

CREATE TEMP TABLE _real_qid (id BIGINT PRIMARY KEY) ON COMMIT DROP;
INSERT INTO _real_qid VALUES
  -- Mirrors the quotation_id list in 05_real_purchase_orders.sql.
  (478),(481),(486),(488),(489),(490),(491),(492),(498),(500),
  (506),(509),(512),(519),(520),(522),(523),(524),(526),(528),
  (530),(537),(542),(543),(544),(548),(549),(552),(555),(556),
  (557),(565),(568),(571),(573),(575),(576),(587),(589),(593),
  (604),(605),(611),(614),(619),(624),(640),(641),(643),(645),
  (646),(647),(649),(654),(660),(668),(669);

-- 1a. Force-promote 'draft' real_qid to 'sent'. Seed-time policy: source xlsx
--     occasionally has missing prices (selling_price=0), but the real customer
--     PO confirms the deal happened. Direct UPDATE bypasses fn_change_quotation_status
--     because draft→accepted requires going through sent, and these quotations
--     bypassed 'sent' due to incomplete pricing in the original Excel. Audit row
--     captures the override so the history isn't silently lost.
INSERT INTO quotation_status_history (quotation_id, from_status, to_status, note, changed_by)
SELECT q.id, q.status, 'sent',
       'Seed-time override: real customer PO confirmed despite incomplete pricing in source xlsx',
       COALESCE(q.updated_by, q.created_by)
  FROM quotations q
  JOIN _real_qid rq ON rq.id = q.id
 WHERE q.status = 'draft';

UPDATE quotations
   SET status='sent', updated_by=COALESCE(updated_by, created_by)
 WHERE id IN (SELECT id FROM _real_qid) AND status='draft';

-- 1b. Promote 'sent' real-PO quotations to 'accepted'. The state-machine
--    function auto-creates a PO via fn_create_purchase_order (idempotent).
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT q.id, COALESCE(q.updated_by, q.created_by) AS user_id
      FROM quotations q
      JOIN _real_qid rq ON rq.id = q.id
     WHERE q.status = 'sent'
  LOOP
    PERFORM fn_change_quotation_status(r.id, 'accepted', r.user_id,
                                       'Real customer PO confirmed');
  END LOOP;
END $$;

-- 2. Backfill auto-POs for already-'accepted' real_qid (e.g. Q-668/Q-669 from
--    03b inserted directly with status='accepted', no auto-PO yet).
DO $$
DECLARE r RECORD;
BEGIN
  FOR r IN
    SELECT q.id, COALESCE(q.updated_by, q.created_by) AS user_id
      FROM quotations q
      JOIN _real_qid rq ON rq.id = q.id
     WHERE q.status = 'accepted'
       AND NOT EXISTS (SELECT 1 FROM purchase_orders WHERE quotation_id = q.id)
  LOOP
    PERFORM fn_create_purchase_order(r.id, r.user_id);
  END LOOP;
END $$;

-- 3. Audit trail for the rejection (must run BEFORE the UPDATE to capture
--    each quotation's old status correctly).
INSERT INTO quotation_status_history (quotation_id, from_status, to_status, note, changed_by)
SELECT q.id, q.status, 'rejected',
       'No real customer PO; seed-time policy', q.created_by
  FROM quotations q
 WHERE q.id NOT IN (SELECT id FROM _real_qid)
   AND q.status <> 'rejected';

-- 4. Reject everything else.
UPDATE quotations
   SET status     = 'rejected',
       updated_by = COALESCE(updated_by, created_by)
 WHERE id NOT IN (SELECT id FROM _real_qid)
   AND status <> 'rejected';

COMMIT;
