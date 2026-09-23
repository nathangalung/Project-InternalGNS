package purchaseorders_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// PO totals equal the invoice they produce.
// Prices are chosen so per-line rounding drifts from header rounding: a
// formula that rounds on the header sum instead of per line fails here.
func TestRepo_PoTotals_MatchCreatedInvoice(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	qID, poID := acceptedQuotationWithPO(t, tx)
	repo := purchaseorders.NewRepo(tx, testutil.Store(t))

	addr := "Tanjung Priok"
	shipCost := "125000.55"
	_, err := repo.UpdateItems(ctx, poID, purchaseorders.UpdateItemsRequest{
		DiscountPct:     "7",
		ShippingAddress: &addr,
		ShippingCost:    &shipCost,
		Items: []purchaseorders.UpdateItemsLine{
			{
				ItemName: "Drift A", Qty: "3", UnitID: int16Ptr(seedUnitID),
				SellingPrice: "333333.33", CostPrice: strPtr("200000"),
			},
			{
				ItemName: "Drift B", Qty: "7", UnitID: int16Ptr(seedUnitID),
				SellingPrice: "99999.99", CostPrice: strPtr("50000.05"),
			},
		},
	}, seedUserID, nil)
	require.NoError(t, err)

	po, err := repo.GetByID(ctx, poID)
	require.NoError(t, err)
	assert.Equal(t, "7.00", po.DiscountPct)

	require.NoError(t, repo.UpdateFile(ctx, poID, testPOFile, seedUserID))
	require.NoError(t, repo.ChangeStatus(ctx, poID, purchaseorders.StatusOnProgress, seedUserID))
	require.NoError(t, repo.ChangeStatus(ctx, poID, purchaseorders.StatusDelivered, seedUserID))

	var dpp, dnl, ppn, total, discount string
	require.NoError(t, tx.QueryRow(ctx, `
		SELECT dpp::text, dpp_nilai_lain::text, ppn_amount::text,
		       total::text, total_discount::text
		FROM invoices WHERE quotation_id = $1`, qID).
		Scan(&dpp, &dnl, &ppn, &total, &discount))

	assert.Equal(t, dpp, po.PoSubtotal, "po subtotal is the invoice DPP")
	assert.Equal(t, dnl, po.PoDppNilaiLain)
	assert.Equal(t, ppn, po.PoPpnAmount)
	assert.Equal(t, total, po.PoGrandTotal)
	assert.Equal(t, discount, po.PoTotalDiscount)
}

// Profit is net of the PO discount, as the invoice bills it.
func TestRepo_PoTotalProfit_IsNetOfDiscount(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, poID := acceptedQuotationWithPO(t, tx)
	repo := purchaseorders.NewRepo(tx, testutil.Store(t))

	_, err := repo.UpdateItems(ctx, poID, purchaseorders.UpdateItemsRequest{
		DiscountPct: "10",
		Items: []purchaseorders.UpdateItemsLine{{
			ItemName: "Discounted", Qty: "2", UnitID: int16Ptr(seedUnitID),
			SellingPrice: "100000", CostPrice: strPtr("60000"),
		}},
	}, seedUserID, nil)
	require.NoError(t, err)

	po, err := repo.GetByID(ctx, poID)
	require.NoError(t, err)
	// 2 * 100000 * 0.9 = 180000 sold, 2 * 60000 = 120000 cost.
	assert.Equal(t, "60000.00", po.PoTotalProfit)
	assert.Equal(t, "200000.00", po.PoTotalProduk)
}
