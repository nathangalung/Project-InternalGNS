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

// Operational keeps its tiles.
// Invoice tiles are financial, so they go.
func TestSummary_StripFinancial_StatusTiles(t *testing.T) {
	s := dashboard.Summary{
		QuotationStatuses: []dashboard.StatusCount{{Status: "rejected", Label: "Ditolak", Count: 2}},
		PoStatuses:        []dashboard.StatusCount{{Status: "PENDING", Label: "Pending", Count: 1}},
		InvoiceStatuses:   []dashboard.StatusCount{{Status: "paid", Label: "Dibayar", Count: 3}},
	}
	s.StripFinancial()

	assert.Equal(t, []dashboard.StatusCount{}, s.InvoiceStatuses)
	assert.Len(t, s.QuotationStatuses, 1)
	assert.Len(t, s.PoStatuses, 1)
}
