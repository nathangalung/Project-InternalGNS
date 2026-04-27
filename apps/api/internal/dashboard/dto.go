package dashboard

// Summary aggregates business totals.
type Summary struct {
	TotalRevenue            string `db:"total_revenue"             json:"totalRevenue"`
	TotalExpenses           string `db:"total_expenses"            json:"totalExpenses"`
	TotalProfit             string `db:"total_profit"              json:"totalProfit"`
	TotalPpn                string `db:"total_ppn"                 json:"totalPpn"`
	TotalQuotations         int64  `db:"total_quotations"          json:"totalQuotations"`
	TotalQuotationsRejected int64  `db:"total_quotations_rejected" json:"totalQuotationsRejected"`
	TotalPo                 int64  `db:"total_po"                  json:"totalPo"`
	TotalInvoices           int64  `db:"total_invoices"            json:"totalInvoices"`
	TotalInvoicesPaid       int64  `db:"total_invoices_paid"       json:"totalInvoicesPaid"`
	InvoicesDueSoon         int64  `db:"invoices_due_soon"         json:"invoicesDueSoon"`
	InvoicesOverdue         int64  `db:"invoices_overdue"          json:"invoicesOverdue"`
}

// TimeseriesPoint is one bucket.
type TimeseriesPoint struct {
	Month string `db:"month" json:"month"`
	Value string `db:"value" json:"value"`
}
