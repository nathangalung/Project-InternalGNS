package purchaseorders_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/purchaseorders"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// PO lines carry the store link.
// Buying happens at the PO, so each line names where its vendor sells it.
func TestRepo_ListItems_StoreLink(t *testing.T) {
	ctx := context.Background()
	_, tx := testutil.BeginTx(t)
	_, poID := poAt(t, tx, purchaseorders.StatusPending)
	_, err := tx.Exec(ctx, `
		UPDATE vendor_products vp SET product_url = 'https://toko.example/beli'
		  FROM purchase_order_items poi
		 WHERE poi.vendor_product_id = vp.id AND poi.po_id = $1`, poID)
	require.NoError(t, err)

	items, err := purchaseorders.NewRepo(tx, testutil.Store(t)).ListItems(ctx, poID)
	require.NoError(t, err)
	linked := 0
	for _, it := range items {
		if it.VendorProductID != nil {
			require.NotNil(t, it.ProductURL)
			assert.Equal(t, "https://toko.example/beli", *it.ProductURL)
			linked++
		}
	}
	assert.Positive(t, linked, "the fixture PO has a vendor-linked line")
}
