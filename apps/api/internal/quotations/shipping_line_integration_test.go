package quotations_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
)

// Shipping line without a cost.
// The wizard lets the address or the days go in before the charge is
// known. A line keyed on the cost alone dropped the address, and the PO
// gate then asked for one the user had already typed; a line keyed on the
// address or cost dropped Waktu Pengiriman entered on its own.
func TestRepo_ShippingLine_AddressWithoutCost(t *testing.T) {
	addr := "Pelabuhan Tanjung Priok"
	blank := "   "
	zero := "0"
	four := 4

	tests := []struct {
		name     string
		address  *string
		cost     *string
		days     *int
		wantLine bool
	}{
		{"address with no cost keeps the line", &addr, nil, &four, true},
		{"address with zero cost keeps the line", &addr, &zero, &four, true},
		{"days alone keep the line", nil, nil, &four, true},
		{"days with a blank address keep the line", &blank, &zero, &four, true},
		{"blank address with no cost or days has no line", &blank, nil, nil, false},
		{"nothing has no line", nil, nil, nil, false},
	}

	check := func(t *testing.T, ctx context.Context, repo *quotations.Repo, id int64, tc struct {
		name     string
		address  *string
		cost     *string
		days     *int
		wantLine bool
	}) {
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
		if !tc.wantLine {
			assert.Nil(t, ship)
			return
		}
		require.NotNil(t, ship)
		if tc.address == &addr {
			require.NotNil(t, ship.ShipDestination)
			assert.Equal(t, addr, *ship.ShipDestination)
		}
		assert.Equal(t, "0.00", ship.SellingPrice)
		require.NotNil(t, ship.ShippingDays)
		assert.Equal(t, four, *ship.ShippingDays)
	}

	for _, tc := range tests {
		t.Run("create/"+tc.name, func(t *testing.T) {
			ctx, repo, _ := newRepo(t)
			req := sampleCreate()
			req.ShippingAddress, req.ShippingCost, req.ShippingDays = tc.address, tc.cost, tc.days
			id, err := repo.Create(ctx, req, seedUserID)
			require.NoError(t, err)
			check(t, ctx, repo, id, tc)
		})

		t.Run("update/"+tc.name, func(t *testing.T) {
			ctx, repo, _ := newRepo(t)
			id, err := repo.Create(ctx, sampleCreate(), seedUserID)
			require.NoError(t, err)
			base := sampleCreate()
			_, err = repo.Update(ctx, id, quotations.UpdateRequest{
				DiscountPct:     base.DiscountPct,
				ShippingAddress: tc.address,
				ShippingDays:    tc.days,
				ShippingCost:    tc.cost,
				Items:           base.Items,
			}, seedUserID, nil)
			require.NoError(t, err)
			check(t, ctx, repo, id, tc)
		})

		t.Run("header/"+tc.name, func(t *testing.T) {
			ctx, repo, _ := newRepo(t)
			id, err := repo.Create(ctx, sampleCreate(), seedUserID)
			require.NoError(t, err)
			_, err = repo.Lock(ctx, id, "header", seedUserID)
			require.NoError(t, err)
			require.NoError(t, repo.UpdateHeader(ctx, id, quotations.HeaderRequest{
				DiscountPct:     "0",
				ShippingAddress: tc.address,
				ShippingDays:    tc.days,
				ShippingCost:    tc.cost,
			}, seedUserID))
			check(t, ctx, repo, id, tc)
		})
	}
}
