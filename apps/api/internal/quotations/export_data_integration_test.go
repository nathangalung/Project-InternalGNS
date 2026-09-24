package quotations_test

import (
	"strconv"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/pdfgen"
	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
)

// cents parses a NUMERIC(15,2) string.
func cents(t *testing.T, s string) int64 {
	t.Helper()
	whole, frac, _ := strings.Cut(s, ".")
	frac = (frac + "00")[:2]
	n, err := strconv.ParseInt(whole+frac, 10, 64)
	require.NoError(t, err, "numeric %q", s)
	return n
}

// The printed column reconciles with the stored quotation.
func TestBuildExportData_ReconcilesWithStoredQuotation(t *testing.T) {
	ctx, repo, tx := newRepo(t)

	shipCost := "150.37"
	shipAddr := "Tanjung Priok"
	req := quotations.CreateRequest{
		CompanyClientID: seedCompanyID,
		DiscountPct:     "7.5",
		ShippingAddress: &shipAddr,
		ShippingCost:    &shipCost,
		Items: []quotations.CreateItem{
			{
				RequestedName: "PUNCHING TOOL SET DIES & TABLE",
				OfferedItemID: int64Ptr(seedItemID),
				Qty:           "3", UnitID: seedUnitID, SellingPrice: "1234.56", CostPrice: strPtr("1000"),
			},
			{
				// Matched but unpriced: prints as No Offer.
				RequestedName: "FIRE HOSE COUPLING",
				OfferedItemID: int64Ptr(seedItemID),
				Qty:           "1", UnitID: seedUnitID, SellingPrice: "0",
			},
			{
				// Priced but unmatched: still quoted.
				RequestedName: "KABEL NYM 3x2.5",
				Qty:           "2", UnitID: seedUnitID, SellingPrice: "99.99", CostPrice: strPtr("80"),
			},
		},
	}
	id, err := repo.Create(ctx, req, seedUserID)
	require.NoError(t, err)
	d, err := repo.GetDetail(ctx, id)
	require.NoError(t, err)

	var offeredName string
	require.NoError(t, tx.QueryRow(ctx, "SELECT name FROM items WHERE id = $1", seedItemID).Scan(&offeredName))

	got := quotations.BuildExportData(d, map[int16]string{}, "", "", "Director")

	// Every header figure is the stored one.
	fields := []struct{ name, got, stored string }{
		{"TotalProduk", got.TotalProduk, d.TotalProduk},
		{"TotalDiscount", got.TotalDiscount, d.TotalDiscount},
		{"Subtotal", got.Subtotal, d.Subtotal},
		{"DPP", got.DPP, d.DppNilaiLain},
		{"PPN", got.PPN, d.PpnAmount},
		{"GrandTotal", got.GrandTotal, d.GrandTotal},
	}
	for _, f := range fields {
		assert.Equal(t, pdfgen.FormatIDRCents(f.stored), f.got, f.name)
	}
	assert.Equal(t, "Rp~150,37", got.Shipping)
	assert.True(t, got.HasShipping)

	// Total Produk - Diskon + Pengiriman = Sub Total.
	assert.Equal(t,
		cents(t, d.Subtotal),
		cents(t, d.TotalProduk)-cents(t, d.TotalDiscount)+15037,
		"the printed column must add up")

	// The quoted lines sum to Total Produk.
	var quoted int64
	for i, it := range d.Items {
		if it.ItemType == "product" && got.Items[i].HasOffer {
			quoted += cents(t, it.TotalSelling)
		}
	}
	assert.Equal(t, cents(t, d.TotalProduk), quoted)

	require.Len(t, got.Items, 4)
	assert.False(t, got.Items[1].HasOffer, "the unpriced line prints as No Offer")
	assert.True(t, got.Items[2].HasOffer, "the priced unmatched line is quoted")
	assert.True(t, strings.HasPrefix(got.Items[0].Offer, pdfgen.LatexEscape(offeredName)),
		"offer %q must name the catalog item %q", got.Items[0].Offer, offeredName)
	assert.Equal(t, "KABEL NYM 3x2.5", got.Items[2].Offer)
}

// Q-12: the stored shipping days print as DELIVERY TIME.
func TestBuildExportData_DeliveryTimeFromStoredShipping(t *testing.T) {
	ctx, repo, _ := newRepo(t)

	req := sampleCreate()
	days := 5
	req.ShippingDays = &days
	id, err := repo.Create(ctx, req, seedUserID)
	require.NoError(t, err)
	d, err := repo.GetDetail(ctx, id)
	require.NoError(t, err)

	got := quotations.BuildExportData(d, map[int16]string{}, "", "", "Director")
	assert.Equal(t, "5 days", got.DeliveryTime)
	assert.Equal(t, "MV TEST", got.DeliveryPlace)
}
