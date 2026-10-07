package purchaseorders_test

import (
	"fmt"
	"net/http"
	"strconv"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// A changed harga beli updates the catalog.
// The vendor link takes the price and its quote date moves; saving the PO
// again with the same price leaves the catalog alone.
func TestHandler_UpdateItems_SyncsCatalogPrice(t *testing.T) {
	ctx, tx, srv := txServer(t)
	_, poID := acceptedQuotationWithPO(t, tx)
	repo := purchaseorders.NewRepo(tx, testutil.Store(t))
	stored, err := repo.ListItems(ctx, poID)
	require.NoError(t, err)
	var line purchaseorders.PurchaseOrderItem
	for _, l := range stored {
		if l.ItemType == "product" && l.VendorProductID != nil {
			line = l
		}
	}
	require.NotNil(t, line.VendorProductID, "the fixture links a vendor")

	catalog := func() (string, string) {
		var cost, quoted string
		require.NoError(t, tx.QueryRow(ctx,
			`SELECT cost_price::text, COALESCE(last_quoted_at::text, '') FROM vendor_products WHERE id = $1`,
			*line.VendorProductID).Scan(&cost, &quoted))
		return cost, quoted
	}
	save := func(cost string) {
		po, err := repo.GetByID(ctx, poID)
		require.NoError(t, err)
		res := doJSONWithHeaders(t, srv, http.MethodPut, fmt.Sprintf("/purchase-orders/%d/items", poID),
			purchaseorders.UpdateItemsRequest{
				DiscountPct: po.DiscountPct,
				Items: []purchaseorders.UpdateItemsLine{{
					ID: &line.ID, QuotationItemID: line.QuotationItemID, OfferedItemID: line.OfferedItemID,
					ItemName: line.ItemName, Qty: line.Qty, UnitID: line.UnitID,
					SellingPrice: line.SellingPrice, CostPrice: &cost, VendorProductID: line.VendorProductID,
				}},
			}, map[string]string{"If-Match": strconv.Itoa(int(po.RowVersion))})
		res.Body.Close()
		require.Equal(t, http.StatusOK, res.StatusCode)
	}

	_, before := catalog()
	save("42500")
	cost, quoted := catalog()
	assert.Equal(t, "42500.00", cost)
	assert.NotEqual(t, before, quoted, "the quote is dated")

	_, err = tx.Exec(ctx, `UPDATE vendor_products SET cost_price = 43000 WHERE id = $1`, *line.VendorProductID)
	require.NoError(t, err)
	save("42500")
	cost, _ = catalog()
	assert.Equal(t, "43000.00", cost, "an unchanged PO price leaves a newer catalog price")
}
