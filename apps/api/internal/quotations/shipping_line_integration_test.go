package quotations_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
)

// Shipping line without a cost.
// The wizard lets the address go in before the charge is known; a line
// keyed on the cost alone dropped it, and the PO gate then asked for an
// address the user had already typed.
func TestRepo_ShippingLine_AddressWithoutCost(t *testing.T) {
	addr := "Pelabuhan Tanjung Priok"
	blank := "   "
	zero := "0"
	days := 4

	tests := []struct {
		name     string
		address  *string
		cost     *string
		wantLine bool
	}{
		{"address with no cost keeps the line", &addr, nil, true},
		{"address with zero cost keeps the line", &addr, &zero, true},
		{"blank address with no cost has no line", &blank, nil, false},
		{"no address and no cost has no line", nil, nil, false},
	}

	check := func(t *testing.T, ctx context.Context, repo *quotations.Repo, id int64, wantLine bool) {
		t.Helper()
		d, err := repo.GetDetail(ctx, id)
		require.NoError(t, err)
		assert.Equal(t, d.TotalProduk, d.Total, "a Rp 0 line adds nothing to the total")
		var ship *quotations.QuotationItem
		for i := range d.Items {
			if d.Items[i].ItemType == "shipping" {
				ship = &d.Items[i]
			}
		}
		if !wantLine {
			assert.Nil(t, ship)
			return
		}
		require.NotNil(t, ship)
		require.NotNil(t, ship.ShipDestination)
		assert.Equal(t, addr, *ship.ShipDestination)
		assert.Equal(t, "0.00", ship.SellingPrice)
		require.NotNil(t, ship.ShippingDays)
		assert.Equal(t, days, *ship.ShippingDays)
	}

	for _, tc := range tests {
		t.Run("create/"+tc.name, func(t *testing.T) {
			ctx, repo, _ := newRepo(t)
			req := sampleCreate()
			req.ShippingAddress, req.ShippingCost, req.ShippingDays = tc.address, tc.cost, &days
			id, err := repo.Create(ctx, req, seedUserID)
			require.NoError(t, err)
			check(t, ctx, repo, id, tc.wantLine)
		})

		t.Run("update/"+tc.name, func(t *testing.T) {
			ctx, repo, _ := newRepo(t)
			id, err := repo.Create(ctx, sampleCreate(), seedUserID)
			require.NoError(t, err)
			base := sampleCreate()
			_, err = repo.Update(ctx, id, quotations.UpdateRequest{
				DiscountPct:     base.DiscountPct,
				ShippingAddress: tc.address,
				ShippingDays:    &days,
				ShippingCost:    tc.cost,
				Items:           base.Items,
			}, seedUserID, nil)
			require.NoError(t, err)
			check(t, ctx, repo, id, tc.wantLine)
		})
	}
}
