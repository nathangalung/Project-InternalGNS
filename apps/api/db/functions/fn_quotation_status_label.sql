-- Canonical current body of fn_quotation_status_label (deployed by migration 00059).
CREATE OR REPLACE FUNCTION public.fn_quotation_status_label(p_status text)
 RETURNS text
 LANGUAGE sql
 IMMUTABLE
AS $function$
  SELECT CASE p_status
    WHEN 'draft'     THEN 'Draf'
    WHEN 'sent'      THEN 'Dikirim'
    WHEN 'revision'  THEN 'Revisi'
    WHEN 'accepted'  THEN 'Disetujui'
    WHEN 'rejected'  THEN 'Ditolak'
    WHEN 'cancelled' THEN 'Dibatalkan'
    WHEN 'expired'   THEN 'Kedaluwarsa'
    ELSE p_status
  END
$function$
