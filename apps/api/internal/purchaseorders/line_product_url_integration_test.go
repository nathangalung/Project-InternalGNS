package purchaseorders_test

import (
	"fmt"
	"net/http"
	"strconv"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/roles"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Ubah PO sets Link Produk.
// Both roles that edit a PO line write the catalog, operational input
// included, so both may set it. Absent keeps the stored link and blank
// clears it.
func TestHandler_UpdateItems_ProductURL(t *testing.T) {
	const stored = "https://toko.example/lama"
	const typed = "https://toko.example/baru"
	cases := []struct {
		name   string
		role   string
		url    *string
		expect *string
	}{
		{"absent keeps the stored link", roles.Superadmin, nil, strPtr(stored)},
		{"typed replaces it", roles.Superadmin, strPtr(" " + typed + " "), strPtr(typed)},
		{"blank clears it", roles.Superadmin, strPtr(""), nil},
		{"operational input sets it", roles.OperationalInput, strPtr(typed), strPtr(typed)},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			ctx, tx, srv := txServer(t)
			_, poID := acceptedQuotationWithPO(t, tx)
			repo := purchaseorders.NewRepo(tx, testutil.Store(t))
			lines, err := repo.ListItems(ctx, poID)
			require.NoError(t, err)
			var line purchaseorders.PurchaseOrderItem
			for _, l := range lines {
				if l.ItemType == "product" && l.VendorProductID != nil {
					line = l
				}
			}
			require.NotNil(t, line.VendorProductID, "the fixture links a vendor")
			_, err = tx.Exec(ctx, `UPDATE vendor_products SET product_url = $2 WHERE id = $1`,
				*line.VendorProductID, stored)
			require.NoError(t, err)

			po, err := repo.GetByID(ctx, poID)
			require.NoError(t, err)
			res := doJSONWithHeaders(t, srv, http.MethodPut, fmt.Sprintf("/purchase-orders/%d/items", poID),
				purchaseorders.UpdateItemsRequest{
					DiscountPct: po.DiscountPct,
					Items: []purchaseorders.UpdateItemsLine{{
						ID: &line.ID, QuotationItemID: line.QuotationItemID, OfferedItemID: line.OfferedItemID,
						ItemName: line.ItemName, Qty: line.Qty, UnitID: line.UnitID,
						SellingPrice: line.SellingPrice, CostPrice: line.CostPrice,
						VendorProductID: line.VendorProductID, ProductURL: c.url,
					}},
				}, map[string]string{"If-Match": strconv.Itoa(int(po.RowVersion)), roleHeader: c.role})
			res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)

			var url *string
			require.NoError(t, tx.QueryRow(ctx, `SELECT product_url FROM vendor_products WHERE id = $1`,
				*line.VendorProductID).Scan(&url))
			assert.Equal(t, c.expect, url)
		})
	}
}
