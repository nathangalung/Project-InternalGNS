package quotations_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
)

// Quotation totals match the PO.
// 3 x 1000.55 at 10% lands on a half cent (300.165): a header that sums the
// per-line discount rounds it to 300.17, while the PO and the invoice net
// each line (2701.485 -> 2701.49), so the client was quoted one cent less
// than it was billed. A pct past column scale is stored rounded on the
// lines, so the header must use that pct too. The grand totals agree here
// only because the PO's per-line PPN happens to round to the header's.
func TestRepo_HeaderDiscount_QuotationMatchesPO(t *testing.T) {
	build := func(pct, qty, price string) quotations.CreateRequest {
		req := sampleCreate()
		cost := "100000"
		req.ShippingCost = &cost
		req.DiscountPct = pct
		req.Items = req.Items[:1]
		req.Items[0].Qty = qty
		req.Items[0].SellingPrice = price
		return req
	}

	tests := []struct {
		name         string
		update       bool
		pct          string
		qty          string
		price        string
		wantDiscount string
		wantSubtotal string
		wantGrand    string
	}{
		{"half cent on create", false, "10", "3", "1000.55", "300.16", "102701.49", "113998.65"},
		{"half cent on update", true, "10", "3", "1000.55", "300.16", "102701.49", "113998.65"},
		{"pct past scale on create", false, "7.125", "1", "1000", "71.30", "100928.70", "112030.86"},
		{"pct past scale on update", true, "7.125", "1", "1000", "71.30", "100928.70", "112030.86"},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ctx, repo, tx := newRepo(t)
			want := build(tc.pct, tc.qty, tc.price)
			req := want
			if tc.update {
				req = sampleCreate()
			}
			id, err := repo.Create(ctx, req, seedUserID)
			require.NoError(t, err)
			if tc.update {
				_, err = repo.Update(ctx, id, quotations.UpdateRequest{
					DiscountPct:     want.DiscountPct,
					ShippingAddress: want.ShippingAddress,
					ShippingDays:    want.ShippingDays,
					ShippingCost:    want.ShippingCost,
					Items:           want.Items,
				}, seedUserID, nil)
				require.NoError(t, err)
			}

			d, err := repo.GetDetail(ctx, id)
			require.NoError(t, err)
			assert.Equal(t, tc.wantDiscount, d.TotalDiscount)
			assert.Equal(t, tc.wantSubtotal, d.Subtotal)
			assert.Equal(t, tc.wantGrand, d.GrandTotal)

			var lineSum string
			require.NoError(t, tx.QueryRow(ctx,
				`SELECT SUM(subtotal)::text FROM quotation_items WHERE quotation_id = $1`, id).
				Scan(&lineSum))
			assert.Equal(t, lineSum, d.Subtotal, "header subtotal is the sum of line subtotals")

			require.NoError(t, repo.ChangeStatus(ctx, id, quotations.StatusSent, nil, seedUserID))
			require.NoError(t, repo.ChangeStatus(ctx, id, quotations.StatusAccepted, nil, seedUserID))

			var poSubtotal, poGrand, poDiscount string
			require.NoError(t, tx.QueryRow(ctx, `
				SELECT t.po_subtotal::text, t.po_grand_total::text, t.po_total_discount::text
				FROM purchase_orders po
				JOIN v_po_totals t ON t.po_id = po.id
				WHERE po.quotation_id = $1`, id).
				Scan(&poSubtotal, &poGrand, &poDiscount))
			assert.Equal(t, poSubtotal, d.Subtotal)
			assert.Equal(t, poGrand, d.GrandTotal)
			assert.Equal(t, poDiscount, d.TotalDiscount)
		})
	}
}
