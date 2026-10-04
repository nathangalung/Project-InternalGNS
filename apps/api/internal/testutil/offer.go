package testutil

import (
	"context"
	"strconv"
	"testing"

	"github.com/shopspring/decimal"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/db"
)

// SeedVendorID is the fixture vendor.
const SeedVendorID int64 = 9000001

// Validity is a sendable validity window.
// Sending a quotation needs validity_days, so a quotation a test sends
// carries one.
func Validity() *int {
	v := 30
	return &v
}

// OfferLines makes lines sendable.
// Sending a quotation needs every offered product line to carry a product,
// a vendor and a harga beli. A line missing its product gets a catalog item
// named exactly like its request, so PO and invoice snapshots still read the
// request's name. A line without a vendor link is linked to the seed vendor
// at half its harga jual. Lines marked Tidak Ditawarkan, and lines already
// linked to a vendor, are left alone.
func OfferLines(t testing.TB, ctx context.Context, exec db.Executor, lines []quotations.CreateItem) []quotations.CreateItem {
	t.Helper()
	out := make([]quotations.CreateItem, len(lines))
	for i, l := range lines {
		if (l.IsAvailable != nil && !*l.IsAvailable) || l.VendorProductID != nil {
			out[i] = l
			continue
		}
		if l.OfferedItemID == nil {
			var item int64
			require.NoError(t, exec.QueryRow(ctx, `
				INSERT INTO items (name, default_unit_id, created_by, updated_by)
				VALUES ($1, $2, 1, 1) RETURNING id`, l.RequestedName, l.UnitID).Scan(&item))
			l.OfferedItemID = &item
		}
		cost := l.CostPrice
		if cost == nil || *cost == "" || *cost == "0" {
			half := halfOf(t, l.SellingPrice)
			cost = &half
		}
		var link int64
		require.NoError(t, exec.QueryRow(ctx, `
			INSERT INTO vendor_products (vendor_id, item_id, cost_price, created_by, updated_by)
			VALUES ($1, $2, $3::numeric, 1, 1)
			ON CONFLICT (vendor_id, item_id) DO UPDATE SET is_active = TRUE
			RETURNING id`, SeedVendorID, *l.OfferedItemID, *cost).Scan(&link))
		l.VendorProductID, l.CostPrice = &link, cost
		out[i] = l
	}
	return out
}

// halfOf halves a decimal string.
func halfOf(t testing.TB, price string) string {
	t.Helper()
	d, err := decimal.NewFromString(price)
	require.NoError(t, err, "selling price %q", price)
	half := d.Div(decimal.NewFromInt(2)).Round(2)
	if half.LessThanOrEqual(decimal.Zero) {
		return strconv.Itoa(1)
	}
	return half.String()
}
