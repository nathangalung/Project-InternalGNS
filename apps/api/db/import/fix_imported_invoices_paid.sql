-- Mark imported invoices dated before 2026-09-05 as paid, in one transaction.
--
-- One-off for a database loaded with the historical seed before the owner
-- ruled that an invoice dated more than a month before the rebuild is
-- Dibayar (docs/data_reimport_plan.md). A rebuilt seed writes the same rows
-- itself (PAID_BEFORE in seed_model.py), so a fresh load needs no fix.
--
-- An imported invoice (legacy_no set) still sent and dated before the
-- cutoff moves to paid through fn_change_invoice_status, the app's own
-- mark-paid path, acted by the oldest active superadmin as the seed's rows
-- are. paid_at and the new sent to paid history row are then dated 09:00
-- WIB on the due date (the invoice date when there is none), and never
-- before the invoice's last move, as the seed dates them. A second run
-- finds nothing to move. Counts print before and after.
--
-- Run after migration 00100:
--   psql "$DATABASE_URL" -X -v ON_ERROR_STOP=1 -f fix_imported_invoices_paid.sql

\set ON_ERROR_STOP on

BEGIN;

\echo Imported invoices by status, before:
SELECT status, count(*) AS invoices
FROM invoices WHERE legacy_no IS NOT NULL
GROUP BY status ORDER BY status;

CREATE TEMP TABLE fix_actor ON COMMIT DROP AS
SELECT id FROM users WHERE role = 'superadmin' AND is_active
ORDER BY created_at, id LIMIT 1;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM fix_actor) THEN
    RAISE EXCEPTION 'fix_imported_invoices_paid: no active superadmin to act';
  END IF;
END $$;

CREATE TEMP TABLE fix_paid ON COMMIT DROP AS
SELECT i.id,
       GREATEST(
         (COALESCE(i.due_date, i.invoice_date) + TIME '09:00') AT TIME ZONE 'Asia/Jakarta',
         (SELECT max(h.changed_at) FROM invoice_status_history h WHERE h.invoice_id = i.id)
           + INTERVAL '1 minute'
       ) AS paid_at
FROM invoices i
WHERE i.legacy_no IS NOT NULL
  AND i.status = 'sent'
  AND i.invoice_date < DATE '2026-09-05';

\echo Invoices to mark paid:
SELECT count(*) AS to_mark_paid FROM fix_paid;

DO $$
BEGIN
  PERFORM fn_change_invoice_status(f.id, 'paid', a.id)
  FROM fix_paid f CROSS JOIN fix_actor a
  ORDER BY f.id;
END $$;

UPDATE invoices i
SET paid_at = f.paid_at
FROM fix_paid f
WHERE i.id = f.id;

UPDATE invoice_status_history h
SET changed_at = f.paid_at
FROM fix_paid f
WHERE h.invoice_id = f.id AND h.from_status = 'sent' AND h.to_status = 'paid';

\echo Imported invoices by status, after:
SELECT status, count(*) AS invoices, min(paid_at) AS first_paid_at, max(paid_at) AS last_paid_at
FROM invoices WHERE legacy_no IS NOT NULL
GROUP BY status ORDER BY status;

COMMIT;
