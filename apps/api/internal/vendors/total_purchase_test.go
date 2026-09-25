package vendors_test

import (
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
	"github.com/nathangalung/internalgns/apps/api/internal/vendors"
)

// Cancelled PO leaves the total.
// The quotation stays accepted, so every read path, the minTotal filter
// included, must drop the vendor's cost once the PO is cancelled.
func TestRepo_TotalPurchase_ExcludesCancelledPO(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := vendors.NewRepo(tx, testutil.Store(t))

	name := fmt.Sprintf("PT Vendor Batal PO %d", time.Now().UnixNano())
	var vendorID, itemID, vendorProductID int64
	require.NoError(t, tx.QueryRow(ctx, `
		INSERT INTO vendors (name, created_by, updated_by) VALUES ($1, $2, $2) RETURNING id`,
		name, seedUserID).Scan(&vendorID))
	require.NoError(t, tx.QueryRow(ctx, `
		INSERT INTO items (name, created_by) VALUES ($1, $2) RETURNING id`,
		"Barang "+name, seedUserID).Scan(&itemID))
	require.NoError(t, tx.QueryRow(ctx, `
		INSERT INTO vendor_products (vendor_id, item_id, cost_price, created_by)
		VALUES ($1, $2, 7000, $3) RETURNING id`,
		vendorID, itemID, seedUserID).Scan(&vendorProductID))

	var quotationID int64
	require.NoError(t, tx.QueryRow(ctx, `
		INSERT INTO quotations (quotation_no, company_client_id, company_client_name,
		                        discount_pct, total_produk, total, total_discount,
		                        status, created_by, updated_by)
		VALUES ($1, 1, 'PT. IMC Ship Management', 0, 20000, 20000, 0, 'sent', $2, $2)
		RETURNING id`, "SQ-BATAL-"+name, seedUserID).Scan(&quotationID))
	var totalCost string
	require.NoError(t, tx.QueryRow(ctx, `
		INSERT INTO quotation_items (quotation_id, line_number, item_type, requested_name,
		                             offered_item_id, vendor_product_id, qty,
		                             selling_price, cost_price, discount_pct, created_by)
		VALUES ($1, 1, 'product', $2, $3, $4, 2, 10000, 7000, 0, $5)
		RETURNING total_cost::text`,
		quotationID, "Barang "+name, itemID, vendorProductID, seedUserID).Scan(&totalCost))
	_, err := tx.Exec(ctx, `SELECT fn_change_quotation_status($1, 'accepted', $2)`, quotationID, seedUserID)
	require.NoError(t, err)

	update := vendors.UpdateVendorRequest{Name: name, IsActive: true}
	assertTotal := func(want string, minTotalRows int) {
		t.Helper()
		got, err := repo.GetByID(ctx, vendorID)
		require.NoError(t, err)
		assert.Equal(t, want, got.TotalPurchase, "vendors.get_by_id")

		list, err := repo.List(ctx, vendors.ListFilter{Q: name, Limit: 10})
		require.NoError(t, err)
		require.Len(t, list.Rows, 1)
		assert.Equal(t, want, list.Rows[0].TotalPurchase, "vendors.list_base")

		filtered, err := repo.List(ctx, vendors.ListFilter{Q: name, MinTotal: ptr("1"), Limit: 10})
		require.NoError(t, err)
		assert.Len(t, filtered.Rows, minTotalRows, "minTotal filter")
		assert.Equal(t, int64(minTotalRows), filtered.Total, "minTotal count")

		updated, err := repo.Update(ctx, vendorID, update, seedUserID)
		require.NoError(t, err)
		assert.Equal(t, want, updated.TotalPurchase, "vendors.update")
	}

	assertTotal(totalCost, 1)

	var poID int64
	require.NoError(t, tx.QueryRow(ctx,
		`SELECT id FROM purchase_orders WHERE quotation_id = $1`, quotationID).Scan(&poID))
	_, err = tx.Exec(ctx, `SELECT fn_change_po_status($1, 'CANCELLED', $2, 'Klien membatalkan pesanan')`,
		poID, seedUserID)
	require.NoError(t, err)

	assertTotal("0", 0)
}
