-- Canonical current body of fn_quotation_notify (deployed by migration 00078).
CREATE OR REPLACE FUNCTION public.fn_quotation_notify(p_quotation_id bigint, p_kind text, p_part text, p_user_id bigint)
 RETURNS void
 LANGUAGE sql
AS $function$
  SELECT pg_notify('quotation_events', json_build_object(
    'quotationId', p_quotation_id, 'kind', p_kind, 'part', p_part, 'userId', p_user_id)::text);
$function$
