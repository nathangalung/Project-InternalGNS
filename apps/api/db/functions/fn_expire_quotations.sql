-- Canonical current body of fn_expire_quotations (deployed by migration 00059).
CREATE OR REPLACE FUNCTION public.fn_expire_quotations(p_today date)
 RETURNS integer
 LANGUAGE plpgsql
AS $function$
DECLARE
  v_count INTEGER;
BEGIN
  -- One replica per run; the key is mirrored in the Go tests.
  IF NOT pg_try_advisory_xact_lock(7431590059) THEN
    RETURN 0;
  END IF;

  -- p_today is the caller's WIB date, so the job's clock can be injected.
  -- The send date follows the session zone, pinned to WIB by the app pool.
  -- The last send is the start; a row without one falls back to its last
  -- update.
  WITH due AS (
    SELECT q.id, q.validity_days,
           COALESCE(s.sent_at, q.updated_at)::date AS sent_on
    FROM quotations q
    LEFT JOIN LATERAL (
      SELECT MAX(h.changed_at) AS sent_at
      FROM quotation_status_history h
      WHERE h.quotation_id = q.id AND h.to_status = 'sent'
    ) s ON TRUE
    WHERE q.status = 'sent'
      AND q.validity_days IS NOT NULL
      AND COALESCE(s.sent_at, q.updated_at)::date + q.validity_days < p_today
    FOR UPDATE OF q SKIP LOCKED
  ),
  upd AS (
    UPDATE quotations q
    SET status = 'expired'
    FROM due
    WHERE q.id = due.id
    RETURNING q.id, due.validity_days, due.sent_on
  ),
  hist AS (
    INSERT INTO quotation_status_history
      (quotation_id, from_status, to_status, note, changed_by)
    SELECT id, 'sent', 'expired',
           format('Kedaluwarsa otomatis: masa berlaku %s hari sejak %s telah lewat.',
                  validity_days, to_char(sent_on, 'DD-MM-YYYY')),
           NULL
    FROM upd
    RETURNING 1
  )
  SELECT COUNT(*) INTO v_count FROM hist;

  RETURN v_count;
END;
$function$
