package quotations_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
)

// Lines carry the vendor's store link.
// The link saved on the vendor and product is where the buyer opens the
// shop, so the quotation line shows it.
func TestRepo_GetDetail_LineStoreLink(t *testing.T) {
	ctx, repo, tx := newRepo(t)
	_, err := tx.Exec(ctx, `UPDATE vendor_products SET product_url = 'https://toko.example/tali' WHERE id = $1`, seedVendorProd)
	require.NoError(t, err)
	id, err := repo.Create(ctx, sampleCreate(), seedUserID)
	require.NoError(t, err)

	d, err := repo.GetDetail(ctx, id)
	require.NoError(t, err)
	require.Equal(t, "product", d.Items[0].ItemType)
	require.NotNil(t, d.Items[0].ProductURL)
	assert.Equal(t, "https://toko.example/tali", *d.Items[0].ProductURL)
	assert.Nil(t, d.Items[1].ProductURL, "the shipping line has no store")
}
