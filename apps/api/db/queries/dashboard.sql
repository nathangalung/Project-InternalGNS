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
-- Prefer PO actuals (re-edited cost after PO creation), fall back to quotation.
po_cost AS (
  SELECT po.quotation_id,
         COALESCE(SUM(poi.qty * poi.cost_price) FILTER (WHERE poi.cost_price IS NOT NULL), 0) AS cost
    FROM purchase_orders po
    JOIN purchase_order_items poi ON poi.po_id = po.id AND poi.item_type = 'product'
   GROUP BY po.quotation_id
),
q_cost AS (
  SELECT quotation_id,
         COALESCE(SUM(qty * cost_price) FILTER (WHERE cost_price IS NOT NULL), 0) AS cost
    FROM quotation_items
   GROUP BY quotation_id
),
-- Sum cost across quotations with any paid invoice; PO cost wins when present.
exp AS (
  SELECT COALESCE(SUM(COALESCE(pc.cost, qc.cost, 0)), 0) AS expenses
    FROM (SELECT DISTINCT quotation_id FROM invoices WHERE status = 'paid') pq
    LEFT JOIN po_cost pc ON pc.quotation_id = pq.quotation_id
    LEFT JOIN q_cost  qc ON qc.quotation_id = pq.quotation_id
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
SELECT to_char(date_trunc($3::text, created_at),
               CASE $3::text WHEN 'day' THEN 'YYYY-MM-DD' ELSE 'YYYY-MM' END) AS month,
       COUNT(*)::text                                       AS value
  FROM quotations
 WHERE created_at >= $1::date AND created_at < $2::date
 GROUP BY 1
 ORDER BY 1;

-- name: dashboard.ts_invoice
SELECT to_char(date_trunc($3::text, invoice_date), CASE $3::text WHEN 'day' THEN 'YYYY-MM-DD' ELSE 'YYYY-MM' END) AS month,
       COUNT(*)::text                                         AS value
  FROM invoices
 WHERE invoice_date >= $1::date AND invoice_date < $2::date
 GROUP BY 1
 ORDER BY 1;

-- name: dashboard.ts_revenue
SELECT to_char(date_trunc($3::text, invoice_date), CASE $3::text WHEN 'day' THEN 'YYYY-MM-DD' ELSE 'YYYY-MM' END) AS month,
       COALESCE(SUM(total), 0)::text                          AS value
  FROM invoices
 WHERE status = 'paid'
   AND invoice_date >= $1::date AND invoice_date < $2::date
 GROUP BY 1
 ORDER BY 1;

-- name: dashboard.ts_ppn
SELECT to_char(date_trunc($3::text, invoice_date), CASE $3::text WHEN 'day' THEN 'YYYY-MM-DD' ELSE 'YYYY-MM' END) AS month,
       COALESCE(SUM(ppn_amount), 0)::text                     AS value
  FROM invoices
 WHERE status = 'paid'
   AND invoice_date >= $1::date AND invoice_date < $2::date
 GROUP BY 1
 ORDER BY 1;

-- name: dashboard.ts_profit
-- Book cost once in earliest paid invoice month; prefer PO actuals over quotation.
WITH po_cost AS (
  SELECT po.quotation_id,
         COALESCE(SUM(poi.qty * poi.cost_price) FILTER (WHERE poi.cost_price IS NOT NULL), 0) AS cost
    FROM purchase_orders po
    JOIN purchase_order_items poi ON poi.po_id = po.id AND poi.item_type = 'product'
   GROUP BY po.quotation_id
),
q_cost AS (
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
  SELECT to_char(date_trunc($3::text, invoice_date), CASE $3::text WHEN 'day' THEN 'YYYY-MM-DD' ELSE 'YYYY-MM' END) AS month,
         SUM(total)                                            AS revenue
    FROM invoices
   WHERE status = 'paid'
     AND invoice_date >= $1::date AND invoice_date < $2::date
   GROUP BY 1
),
expm AS (
  SELECT to_char(date_trunc($3::text, fp.first_date),
                 CASE $3::text WHEN 'day' THEN 'YYYY-MM-DD' ELSE 'YYYY-MM' END) AS month,
         SUM(COALESCE(pc.cost, qc.cost, 0))                     AS expenses
    FROM first_paid fp
    LEFT JOIN po_cost pc ON pc.quotation_id = fp.quotation_id
    LEFT JOIN q_cost  qc ON qc.quotation_id = fp.quotation_id
   WHERE fp.first_date >= $1::date AND fp.first_date < $2::date
   GROUP BY 1
)
SELECT m.month,
       (COALESCE(rev.revenue, 0) - COALESCE(expm.expenses, 0))::text AS value
  FROM (SELECT month FROM rev UNION SELECT month FROM expm) m
  LEFT JOIN rev  ON rev.month  = m.month
  LEFT JOIN expm ON expm.month = m.month
 ORDER BY m.month;
