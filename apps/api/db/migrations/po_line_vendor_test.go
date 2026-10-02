package migrations_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

const lineVendorMigration = "00083_po_line_vendor.sql"

// PO lines take the quoted vendor.
// Only a link for the line's own product is copied: a line whose product
// was swapped in the PO edit keeps no vendor rather than the old one.
func TestMigration00083_BackfillsLineVendor(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	qrepo := quotations.NewRepo(tx, testutil.Store(t))
	qid, err := qrepo.Create(ctx, quotations.CreateRequest{
		CompanyClientID: 1,
		DiscountPct:     "0",
		Items: testutil.OfferLines(t, ctx, tx, []quotations.CreateItem{
			{RequestedName: "Migrasi 00083 tetap", Qty: "1", UnitID: 19, SellingPrice: "1000"},
			{RequestedName: "Migrasi 00083 diganti", Qty: "1", UnitID: 19, SellingPrice: "1000"},
		}),
	}, 1)
	require.NoError(t, err)
	require.NoError(t, qrepo.ChangeStatus(ctx, qid, "sent", nil, 1))
	require.NoError(t, qrepo.ChangeStatus(ctx, qid, "accepted", nil, 1))

	// The state before the column existed: no vendor, one swapped product.
	_, err = tx.Exec(ctx, `
		UPDATE purchase_order_items poi SET vendor_product_id = NULL
		FROM purchase_orders po WHERE po.id = poi.po_id AND po.quotation_id = $1`, qid)
	require.NoError(t, err)
	_, err = tx.Exec(ctx, `
		UPDATE purchase_order_items poi
		SET offered_item_id = (SELECT offered_item_id FROM quotation_items
		                       WHERE quotation_id = $1 AND line_number = 1)
		FROM purchase_orders po
		WHERE po.id = poi.po_id AND po.quotation_id = $1 AND poi.line_number = 2`, qid)
	require.NoError(t, err)

	_, err = tx.Exec(ctx, upSQL(t, lineVendorMigration))
	require.NoError(t, err)

	rows, err := tx.Query(ctx, `
		SELECT poi.vendor_product_id IS NOT DISTINCT FROM qi.vendor_product_id,
		       poi.vendor_product_id IS NULL
		FROM purchase_order_items poi
		JOIN purchase_orders po ON po.id = poi.po_id
		JOIN quotation_items qi ON qi.id = poi.quotation_item_id
		WHERE po.quotation_id = $1
		ORDER BY poi.line_number`, qid)
	require.NoError(t, err)
	var got [][2]bool
	for rows.Next() {
		var same, empty bool
		require.NoError(t, rows.Scan(&same, &empty))
		got = append(got, [2]bool{same, empty})
	}
	require.NoError(t, rows.Err())
	assert.Equal(t, [][2]bool{{true, false}, {false, true}}, got)
}
