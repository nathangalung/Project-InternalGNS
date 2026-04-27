-- name: dashboard.summary
WITH paid_inv AS (
  SELECT COALESCE(SUM(total), 0)        AS revenue,
         COALESCE(SUM(ppn_amount), 0)   AS ppn,
         COUNT(*)                       AS paid_count
    FROM invoices
   WHERE status = 'paid'
),
inv AS (
  SELECT COUNT(*)                                                                            AS total_count,
         COUNT(*) FILTER (WHERE status NOT IN ('paid','cancelled') AND due_date IS NOT NULL
                           AND due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + INTERVAL '7 day') AS due_soon,
         COUNT(*) FILTER (WHERE status NOT IN ('paid','cancelled') AND due_date IS NOT NULL
                           AND due_date < CURRENT_DATE)                                       AS overdue
    FROM invoices
),
qstat AS (
  SELECT COUNT(*)                                                          AS total_count,
         COUNT(*) FILTER (WHERE status IN ('rejected','expired'))          AS rejected_count
    FROM quotations
),
po AS (
  SELECT COUNT(*) AS total_count FROM purchase_orders
),
-- Aggregate cost basis once per quotation.
q_cost AS (
  SELECT quotation_id,
         COALESCE(SUM(qty * cost_price) FILTER (WHERE cost_price IS NOT NULL), 0) AS cost
    FROM quotation_items
   GROUP BY quotation_id
),
-- Sum cost across quotations with any paid invoice.
exp AS (
  SELECT COALESCE(SUM(qc.cost), 0) AS expenses
    FROM (SELECT DISTINCT quotation_id FROM invoices WHERE status = 'paid') pq
    JOIN q_cost qc ON qc.quotation_id = pq.quotation_id
)
SELECT paid_inv.revenue                  AS total_revenue,
       exp.expenses                      AS total_expenses,
       (paid_inv.revenue - exp.expenses) AS total_profit,
       paid_inv.ppn                      AS total_ppn,
       qstat.total_count                 AS total_quotations,
       qstat.rejected_count              AS total_quotations_rejected,
       po.total_count                    AS total_po,
       inv.total_count                   AS total_invoices,
       paid_inv.paid_count               AS total_invoices_paid,
       inv.due_soon                      AS invoices_due_soon,
       inv.overdue                       AS invoices_overdue
  FROM paid_inv, inv, qstat, po, exp;

-- name: dashboard.ts_quotation
SELECT to_char(date_trunc('month', created_at), 'YYYY-MM') AS month,
       COUNT(*)::text                                       AS value
  FROM quotations
 WHERE created_at >= $1::date AND created_at < $2::date
 GROUP BY 1
 ORDER BY 1;

-- name: dashboard.ts_invoice
SELECT to_char(date_trunc('month', invoice_date), 'YYYY-MM') AS month,
       COUNT(*)::text                                         AS value
  FROM invoices
 WHERE invoice_date >= $1::date AND invoice_date < $2::date
 GROUP BY 1
 ORDER BY 1;

-- name: dashboard.ts_revenue
SELECT to_char(date_trunc('month', invoice_date), 'YYYY-MM') AS month,
       COALESCE(SUM(total), 0)::text                          AS value
  FROM invoices
 WHERE status = 'paid'
   AND invoice_date >= $1::date AND invoice_date < $2::date
 GROUP BY 1
 ORDER BY 1;

-- name: dashboard.ts_ppn
SELECT to_char(date_trunc('month', invoice_date), 'YYYY-MM') AS month,
       COALESCE(SUM(ppn_amount), 0)::text                     AS value
  FROM invoices
 WHERE status = 'paid'
   AND invoice_date >= $1::date AND invoice_date < $2::date
 GROUP BY 1
 ORDER BY 1;

-- name: dashboard.ts_profit
-- Book quotation cost once in earliest paid invoice month.
WITH q_cost AS (
  SELECT quotation_id,
         COALESCE(SUM(qty * cost_price) FILTER (WHERE cost_price IS NOT NULL), 0) AS cost
    FROM quotation_items
   GROUP BY quotation_id
),
first_paid AS (
  SELECT quotation_id, MIN(invoice_date) AS first_date
    FROM invoices
   WHERE status = 'paid'
   GROUP BY quotation_id
),
rev AS (
  SELECT to_char(date_trunc('month', invoice_date), 'YYYY-MM') AS month,
         SUM(total)                                            AS revenue
    FROM invoices
   WHERE status = 'paid'
     AND invoice_date >= $1::date AND invoice_date < $2::date
   GROUP BY 1
),
expm AS (
  SELECT to_char(date_trunc('month', fp.first_date), 'YYYY-MM') AS month,
         SUM(qc.cost)                                           AS expenses
    FROM first_paid fp
    JOIN q_cost qc ON qc.quotation_id = fp.quotation_id
   WHERE fp.first_date >= $1::date AND fp.first_date < $2::date
   GROUP BY 1
)
SELECT m.month,
       (COALESCE(rev.revenue, 0) - COALESCE(expm.expenses, 0))::text AS value
  FROM (SELECT month FROM rev UNION SELECT month FROM expm) m
  LEFT JOIN rev  ON rev.month  = m.month
  LEFT JOIN expm ON expm.month = m.month
 ORDER BY m.month;
