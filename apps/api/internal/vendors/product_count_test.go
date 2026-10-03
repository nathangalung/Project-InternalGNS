package vendors_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
	"github.com/nathangalung/internalgns/apps/api/internal/vendors"
)

// vendorLinking links active and inactive items.
func vendorLinking(t *testing.T, ctx context.Context, tx pgx.Tx, name string, active, inactive int) int64 {
	t.Helper()
	var vendorID int64
	require.NoError(t, tx.QueryRow(ctx,
		`INSERT INTO vendors (name, created_by, updated_by) VALUES ($1, $2, $2) RETURNING id`,
		name, seedUserID).Scan(&vendorID))
	for i := range active + inactive {
		var itemID int64
		require.NoError(t, tx.QueryRow(ctx,
			`INSERT INTO items (name, is_active, created_by, updated_by) VALUES ($1, $2, $3, $3) RETURNING id`,
			fmt.Sprintf("%s item %d", name, i), i < active, seedUserID).Scan(&itemID))
		_, err := tx.Exec(ctx,
			`INSERT INTO vendor_products (vendor_id, item_id, cost_price, created_by, updated_by)
			 VALUES ($1, $2, 1000, $3, $3)`, vendorID, itemID, seedUserID)
		require.NoError(t, err)
	}
	return vendorID
}

// Product count skips inactive items.
// It counts the rows the vendor's item list shows, wherever it is read.
func TestRepo_ProductCount_MatchesItemList(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := vendors.NewRepo(tx, testutil.Store(t))
	tag := fmt.Sprintf("Hitung Produk %d", time.Now().UnixNano())
	few := vendorLinking(t, ctx, tx, tag+" A", 1, 3)
	many := vendorLinking(t, ctx, tx, tag+" B", 2, 0)

	items, err := repo.ListItems(ctx, few, 50, 0)
	require.NoError(t, err)
	require.Equal(t, int64(1), items.Total)

	got, err := repo.GetByID(ctx, few)
	require.NoError(t, err)
	assert.Equal(t, items.Total, got.ProductCount, "detail")

	updated, err := repo.Update(ctx, few, vendors.UpdateVendorRequest{Name: got.Name, IsActive: true}, seedUserID)
	require.NoError(t, err)
	assert.Equal(t, items.Total, updated.ProductCount, "update")

	list, err := repo.List(ctx, vendors.ListFilter{Q: tag, SortBy: "productCount", SortDir: "desc", Limit: 10})
	require.NoError(t, err)
	require.Len(t, list.Rows, 2)
	assert.Equal(t, []int64{many, few}, []int64{list.Rows[0].ID, list.Rows[1].ID}, "sorted by the shown count")
	assert.Equal(t, items.Total, list.Rows[1].ProductCount, "list")
}
