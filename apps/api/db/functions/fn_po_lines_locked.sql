-- Canonical current body of fn_po_lines_locked (deployed by migration 00094).
CREATE OR REPLACE FUNCTION public.fn_po_lines_locked(p_po_id bigint, p_status text)
 RETURNS boolean
 LANGUAGE sql
 STABLE
AS $function$
  SELECT CASE
           WHEN p_status = 'CANCELLED' THEN TRUE
           WHEN p_status <> 'DELIVERED' THEN FALSE
           ELSE NOT (
             EXISTS (SELECT 1 FROM invoices i
                     WHERE i.po_id = p_po_id AND i.status = 'cancelled')
             AND NOT EXISTS (SELECT 1 FROM invoices i
                             WHERE i.po_id = p_po_id AND i.status <> 'cancelled'))
         END
$function$
