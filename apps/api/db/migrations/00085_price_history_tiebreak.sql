-- +goose Up

-- 00085 PRICE HISTORY TIEBREAK
-- fn_suggest_selling_prices ordered by created_at alone, so two lines of one
-- quotation (or two quotations made in one transaction) tied and the LIMIT
-- cut was arbitrary. The newest quotation id, then the line number, decide.

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_suggest_selling_prices(p_item_id bigint, p_limit integer DEFAULT 5)
 RETURNS TABLE(quotation_no character varying, quotation_date timestamp with time zone, client_name character varying, qty numeric, cost_price numeric, selling_price numeric, profit_pct numeric)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT
    q.quotation_no,
    q.created_at,
    q.company_client_name,
    qi.qty,
    qi.cost_price,
    qi.selling_price,
    qi.profit_pct
  FROM quotation_items qi
  JOIN quotations q ON q.id = qi.quotation_id
  WHERE qi.offered_item_id    = p_item_id
    AND qi.is_available       = TRUE
    AND qi.selling_price      > 0
    AND q.status              IN ('sent','accepted')
  ORDER BY q.created_at DESC, q.id DESC, qi.line_number
  LIMIT p_limit;
$function$;
-- +goose StatementEnd

-- +goose Down

-- +goose StatementBegin
CREATE OR REPLACE FUNCTION public.fn_suggest_selling_prices(p_item_id bigint, p_limit integer DEFAULT 5)
 RETURNS TABLE(quotation_no character varying, quotation_date timestamp with time zone, client_name character varying, qty numeric, cost_price numeric, selling_price numeric, profit_pct numeric)
 LANGUAGE sql
 STABLE
AS $function$
  SELECT
    q.quotation_no,
    q.created_at,
    q.company_client_name,
    qi.qty,
    qi.cost_price,
    qi.selling_price,
    qi.profit_pct
  FROM quotation_items qi
  JOIN quotations q ON q.id = qi.quotation_id
  WHERE qi.offered_item_id    = p_item_id
    AND qi.is_available       = TRUE
    AND qi.selling_price      > 0
    AND q.status              IN ('sent','accepted')
  ORDER BY q.created_at DESC
  LIMIT p_limit;
$function$;
-- +goose StatementEnd
