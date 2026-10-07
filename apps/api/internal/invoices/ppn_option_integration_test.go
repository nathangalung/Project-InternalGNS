package invoices_test

import (
	"context"
	"net/http"
	"strconv"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/invoices"
	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Without PPN all the way through.
// A quotation made without PPN carries no tax base and no PPN, its grand
// total is the subtotal, and the PO and the invoice it makes follow it.
// Switching PPN back on in the header prices the 12% again.
func TestPPNOption_FollowsQuotationToInvoice(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	store := testutil.Store(t)
	qrepo := quotations.NewRepo(tx, store)
	off := false
	cost := "50000"
	qid, err := qrepo.Create(ctx, quotations.CreateRequest{
		ValidityDays:    testutil.Validity(),
		CompanyClientID: seedCompanyID,
		DiscountPct:     "10",
		ShippingCost:    &cost,
		PPNEnabled:      &off,
		Items: testutil.OfferLines(t, ctx, tx, []quotations.CreateItem{{
			RequestedName: "Tanpa PPN", Qty: "2", UnitID: seedUnitID, SellingPrice: "100000",
		}}),
	}, seedUserID)
	require.NoError(t, err)

	d, err := qrepo.GetDetail(ctx, qid)
	require.NoError(t, err)
	assert.False(t, d.PPNEnabled)
	assert.Equal(t, "0.00", d.PpnAmount)
	assert.Equal(t, "0.00", d.DppNilaiLain)
	// 2 x 100.000 less 10%, plus the shipping charge
	assert.Equal(t, "230000.00", d.GrandTotal)

	require.NoError(t, qrepo.ChangeStatus(ctx, qid, "sent", nil, seedUserID))
	require.NoError(t, qrepo.ChangeStatus(ctx, qid, "accepted", nil, seedUserID))
	porepo := purchaseorders.NewRepo(tx, store)
	po, err := porepo.GetByQuotation(ctx, qid)
	require.NoError(t, err)
	assert.False(t, po.PPNEnabled)
	assert.Equal(t, "0.00", po.PoPpnAmount)
	assert.Equal(t, po.PoSubtotal, po.PoGrandTotal)

	attachPOFile(ctx, t, porepo, po.ID)
	testutil.EnterPONumber(t, ctx, tx, po.ID)
	require.NoError(t, porepo.ChangeStatus(ctx, po.ID, purchaseorders.StatusOnProgress, seedUserID))
	require.NoError(t, porepo.ChangeStatus(ctx, po.ID, purchaseorders.StatusDelivered, seedUserID))

	irepo := invoices.NewRepo(tx, store)
	inv, err := irepo.GetDetailByQuotation(ctx, qid)
	require.NoError(t, err)
	assert.False(t, inv.PPNEnabled)
	require.NotNil(t, inv.PpnAmount)
	assert.Zero(t, num(t, *inv.PpnAmount))
	assert.Equal(t, num(t, *inv.Dpp), num(t, *inv.Total))
	items, err := irepo.ListItems(ctx, inv.ID)
	require.NoError(t, err)
	for _, it := range items {
		assert.Equal(t, "0.00", *it.PpnAmount)
		assert.Equal(t, "0.00", *it.PpnRate)
	}

	rec := exportCoretaxXML(t, tx, inv.ID)
	assert.Equal(t, http.StatusUnprocessableEntity, rec.Code)
	assert.Contains(t, rec.Body.String(), "tanpa PPN")
}

// num reads a money string.
func num(t *testing.T, s string) float64 {
	t.Helper()
	v, err := strconv.ParseFloat(s, 64)
	require.NoError(t, err)
	return v
}

// The header switches PPN on and off.
func TestPPNOption_HeaderToggles(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	qrepo := quotations.NewRepo(tx, testutil.Store(t))
	qid, err := qrepo.Create(ctx, quotations.CreateRequest{
		ValidityDays:    testutil.Validity(),
		CompanyClientID: seedCompanyID,
		DiscountPct:     "0",
		Items: testutil.OfferLines(t, ctx, tx, []quotations.CreateItem{{
			RequestedName: "Dengan PPN", Qty: "1", UnitID: seedUnitID, SellingPrice: "120000",
		}}),
	}, seedUserID)
	require.NoError(t, err)
	totals := func() (bool, string, string) {
		d, err := qrepo.GetDetail(context.Background(), qid)
		require.NoError(t, err)
		return d.PPNEnabled, d.PpnAmount, d.GrandTotal
	}
	on, ppn, grand := totals()
	assert.True(t, on, "with PPN by default")
	assert.Equal(t, "13200.00", ppn, "12% of 11/12 of 120.000")
	assert.Equal(t, "133200.00", grand)

	_, err = tx.Exec(ctx, `INSERT INTO quotation_edit_locks (quotation_id, part, user_id, expires_at)
		VALUES ($1, 'header', $2, NOW() + INTERVAL '2 minutes')`, qid, seedUserID)
	require.NoError(t, err)
	off := false
	require.NoError(t, qrepo.UpdateHeader(ctx, qid, quotations.HeaderRequest{DiscountPct: "0", PPNEnabled: &off}, seedUserID))
	on, ppn, grand = totals()
	assert.False(t, on)
	assert.Equal(t, "0.00", ppn)
	assert.Equal(t, "120000.00", grand)

	back := true
	require.NoError(t, qrepo.UpdateHeader(ctx, qid, quotations.HeaderRequest{DiscountPct: "0", PPNEnabled: &back}, seedUserID))
	_, ppn, grand = totals()
	assert.Equal(t, "13200.00", ppn)
	assert.Equal(t, "133200.00", grand)
}
