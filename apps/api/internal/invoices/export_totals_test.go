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

// Discounted product line plus a shipping line.
func discountedPOWithInvoice(t *testing.T, tx pgx.Tx) int64 {
	t.Helper()
	ctx := context.Background()
	store := testutil.Store(t)

	addr := "Pelabuhan Tanjung Priok"
	cost := "50000"
	qrepo := quotations.NewRepo(tx, store)
	qid, err := qrepo.Create(ctx, quotations.CreateRequest{
		CompanyClientID: seedCompanyID,
		DiscountPct:     "10",
		ShippingAddress: &addr,
		ShippingCost:    &cost,
		Items: []quotations.CreateItem{{
			RequestedName: "Discounted Product",
			Qty:           "3",
			UnitID:        seedUnitID,
			SellingPrice:  "100000",
		}},
	}, seedUserID)
	require.NoError(t, err)
	require.NoError(t, qrepo.ChangeStatus(ctx, qid, "sent", nil, seedUserID))
	require.NoError(t, qrepo.ChangeStatus(ctx, qid, "accepted", nil, seedUserID))

	porepo := purchaseorders.NewRepo(tx, store)
	po, err := porepo.GetByQuotation(ctx, qid)
	require.NoError(t, err)
	require.NoError(t, porepo.ChangeStatus(ctx, po.ID, purchaseorders.StatusUploaded, seedUserID))
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

// The printed totals block must balance: TotalProduk - Diskon = DPP.
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
	assert.Equal(t, pdfgen.FormatIDR(sum), totals.TotalProduk)
	assert.Equal(t, pdfgen.FormatIDR(*inv.TotalDiscount), totals.Diskon)
	assert.Equal(t, pdfgen.FormatIDR(*inv.Dpp), totals.DPP)
	assert.NotEmpty(t, totals.Diskon, "a real discount must print a Diskon row")

	// Per line the PDF shows the gross price, not the net one.
	assert.Contains(t, totals.LineUnitPrices, pdfgen.FormatIDR("100000"))
	assert.NotContains(t, totals.LineUnitPrices, pdfgen.FormatIDR("90000"))
}

// Historical rows have no gross snapshot and fall back to the net price.
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
	assert.Equal(t, pdfgen.FormatIDR(*inv.Dpp), totals.DPP)
	assert.Equal(t, totals.DPP, totals.TotalProduk, "no discount means the two agree")
}
