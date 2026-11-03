package quotations_test

import (
	"context"
	"testing"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
)

// linkURL reads Link Produk.
func linkURL(t *testing.T, ctx context.Context, tx pgx.Tx, link int64) *string {
	t.Helper()
	var url *string
	require.NoError(t, tx.QueryRow(ctx,
		`SELECT product_url FROM vendor_products WHERE id = $1`, link).Scan(&url))
	return url
}

func setLinkURL(t *testing.T, ctx context.Context, tx pgx.Tx, link int64, url string) {
	t.Helper()
	_, err := tx.Exec(ctx, `UPDATE vendor_products SET product_url = $2 WHERE id = $1`, link, url)
	require.NoError(t, err)
}

// Lines set Link Produk.
// The product dialog takes the link with the vendor and prices, so every
// line write carries it to the vendor link the line uses or creates.
// Absent keeps the stored link and blank clears it.
func TestRepo_LineProductURL(t *testing.T) {
	const stored = "https://toko.example/lama"
	const typed = "https://toko.example/baru"
	withURL := func(url *string) quotations.CreateItem {
		line := offered()
		line.ProductURL = url
		return line
	}
	cases := []struct {
		name   string
		url    *string
		expect *string
	}{
		{"absent keeps the stored link", nil, strPtr(stored)},
		{"typed replaces it", strPtr(typed), strPtr(typed)},
		{"blank clears it", strPtr(""), nil},
	}
	writes := []struct {
		name string
		save func(t *testing.T, ctx context.Context, repo *quotations.Repo, line quotations.CreateItem)
	}{
		{"create", func(t *testing.T, ctx context.Context, repo *quotations.Repo, line quotations.CreateItem) {
			createWith(t, ctx, repo, line)
		}},
		{"add line", func(t *testing.T, ctx context.Context, repo *quotations.Repo, line quotations.CreateItem) {
			q := newLiveDraft(t, ctx, repo)
			_, err := repo.AddLines(ctx, q.id, []quotations.CreateItem{line}, seedUserID)
			require.NoError(t, err)
		}},
		{"update line", func(t *testing.T, ctx context.Context, repo *quotations.Repo, line quotations.CreateItem) {
			q := newLiveDraft(t, ctx, repo)
			_, err := repo.Lock(ctx, q.id, part(q.lines[0]), seedUserID)
			require.NoError(t, err)
			require.NoError(t, repo.UpdateLine(ctx, q.id, q.lines[0], line, seedUserID))
		}},
	}
	for _, w := range writes {
		for _, c := range cases {
			t.Run(w.name+" "+c.name, func(t *testing.T) {
				ctx, repo, tx := newRepo(t)
				setLinkURL(t, ctx, tx, seedVendorProd, stored)
				w.save(t, ctx, repo, withURL(c.url))
				assert.Equal(t, c.expect, linkURL(t, ctx, tx, seedVendorProd))
			})
		}
	}

	// A vendor picked without a link gets one carrying the link.
	t.Run("new vendor link", func(t *testing.T) {
		ctx, repo, tx := newRepo(t)
		vendor := newVendor(t, ctx, tx, true)
		line := withURL(strPtr(typed))
		line.VendorProductID, line.VendorID = nil, &vendor
		id := createWith(t, ctx, repo, line)
		d, err := repo.GetDetail(ctx, id)
		require.NoError(t, err)
		require.NotNil(t, d.Items[0].VendorProductID)
		assert.Equal(t, strPtr(typed), linkURL(t, ctx, tx, *d.Items[0].VendorProductID))
		require.NotNil(t, d.Items[0].ProductURL, "the line reads the link live")
		assert.Equal(t, typed, *d.Items[0].ProductURL)
	})

	// Tidak Ditawarkan names no vendor, so it writes no link.
	t.Run("no offer line", func(t *testing.T) {
		ctx, repo, tx := newRepo(t)
		setLinkURL(t, ctx, tx, seedVendorProd, stored)
		line := noOffer()
		line.ProductURL = strPtr(typed)
		createWith(t, ctx, repo, offered(), line)
		assert.Equal(t, strPtr(stored), linkURL(t, ctx, tx, seedVendorProd))
	})
}
