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

// The cost follows the PO lines.
// A PO line stores its own vendor; its edited cost is what the dashboard
// books, so the total, the minTotal filter and the sort read it, and a
// vendor swapped in Ubah PO takes the cost with it. An accepted deal with no
// PO counts at quotation cost.
func TestRepo_TotalPurchase_FollowsPOLines(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := vendors.NewRepo(tx, testutil.Store(t))

	prefix := fmt.Sprintf("PT Vendor Ubah PO %d", time.Now().UnixNano())
	newVendor := func(name string) (vendorID, itemID, vendorProductID int64) {
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
		return vendorID, itemID, vendorProductID
	}
	deal := func(name, status string, itemID, vendorProductID int64, qty, cost string) (quotationID, lineID int64) {
		require.NoError(t, tx.QueryRow(ctx, `
			INSERT INTO quotations (quotation_no, company_client_id, company_client_name,
			                        discount_pct, total_produk, total, total_discount,
			                        status, created_by, updated_by)
			VALUES ($1, 1, 'PT. IMC Ship Management', 0, 20000, 20000, 0, $2, $3, $3)
			RETURNING id`, "SQ-UBAH-"+name, status, seedUserID).Scan(&quotationID))
		require.NoError(t, tx.QueryRow(ctx, `
			INSERT INTO quotation_items (quotation_id, line_number, item_type, requested_name,
			                             offered_item_id, vendor_product_id, qty, unit_id,
			                             selling_price, cost_price, discount_pct, created_by)
			VALUES ($1, 1, 'product', $2, $3, $4, $5::numeric, 19, 10000, $6::numeric, 0, $7)
			RETURNING id`,
			quotationID, "Barang "+name, itemID, vendorProductID, qty, cost, seedUserID).Scan(&lineID))
		return quotationID, lineID
	}

	edited, editedItem, editedVP := newVendor(prefix + " A")
	quotationID, lineID := deal(prefix+" A", "sent", editedItem, editedVP, "2", "7000")
	_, err := tx.Exec(ctx, `SELECT fn_change_quotation_status($1, 'accepted', $2)`, quotationID, seedUserID)
	require.NoError(t, err)

	// Accepted before POs existed: no PO, so the quotation cost counts.
	noPO, noPOItem, noPOVP := newVendor(prefix + " B")
	deal(prefix+" B", "accepted", noPOItem, noPOVP, "1", "9000")

	// Picked for the PO line in Ubah PO.
	swapped, _, _ := newVendor(prefix + " C")

	check := func(wantEdited, wantSwapped string, wantOrder []int64, minRows int) {
		t.Helper()
		got, err := repo.GetByID(ctx, edited)
		require.NoError(t, err)
		assert.Equal(t, wantEdited, got.TotalPurchase, "vendors.get_by_id")
		picked, err := repo.GetByID(ctx, swapped)
		require.NoError(t, err)
		assert.Equal(t, wantSwapped, picked.TotalPurchase, "swapped vendor")
		other, err := repo.GetByID(ctx, noPO)
		require.NoError(t, err)
		assert.Equal(t, "9000.00", other.TotalPurchase, "no PO falls back to the quotation")
		updated, err := repo.Update(ctx, edited, vendors.UpdateVendorRequest{Name: prefix + " A", IsActive: true}, seedUserID)
		require.NoError(t, err)
		assert.Equal(t, wantEdited, updated.TotalPurchase, "vendors.update")

		list, err := repo.List(ctx, vendors.ListFilter{Q: prefix, SortBy: "totalPurchase", Limit: 10})
		require.NoError(t, err)
		ids := make([]int64, 0, len(list.Rows))
		for _, r := range list.Rows {
			ids = append(ids, r.ID)
		}
		assert.Equal(t, wantOrder, ids, "totalPurchase sort")

		filtered, err := repo.List(ctx, vendors.ListFilter{Q: prefix, MinTotal: ptr("10000"), Limit: 10})
		require.NoError(t, err)
		assert.Len(t, filtered.Rows, minRows, "minTotal filter")
	}

	check("14000.00", "0", []int64{edited, noPO, swapped}, 1)

	var poID int64
	require.NoError(t, tx.QueryRow(ctx,
		`SELECT id FROM purchase_orders WHERE quotation_id = $1`, quotationID).Scan(&poID))
	editLine := func(supplier string) {
		t.Helper()
		_, err := tx.Exec(ctx, `SELECT fn_update_po_items($1, $2, 0, NULL, NULL, NULL, NULL, $3::jsonb)`,
			poID, seedUserID, fmt.Sprintf(
				`[{"quotationItemId":"%d","offeredItemId":"%d","itemName":"Barang",%s,`+
					`"qty":"1","unitId":"19","sellingPrice":"10000","costPrice":"4000"}]`,
				lineID, editedItem, supplier))
		require.NoError(t, err)
	}

	editLine(fmt.Sprintf(`"vendorProductId":"%d"`, editedVP))
	check("4000.00", "0", []int64{noPO, edited, swapped}, 0)

	// The quotation line still names the old vendor; the PO line decides.
	editLine(fmt.Sprintf(`"vendorId":"%d"`, swapped))
	check("0", "4000.00", []int64{noPO, swapped, edited}, 0)
}
