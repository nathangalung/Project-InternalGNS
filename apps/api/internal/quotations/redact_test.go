package quotations

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/roles"
)

// Each side hides alone.
// Quotations never reach finance input today, but the rule is the same
// one every feature applies, so a cost-blind role loses harga beli here too.
func TestRedact_PerSide(t *testing.T) {
	cost := "60000.00"
	for _, tt := range []struct {
		role          string
		cost, selling bool
	}{
		{roles.Superadmin, true, true},
		{roles.OperationalInput, true, false},
		{roles.FinanceInput, false, true},
	} {
		t.Run(tt.role, func(t *testing.T) {
			it := QuotationItem{SellingPrice: "100000.00", CostPrice: &cost}
			it.redact(tt.role)
			assert.Equal(t, tt.selling, it.SellingPrice != "", "line selling")
			assert.Equal(t, tt.cost, it.CostPrice != nil, "line cost")

			row := ListRow{GrandTotal: "1", TotalHargaBeli: "1"}
			row.redact(tt.role)
			assert.Equal(t, tt.selling, row.GrandTotal != "", "list total")
			assert.Equal(t, tt.cost, row.TotalHargaBeli != "", "list cost")

			rev := RevisionRow{GrandTotal: "1", TotalProduk: "1"}
			rev.redact(tt.role)
			assert.Equal(t, tt.selling, rev.GrandTotal != "", "revision total")
			assert.Equal(t, tt.selling, rev.TotalProduk != "", "revision produk")
		})
	}
}
