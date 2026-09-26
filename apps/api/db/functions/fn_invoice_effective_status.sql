-- Canonical current body of fn_invoice_effective_status (deployed by migration 00065).
CREATE OR REPLACE FUNCTION public.fn_invoice_effective_status(p_status text, p_due_date date)
 RETURNS text
 LANGUAGE sql
 STABLE
AS $function$
  SELECT CASE
           WHEN p_status = 'overdue'
             OR (p_status IN ('draft', 'sent') AND p_due_date < CURRENT_DATE)
           THEN 'overdue'
           ELSE p_status
         END
$function$
