package dashboard_test

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/nathangalung/internalgns/apps/api/internal/dashboard"
)

func TestSummary_StripFinancial(t *testing.T) {
	s := dashboard.Summary{
		TotalRevenue:            "5000000",
		TotalExpenses:           "3000000",
		TotalProfit:             "2000000",
		TotalPpn:                "600000",
		TotalQuotations:         12,
		TotalQuotationsRejected: 3,
		TotalPo:                 7,
		TotalInvoices:           9,
		TotalInvoicesPaid:       4,
		InvoicesDueSoon:         2,
		InvoicesOverdue:         1,
	}
	s.StripFinancial()

	// Financial figures zeroed.
	assert.Equal(t, "0", s.TotalRevenue)
	assert.Equal(t, "0", s.TotalExpenses)
	assert.Equal(t, "0", s.TotalProfit)
	assert.Equal(t, "0", s.TotalPpn)
	assert.Zero(t, s.TotalInvoices)
	assert.Zero(t, s.TotalInvoicesPaid)
	assert.Zero(t, s.InvoicesDueSoon)
	assert.Zero(t, s.InvoicesOverdue)

	// Operational counts preserved.
	assert.Equal(t, int64(12), s.TotalQuotations)
	assert.Equal(t, int64(3), s.TotalQuotationsRejected)
	assert.Equal(t, int64(7), s.TotalPo)
}
