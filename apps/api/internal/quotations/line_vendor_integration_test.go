package quotations_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
)

// A vendor link names one product.
// Another product's link passed the send gate and the PO then dropped
// the vendor; every write path goes through fn_prepare_quotation_lines.
func TestRepo_LineVendorMustMatchProduct(t *testing.T) {
	const want = "Vendor yang dipilih bukan pemasok produk ini. Pilih ulang vendor."
	mismatch := func(other int64) quotations.CreateItem {
		line := offered()
		line.OfferedItemID = &other
		return line
	}

	t.Run("create", func(t *testing.T) {
		ctx, repo, tx := newRepo(t)
		other := insertItem(t, ctx, tx, "Barang Lain Vendor Salah")
		err := attempt(t, ctx, tx, func() error {
			req := sampleCreate()
			req.Items = []quotations.CreateItem{mismatch(other)}
			_, err := repo.Create(ctx, req, seedUserID)
			return err
		})
		status, _, detail := errCode(err)
		assert.Equal(t, 422, status)
		assert.Equal(t, want, detail)
	})

	t.Run("add line", func(t *testing.T) {
		ctx, repo, tx := newRepo(t)
		other := insertItem(t, ctx, tx, "Barang Lain Vendor Salah")
		q := newLiveDraft(t, ctx, repo)
		err := attempt(t, ctx, tx, func() error {
			_, err := repo.AddLines(ctx, q.id, []quotations.CreateItem{mismatch(other)}, seedUserID)
			return err
		})
		status, _, detail := errCode(err)
		assert.Equal(t, 422, status)
		assert.Equal(t, want, detail)
	})

	t.Run("own product link is kept", func(t *testing.T) {
		ctx, repo, _ := newRepo(t)
		id := createWith(t, ctx, repo, offered())
		d, err := repo.GetDetail(ctx, id)
		require.NoError(t, err)
		require.NotNil(t, d.Items[0].VendorProductID)
		assert.Equal(t, seedVendorProd, *d.Items[0].VendorProductID)
	})
}
