package vendors_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
	"github.com/nathangalung/internalgns/apps/api/internal/vendors"
)

// seedVendorWithItems links fresh items.
// n fresh active items go to a fresh vendor.
func seedVendorWithItems(t *testing.T, n int) (vendorID int64, itemIDs []int64) {
	t.Helper()
	ctx := context.Background()
	pool := testutil.Pool(t)
	clean := testutil.NewCleaner(t)
	tag := time.Now().UnixNano()

	require.NoError(t, pool.QueryRow(ctx,
		`INSERT INTO vendors (name, created_by, updated_by) VALUES ($1, $2, $2) RETURNING id`,
		fmt.Sprintf("Vendor Paging %d", tag), seedUserID).Scan(&vendorID))
	clean.Vendor(vendorID)

	for i := range n {
		var id int64
		// Equal names force the id tiebreak to decide the page order.
		require.NoError(t, pool.QueryRow(ctx,
			`INSERT INTO items (name, created_by, updated_by) VALUES ($1, $2, $2) RETURNING id`,
			fmt.Sprintf("Paging Item %d", tag), seedUserID).Scan(&id))
		clean.Item(id)
		_, err := pool.Exec(ctx,
			`INSERT INTO vendor_products (vendor_id, item_id, cost_price, created_by, updated_by)
			 VALUES ($1, $2, $3, $4, $4)`, vendorID, id, 1000+i, seedUserID)
		require.NoError(t, err)
		itemIDs = append(itemIDs, id)
	}
	return vendorID, itemIDs
}

func TestHandler_ListItems_Paging(t *testing.T) {
	vendorID, itemIDs := seedVendorWithItems(t, 5)
	srv := newSrv(t)

	get := func(query string) ([]vendors.ItemByVendor, string) {
		t.Helper()
		res := doJSON(t, srv, http.MethodGet, fmt.Sprintf("/vendors/%d/items%s", vendorID, query), nil)
		defer res.Body.Close()
		require.Equal(t, http.StatusOK, res.StatusCode)
		var rows []vendors.ItemByVendor
		require.NoError(t, json.NewDecoder(res.Body).Decode(&rows))
		return rows, res.Header.Get("X-Total-Count")
	}

	cases := []struct {
		name    string
		query   string
		wantIDs []int64
	}{
		{"default page holds all", "", itemIDs},
		{"first page", "?limit=2", itemIDs[:2]},
		{"second page", "?limit=2&offset=2", itemIDs[2:4]},
		{"last partial page", "?limit=2&offset=4", itemIDs[4:]},
		{"offset past the end", "?limit=2&offset=10", nil},
		{"invalid offset reads from the start", "?limit=2&offset=-3", itemIDs[:2]},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			rows, total := get(tc.query)
			assert.Equal(t, "5", total, "X-Total-Count counts every linked item")
			got := make([]int64, 0, len(rows))
			for _, r := range rows {
				got = append(got, r.ItemID)
			}
			want := tc.wantIDs
			if want == nil {
				want = []int64{}
			}
			assert.Equal(t, want, got)
		})
	}
}
