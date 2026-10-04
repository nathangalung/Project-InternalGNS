package invoices_test

import (
	"context"
	"strconv"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
	"github.com/nathangalung/internalgns/apps/api/internal/invoices"
	"github.com/nathangalung/internalgns/apps/api/internal/pdfgen"
	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Discounted line plus shipping line.
func discountedPOWithInvoice(t *testing.T, tx pgx.Tx) int64 {
	t.Helper()
	ctx := context.Background()
	store := testutil.Store(t)

	addr := "Pelabuhan Tanjung Priok"
	cost := "50000"
	qrepo := quotations.NewRepo(tx, store)
	qid, err := qrepo.Create(ctx, quotations.CreateRequest{
		ValidityDays:    testutil.Validity(),
		CompanyClientID: seedCompanyID,
		DiscountPct:     "10",
		ShippingAddress: &addr,
		ShippingCost:    &cost,
		Items: testutil.OfferLines(t, ctx, tx, []quotations.CreateItem{{
			RequestedName: "Discounted Product",
			Qty:           "3",
			UnitID:        seedUnitID,
			SellingPrice:  "100000",
		}}),
	}, seedUserID)
	require.NoError(t, err)
	require.NoError(t, qrepo.ChangeStatus(ctx, qid, "sent", nil, seedUserID))
	require.NoError(t, qrepo.ChangeStatus(ctx, qid, "accepted", nil, seedUserID))

	porepo := purchaseorders.NewRepo(tx, store)
	po, err := porepo.GetByQuotation(ctx, qid)
	require.NoError(t, err)
	attachPOFile(ctx, t, porepo, po.ID)
	require.NoError(t, porepo.ChangeStatus(ctx, po.ID, purchaseorders.StatusOnProgress, seedUserID))
	require.NoError(t, porepo.ChangeStatus(ctx, po.ID, purchaseorders.StatusDelivered, seedUserID))

	inv, err := invoices.NewRepo(tx, store).GetByQuotation(ctx, qid)
	require.NoError(t, err)
	return inv.ID
}

func mustF(t *testing.T, s string) float64 {
	t.Helper()
	v, err := strconv.ParseFloat(s, 64)
	require.NoError(t, err)
	return v
}

// Printed totals block must balance.
// TotalProduk - Diskon = DPP.
func TestExport_TotalsBlockBalances(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	invID := discountedPOWithInvoice(t, tx)

	store := testutil.Store(t)
	repo := invoices.NewRepo(tx, store)
	inv, err := repo.GetByID(ctx, invID)
	require.NoError(t, err)
	items, err := repo.ListItems(ctx, invID)
	require.NoError(t, err)
	require.Len(t, items, 2, "want one product line and one shipping line")

	require.NotNil(t, inv.Dpp)
	require.NotNil(t, inv.TotalDiscount)

	// Gross is snapshotted per line; the discount lives on the header.
	var product, shipping invoices.InvoiceItem
	for _, it := range items {
		if it.LineType == "product" {
			product = it
		} else {
			shipping = it
		}
	}
	require.NotNil(t, product.GrossUnitPrice)
	require.NotNil(t, shipping.GrossUnitPrice)
	assert.Equal(t, 100000.0, mustF(t, *product.GrossUnitPrice))
	assert.Equal(t, 90000.0, mustF(t, product.UnitPrice), "net unit price carries the 10 percent discount")
	// Shipping is never discounted, so gross equals net.
	assert.Equal(t, mustF(t, shipping.UnitPrice), mustF(t, *shipping.GrossUnitPrice))

	// Line amounts use gross and cover every line, shipping included.
	sum := "0"
	for _, it := range items {
		gross := it.UnitPrice
		if it.GrossUnitPrice != nil {
			gross = *it.GrossUnitPrice
		}
		sum = pdfgen.BigAdd(sum, pdfgen.BigMul(it.Qty, gross))
	}
	assert.Equal(t, 350000.0, mustF(t, sum), "3 x 100000 gross plus 50000 shipping")
	assert.Equal(t, 30000.0, mustF(t, *inv.TotalDiscount), "10 percent of 300000")
	assert.Equal(t, 320000.0, mustF(t, *inv.Dpp), "270000 net plus 50000 shipping")

	// The identity the tax document has to satisfy, on raw numerics.
	assert.InDelta(t,
		mustF(t, *inv.Dpp),
		mustF(t, sum)-mustF(t, *inv.TotalDiscount),
		0.001,
		"TotalProduk - Diskon must equal DPP",
	)

	// And the same three figures as the builder wires them into the template.
	h := invoices.NewExportHandler(
		repo,
		clients.NewRepo(tx, store),
		quotations.NewRepo(tx, store),
		purchaseorders.NewRepo(tx, store),
		pdfgen.NewRenderer(t.TempDir()),
		deps.PdfSettings{},
	)
	totals := h.PDFTotalsForTest(ctx, inv, items)
	assert.Equal(t, pdfgen.FormatIDRCents(sum), totals.TotalProduk)
	assert.Equal(t, pdfgen.FormatIDRCents(*inv.TotalDiscount), totals.Diskon)
	assert.Equal(t, pdfgen.FormatIDRCents(*inv.Dpp), totals.DPP)
	assert.NotEmpty(t, totals.Diskon, "a real discount must print a Diskon row")

	// Per line the PDF shows the gross price, not the net one.
	assert.Contains(t, totals.LineUnitPrices, pdfgen.FormatIDRCents("100000"))
	assert.NotContains(t, totals.LineUnitPrices, pdfgen.FormatIDRCents("90000"))
}

// Historical rows use net price.
// They have no gross snapshot to discount from.
func TestExport_TotalsBlock_NoDiscountHidesRow(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	_, _, invID := deliveredPOWithInvoice(t, tx)

	store := testutil.Store(t)
	repo := invoices.NewRepo(tx, store)
	inv, err := repo.GetByID(ctx, invID)
	require.NoError(t, err)
	items, err := repo.ListItems(ctx, invID)
	require.NoError(t, err)

	require.NotNil(t, inv.TotalDiscount)
	assert.Equal(t, 0.0, mustF(t, *inv.TotalDiscount))

	h := invoices.NewExportHandler(
		repo,
		clients.NewRepo(tx, store),
		quotations.NewRepo(tx, store),
		purchaseorders.NewRepo(tx, store),
		pdfgen.NewRenderer(t.TempDir()),
		deps.PdfSettings{},
	)
	totals := h.PDFTotalsForTest(ctx, inv, items)
	assert.Empty(t, totals.Diskon, "zero discount must not print a Diskon row")
	assert.Equal(t, pdfgen.FormatIDRCents(*inv.Dpp), totals.DPP)
	assert.Equal(t, totals.DPP, totals.TotalProduk, "no discount means the two agree")
}

// The PDF prints the sen.
// fn_create_invoice keeps sen on every figure, PPN included even on a whole
// DPP, so a truncated print would not add up (5.000 + 550 = 5.551) and would
// differ from the VAT filed to Coretax.
func TestExport_PrintsSen(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	s := func(v string) *string { return &v }
	inv := invoices.Invoice{
		Dpp:           s("5000.95"),
		DppNilaiLain:  s("4584.20"),
		PpnAmount:     s("550.10"),
		Total:         s("5551.05"),
		TotalDiscount: s("0.00"),
	}
	items := []invoices.InvoiceItem{
		{LineType: "product", ItemName: "Tali", Qty: "1", UnitPrice: "5000.95"},
	}

	got := newExportHandler(t, tx).PDFTotalsForTest(ctx, inv, items)
	assert.Equal(t, "Rp~5.000,95", got.TotalProduk)
	assert.Equal(t, "Rp~5.000,95", got.DPP)
	assert.Equal(t, "Rp~4.584,20", got.DPPNilaiLain)
	assert.Equal(t, "Rp~550,10", got.PPN)
	assert.Equal(t, "Rp~5.551,05", got.Total)
	assert.Equal(t, []string{"Rp~5.000,95"}, got.LineUnitPrices)
	assert.Equal(t, []string{"Rp~5.000,95"}, got.LineAmounts)
}

// Fractional qty rounds like Postgres.
// ROUND(2.5 x 1234.57, 2) is 3086.43, half away from zero, so the printed
// line and TotalProduk must land on the stored DPP, not a binary 3086.42.
func TestExport_FractionalQtyMatchesDPP(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	store := testutil.Store(t)

	qrepo := quotations.NewRepo(tx, store)
	qid, err := qrepo.Create(ctx, quotations.CreateRequest{
		ValidityDays:    testutil.Validity(),
		CompanyClientID: seedCompanyID,
		DiscountPct:     "0",
		Items: testutil.OfferLines(t, ctx, tx, []quotations.CreateItem{{
			RequestedName: "Tali Tambang",
			Qty:           "2.5",
			UnitID:        seedUnitID,
			SellingPrice:  "1234.57",
		}}),
	}, seedUserID)
	require.NoError(t, err)
	require.NoError(t, qrepo.ChangeStatus(ctx, qid, "sent", nil, seedUserID))
	require.NoError(t, qrepo.ChangeStatus(ctx, qid, "accepted", nil, seedUserID))

	porepo := purchaseorders.NewRepo(tx, store)
	po, err := porepo.GetByQuotation(ctx, qid)
	require.NoError(t, err)
	attachPOFile(ctx, t, porepo, po.ID)
	require.NoError(t, porepo.ChangeStatus(ctx, po.ID, purchaseorders.StatusOnProgress, seedUserID))
	require.NoError(t, porepo.ChangeStatus(ctx, po.ID, purchaseorders.StatusDelivered, seedUserID))

	repo := invoices.NewRepo(tx, store)
	inv, err := repo.GetByQuotation(ctx, qid)
	require.NoError(t, err)
	items, err := repo.ListItems(ctx, inv.ID)
	require.NoError(t, err)
	require.NotNil(t, inv.Dpp)
	assert.Equal(t, 3086.43, mustF(t, *inv.Dpp), "Postgres rounds half away from zero")

	got := newExportHandler(t, tx).PDFTotalsForTest(ctx, inv, items)
	assert.Empty(t, got.Diskon, "no discount, no Diskon row")
	assert.Equal(t, []string{"Rp~3.086,43"}, got.LineAmounts)
	assert.Equal(t, "Rp~3.086,43", got.TotalProduk)
	assert.Equal(t, got.DPP, got.TotalProduk, "TotalProduk - Diskon must equal DPP")
}
