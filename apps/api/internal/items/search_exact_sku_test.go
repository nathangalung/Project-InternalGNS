package items_test

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/url"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/items"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Exact SKU ranks first.
//
// The siblings are created first, so a tie at 0.92 would sort them ahead by
// id; only the exact branch matching in any case puts the exact SKU on top.
func TestHandler_SearchAdvanced_ExactSKUFirst(t *testing.T) {
	clean := testutil.NewCleaner(t)
	srv := newSrv(t)
	repo := items.NewRepo(testutil.Pool(t), testutil.Store(t))
	ctx := context.Background()

	stamp := time.Now().UnixNano()
	base := fmt.Sprintf("QX%d-1", stamp)
	ids := map[string]int64{}
	for i, sku := range []string{base + "0", base + "1", base} {
		id := insertItem(t, clean, fmt.Sprintf("Rantai Uji %d %d", stamp, i), true)
		_, err := repo.AddVendor(ctx, id, items.AddVendorToItemRequest{
			VendorID:  seedVendorID,
			VendorSKU: sentText(sku),
			CostPrice: ptrS("1000"),
		}, seedUserID)
		require.NoError(t, err)
		ids[sku] = id
	}

	for _, query := range []string{base, strings.ToLower(base)} {
		t.Run(query, func(t *testing.T) {
			res := doJSON(t, srv, http.MethodGet,
				"/items/search-advanced?q="+url.QueryEscape(query)+"&limit=20", nil)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			var body items.AdvancedSearchResponse
			require.NoError(t, json.NewDecoder(res.Body).Decode(&body))

			var offers []items.AdvancedSearchHit
			for _, h := range body.Hits {
				if h.Tier == "VENDOR_OFFER" {
					offers = append(offers, h)
				}
			}
			require.Len(t, offers, 3)
			assert.Equal(t, ids[base], offers[0].ID, "the exact SKU leads")
			assert.InDelta(t, 1.00, offers[0].Score, 0.001)
		})
	}
}
