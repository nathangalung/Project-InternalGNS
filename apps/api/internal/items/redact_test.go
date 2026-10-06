package items

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/roles"
)

func TestRedact(t *testing.T) {
	price := func() *string { s := "1000.00"; return &s }
	for _, tt := range []struct {
		role          string
		cost, selling bool
	}{
		{roles.Superadmin, true, true},
		{roles.OperationalInput, true, false},
		{roles.FinanceInput, false, true},
	} {
		t.Run(tt.role, func(t *testing.T) {
			v := VendorForItem{CostPrice: price()}
			v.redact(tt.role)
			assert.Equal(t, tt.cost, v.CostPrice != nil, "vendor cost")

			q := ItemQuotation{CostPrice: price(), SellingPrice: "2000.00"}
			q.redact(tt.role)
			assert.Equal(t, tt.cost, q.CostPrice != nil, "quotation cost")
			assert.Equal(t, tt.selling, q.SellingPrice != "", "quotation selling")

			rec := Recommendation{CostPrice: price(), SellingPrice: price()}
			rec.redact(tt.role)
			assert.Equal(t, tt.cost, rec.CostPrice != nil, "recommended cost")
			assert.Equal(t, tt.selling, rec.SellingPrice != nil, "recommended selling")
		})
	}
}
