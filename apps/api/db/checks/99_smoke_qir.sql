-- Smoke test for migration 00022. Run inside a transaction; ROLLBACK at end.
-- Verifies: INSERT/UPDATE on draft → ok, view side-by-side, lock on transition.
\set ON_ERROR_STOP on
BEGIN;

-- 1. Make a temp draft quotation
INSERT INTO quotations (quotation_no, version, company_client_id, company_client_name, status, discount_pct, created_by, updated_by)
VALUES ('Q-TEST-22-001', 1, (SELECT id FROM company_client LIMIT 1), 'TEST CLIENT', 'draft', 0, 1, 1)
RETURNING id AS draft_id \gset

\echo '== TEST: insert 2 requests on draft (expected: ok) =='
INSERT INTO quotation_item_requests (quotation_id, line_no, request_text, request_impa, requested_qty, requested_uom, source_type, created_by)
VALUES (:draft_id, 1, 'RACOR FILTER 2010 30M',     '770213',  5, 'PCS', 'ocr',    1),
       (:draft_id, 2, 'GLAND PACKING PILAR 6501L', '710711', 10, 'M',   'manual', 1);

\echo '== TEST: review stage — match line 1 =='
UPDATE quotation_item_requests
   SET match_status='matched',
       matched_item_id=(SELECT id FROM items WHERE name ILIKE '%RACOR%' LIMIT 1),
       reviewed_by=1, reviewed_at=NOW()
 WHERE quotation_id=:draft_id AND line_no=1;

\echo '== TEST: side-by-side view =='
SELECT line_no, client_requested, request_impa, requested_qty, match_status, source_type,
       COALESCE(matched_item_name,'(none)') AS matched_item_name
  FROM v_quotation_request_audit
 WHERE quotation_id=:draft_id
 ORDER BY line_no;

\echo '== TEST: promote parent quotation to sent =='
UPDATE quotations SET status='sent', updated_by=1 WHERE id=:draft_id;

\echo '== TEST: try to UPDATE request after lock activates (expected: ERROR) =='
DO $$
BEGIN
  BEGIN
    UPDATE quotation_item_requests SET notes='should be blocked'
     WHERE line_no=1
       AND quotation_id=(SELECT id FROM quotations WHERE quotation_no='Q-TEST-22-001');
    RAISE EXCEPTION 'LOCK FAILED — UPDATE was not blocked';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'LOCK OK — UPDATE correctly blocked: %', SQLERRM;
  END;
END $$;

\echo '== TEST: try to INSERT new request after lock activates (expected: ERROR) =='
DO $$
DECLARE q_id BIGINT;
BEGIN
  SELECT id INTO q_id FROM quotations WHERE quotation_no='Q-TEST-22-001';
  BEGIN
    INSERT INTO quotation_item_requests (quotation_id, line_no, request_text, created_by)
    VALUES (q_id, 99, 'should be blocked', 1);
    RAISE EXCEPTION 'LOCK FAILED — INSERT was not blocked';
  EXCEPTION WHEN check_violation THEN
    RAISE NOTICE 'LOCK OK — INSERT correctly blocked: %', SQLERRM;
  END;
END $$;

\echo '== TEST: revert to draft → edits should work again =='
UPDATE quotations SET status='draft', updated_by=1 WHERE quotation_no='Q-TEST-22-001';
UPDATE quotation_item_requests SET notes='now allowed (status=draft)' WHERE line_no=1
   AND quotation_id=(SELECT id FROM quotations WHERE quotation_no='Q-TEST-22-001');

\echo '== ROLLBACK — leave DB unchanged =='
ROLLBACK;
