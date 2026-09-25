package items_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/items"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// insertItem creates an item row.
func insertItem(t *testing.T, clean *testutil.Cleaner, name string, active bool) int64 {
	t.Helper()
	var id int64
	require.NoError(t, testutil.Pool(t).QueryRow(context.Background(),
		`INSERT INTO items (name, is_active, created_by, updated_by) VALUES ($1, $2, $3, $3) RETURNING id`,
		name, active, seedUserID).Scan(&id))
	clean.Item(id)
	return id
}

// Name layer honours isActive.
//
// A deactivated product is found by name under Nonaktif and under Semua,
// and never under Aktif.
func TestHandler_SearchAdvanced_InactiveByName(t *testing.T) {
	clean := testutil.NewCleaner(t)
	srv := newSrv(t)

	token := fmt.Sprintf("Vostrelin%d", time.Now().UnixNano())
	on := insertItem(t, clean, token+" Aktif", true)
	off := insertItem(t, clean, token+" Nonaktif", false)

	tests := []struct {
		name   string
		filter string
		want   map[int64]bool
	}{
		{"Semua finds both", "", map[int64]bool{on: true, off: false}},
		{"Aktif keeps the active item", "&isActive=true", map[int64]bool{on: true}},
		{"Nonaktif finds the deactivated item", "&isActive=false", map[int64]bool{off: false}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			res := doJSON(t, srv, http.MethodGet,
				"/items/search-advanced?q="+url.QueryEscape(token)+"&limit=20"+tt.filter, nil)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			var body items.AdvancedSearchResponse
			require.NoError(t, json.NewDecoder(res.Body).Decode(&body))

			got := map[int64]bool{}
			for _, h := range body.Hits {
				got[h.ID] = h.IsActive
				assert.Equal(t, "ITEM_AUTO", h.Tier, "item %d matches by name", h.ID)
				assert.NotEmpty(t, h.Name, "item %d carries its name", h.ID)
			}
			assert.Equal(t, tt.want, got)
			assert.Equal(t, len(tt.want), body.Total)
		})
	}
}

// Every layer filters isActive itself.
//
// Filtering in SQL makes the layer cap and the total count only the rows
// the filter keeps.
func TestRepo_SearchLayers_HonourIsActive(t *testing.T) {
	pool := testutil.Pool(t)
	clean := testutil.NewCleaner(t)
	repo := items.NewRepo(pool, testutil.Store(t))
	ctx := context.Background()

	token := fmt.Sprintf("Quenmarit%d", time.Now().UnixNano())
	on := insertItem(t, clean, "Uji Lapisan Aktif "+token, true)
	off := insertItem(t, clean, "Uji Lapisan Nonaktif "+token, false)

	var vendorID int64
	require.NoError(t, pool.QueryRow(ctx,
		`INSERT INTO vendors (name, created_by, updated_by) VALUES ($1, $2, $2) RETURNING id`,
		"Vendor Lapisan "+token, seedUserID).Scan(&vendorID))
	clean.Vendor(vendorID)
	t.Cleanup(func() {
		_, _ = pool.Exec(ctx, `DELETE FROM item_request_matches WHERE matched_item_id = ANY($1)`, []int64{on, off})
	})
	for _, id := range []int64{on, off} {
		sku := fmt.Sprintf("SKU-%s-%d", token, id)
		_, err := pool.Exec(ctx,
			`INSERT INTO vendor_products (vendor_id, item_id, vendor_sku, cost_price, created_by, updated_by)
			 VALUES ($1, $2, $3, 1000, $4, $4)`, vendorID, id, sku, seedUserID)
		require.NoError(t, err)
		_, err = pool.Exec(ctx,
			`INSERT INTO item_request_matches (request_text, matched_item_id) VALUES ($1, $2)`,
			fmt.Sprintf("permintaan %s nomor %d", token, id), id)
		require.NoError(t, err)
	}

	yes, no := true, false
	tests := []struct {
		name     string
		isActive *bool
		want     []int64
	}{
		{"unset keeps both", nil, []int64{on, off}},
		{"true keeps the active item", &yes, []int64{on}},
		{"false keeps the inactive item", &no, []int64{off}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			names, err := repo.SearchCatalog(ctx, token, 0.3, 50, tt.isActive)
			require.NoError(t, err)
			offers, err := repo.SearchVendorOffers(ctx, "SKU-"+token, 50, tt.isActive)
			require.NoError(t, err)
			requests, err := repo.SearchRequestHistory(ctx, "permintaan "+token, 50, tt.isActive)
			require.NoError(t, err)

			var nameIDs, offerIDs, requestIDs []int64
			for _, h := range names {
				nameIDs = append(nameIDs, h.ID)
			}
			for _, h := range offers {
				offerIDs = append(offerIDs, h.ItemID)
			}
			for _, h := range requests {
				requestIDs = append(requestIDs, h.ItemID)
			}
			assert.ElementsMatch(t, tt.want, nameIDs, "name layer")
			assert.ElementsMatch(t, tt.want, offerIDs, "vendor-offer layer")
			assert.ElementsMatch(t, tt.want, requestIDs, "request-history layer")
		})
	}
}
