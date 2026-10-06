package roles_test

import (
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/roles"
)

func TestCapabilities(t *testing.T) {
	tests := []struct {
		role                                     string
		selling, cost, profit, prices, dashboard bool
	}{
		{roles.Superadmin, true, true, true, true, true},
		{roles.Operational, true, true, true, true, false},
		{roles.OperationalInput, false, true, false, false, false},
		{roles.Finance, true, true, true, false, true},
		{roles.FinanceInput, true, false, false, false, false},
		{"", false, false, false, false, false},
		{"admin", false, false, false, false, false},
	}
	for _, tt := range tests {
		t.Run(tt.role, func(t *testing.T) {
			assert.Equal(t, tt.selling, roles.SeesSelling(tt.role), "selling")
			assert.Equal(t, tt.cost, roles.SeesCost(tt.role), "cost")
			assert.Equal(t, tt.profit, roles.SeesProfit(tt.role), "profit")
			assert.Equal(t, tt.prices, roles.SetsPrices(tt.role), "prices")
			assert.Equal(t, tt.dashboard, roles.SeesFinancialDashboard(tt.role), "dashboard")
		})
	}
}
