package quotations_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Lines carry both vendor links.
// The product link is where the vendor sells this product and the store
// link is the vendor's own shop, so the quotation line shows both.
func TestRepo_GetDetail_LineLinks(t *testing.T) {
	ctx, repo, tx := newRepo(t)
	_, err := tx.Exec(ctx, `UPDATE vendor_products SET product_url = 'https://toko.example/tali' WHERE id = $1`, seedVendorProd)
	require.NoError(t, err)
	_, err = tx.Exec(ctx, `UPDATE vendors v SET store_url = 'https://toko.example'
		FROM vendor_products vp WHERE vp.vendor_id = v.id AND vp.id = $1`, seedVendorProd)
	require.NoError(t, err)
	id, err := repo.Create(ctx, sampleCreate(), seedUserID)
	require.NoError(t, err)

	d, err := repo.GetDetail(ctx, id)
	require.NoError(t, err)
	require.Equal(t, "product", d.Items[0].ItemType)
	require.NotNil(t, d.Items[0].ProductURL)
	assert.Equal(t, "https://toko.example/tali", *d.Items[0].ProductURL)
	require.NotNil(t, d.Items[0].VendorStoreURL)
	assert.Equal(t, "https://toko.example", *d.Items[0].VendorStoreURL)
	assert.Nil(t, d.Items[1].ProductURL, "the shipping line has no product link")
	assert.Nil(t, d.Items[1].VendorStoreURL, "the shipping line has no vendor")
}
