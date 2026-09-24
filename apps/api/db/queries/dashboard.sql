-- name: dashboard.summary
-- Totals over [$1, $2); a NULL bound leaves that side open, so the overview
-- passes neither and reads all time. Each figure keys on the same date and
-- predicate as its dashboard.ts_* series, so an export's Ringkasan equals
-- the sum of its Bulanan column: invoices by invoice_date, cost in the month
-- of the quotation's first paid invoice, quotations by created_at, POs by
-- po_date. Revenue is the DPP base, never the PPN-inclusive total: PPN is
-- collected for the state, so booking it as income would inflate revenue
-- and profit. Due soon and Terlambat are as of today.
WITH paid_inv AS (
  SELECT COALESCE(SUM(dpp), 0)          AS revenue,
         COALESCE(SUM(ppn_amount), 0)   AS ppn,
         COUNT(*)                       AS paid_count
    FROM invoices
   WHERE status = 'paid'
     AND ($1::date IS NULL OR invoice_date >= $1::date)
     AND ($2::date IS NULL OR invoice_date <  $2::date)
),
-- Terlambat and due soon share fn_invoice_effective_status with the invoice
-- page, so a stored overdue is never also due soon.
inv AS (
  SELECT COUNT(*)                                                         AS total_count,
         COUNT(*) FILTER (WHERE eff IN ('draft', 'sent')
                            AND due_date BETWEEN CURRENT_DATE AND CURRENT_DATE + 7) AS due_soon,
         COUNT(*) FILTER (WHERE eff = 'overdue')                          AS overdue
    FROM (SELECT fn_invoice_effective_status(status, due_date) AS eff, due_date
            FROM invoices
           WHERE status <> 'cancelled'
             AND ($1::date IS NULL OR invoice_date >= $1::date)
             AND ($2::date IS NULL OR invoice_date <  $2::date)) i
),
qstat AS (
  SELECT COUNT(*)                                                          AS total_count,
         COUNT(*) FILTER (WHERE status = 'rejected')                       AS rejected_count
    FROM quotations
   WHERE ($1::date IS NULL OR created_at >= $1::date)
     AND ($2::date IS NULL OR created_at <  $2::date)
),
-- Cancelled POs are inactive.
po AS (
  SELECT COUNT(*) FILTER (WHERE status <> 'CANCELLED') AS total_count
    FROM purchase_orders
   WHERE ($1::date IS NULL OR po_date >= $1::date)
     AND ($2::date IS NULL OR po_date <  $2::date)
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
-- Cost is booked once, when the quotation's first invoice is paid.
first_paid AS (
  SELECT quotation_id, MIN(invoice_date) AS first_date
    FROM invoices
   WHERE status = 'paid'
   GROUP BY quotation_id
),
exp AS (
  SELECT COALESCE(SUM(COALESCE(pc.cost, qc.cost, 0)), 0) AS expenses
    FROM first_paid fp
    LEFT JOIN po_cost pc ON pc.quotation_id = fp.quotation_id
    LEFT JOIN q_cost  qc ON qc.quotation_id = fp.quotation_id
   WHERE ($1::date IS NULL OR fp.first_date >= $1::date)
     AND ($2::date IS NULL OR fp.first_date <  $2::date)
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

-- name: dashboard.status_counts
-- One row per entity status. Invoices count by effective status, the rule
-- the invoice page and dashboard.summary share.
SELECT 'quotation' AS entity, status, COUNT(*)::bigint AS count
  FROM quotations
 GROUP BY status
UNION ALL
SELECT 'purchase_order', status, COUNT(*)::bigint
  FROM purchase_orders
 GROUP BY status
UNION ALL
SELECT 'invoice', fn_invoice_effective_status(status, due_date), COUNT(*)::bigint
  FROM invoices
 GROUP BY 2;

-- name: dashboard.ts_quotation
SELECT to_char(date_trunc($3::text, created_at),
               CASE $3::text WHEN 'day' THEN 'YYYY-MM-DD' ELSE 'YYYY-MM' END) AS month,
       COUNT(*)::text                                       AS value
  FROM quotations
 WHERE created_at >= $1::date AND created_at < $2::date
 GROUP BY 1
 ORDER BY 1;

-- name: dashboard.ts_invoice
-- A cancelled invoice is void; its Pengganti is the one counted.
SELECT to_char(date_trunc($3::text, invoice_date), CASE $3::text WHEN 'day' THEN 'YYYY-MM-DD' ELSE 'YYYY-MM' END) AS month,
       COUNT(*)::text                                         AS value
  FROM invoices
 WHERE status <> 'cancelled'
   AND invoice_date >= $1::date AND invoice_date < $2::date
 GROUP BY 1
 ORDER BY 1;

-- name: dashboard.ts_revenue
-- DPP base, matching dashboard.summary: PPN is not revenue.
SELECT to_char(date_trunc($3::text, invoice_date), CASE $3::text WHEN 'day' THEN 'YYYY-MM-DD' ELSE 'YYYY-MM' END) AS month,
       COALESCE(SUM(dpp), 0)::text                            AS value
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
         SUM(dpp)                                              AS revenue
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
