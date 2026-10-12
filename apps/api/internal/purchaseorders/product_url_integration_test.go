package purchaseorders_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// PO lines carry both vendor links.
// Buying happens at the PO, so each line names where its vendor sells the
// product and the vendor's own shop.
func TestRepo_ListItems_Links(t *testing.T) {
	ctx := context.Background()
	_, tx := testutil.BeginTx(t)
	_, poID := poAt(t, tx, purchaseorders.StatusPending)
	_, err := tx.Exec(ctx, `
		UPDATE vendor_products vp SET product_url = 'https://toko.example/beli'
		  FROM purchase_order_items poi
		 WHERE poi.vendor_product_id = vp.id AND poi.po_id = $1`, poID)
	require.NoError(t, err)
	_, err = tx.Exec(ctx, `
		UPDATE vendors v SET store_url = 'https://toko.example'
		  FROM vendor_products vp
		  JOIN purchase_order_items poi ON poi.vendor_product_id = vp.id
		 WHERE vp.vendor_id = v.id AND poi.po_id = $1`, poID)
	require.NoError(t, err)

	items, err := purchaseorders.NewRepo(tx, testutil.Store(t)).ListItems(ctx, poID)
	require.NoError(t, err)
	linked := 0
	for _, it := range items {
		if it.VendorProductID != nil {
			require.NotNil(t, it.ProductURL)
			assert.Equal(t, "https://toko.example/beli", *it.ProductURL)
			require.NotNil(t, it.VendorStoreURL)
			assert.Equal(t, "https://toko.example", *it.VendorStoreURL)
			linked++
		}
	}
	assert.Positive(t, linked, "the fixture PO has a vendor-linked line")
}
