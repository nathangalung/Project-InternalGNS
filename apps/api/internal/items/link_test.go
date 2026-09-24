package items_test

import (
	"context"
	"encoding/json"
	"net/http"
	"net/url"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/items"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

func listVendors(t *testing.T, itemID int64) []items.VendorForItem {
	t.Helper()
	res := doJSON(t, newSrv(t), http.MethodGet, "/items/"+itoa(itemID)+"/vendors", nil)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	var rows []items.VendorForItem
	require.NoError(t, json.NewDecoder(res.Body).Decode(&rows))
	return rows
}

// Relinking updates the one offer.
func TestHandler_AddVendor_RelinkUpdatesInPlace(t *testing.T) {
	it := createItem(t, items.CreateItemRequest{Name: uniqueItemName("RELINK")})
	vendorID := createVendor(t, true)
	link := func(req items.AddVendorToItemRequest) items.VendorForItem {
		t.Helper()
		req.VendorID = vendorID
		res := doJSON(t, newSrv(t), http.MethodPost, "/items/"+itoa(it.ID)+"/vendors", req)
		defer res.Body.Close()
		require.Equal(t, http.StatusCreated, res.StatusCode)
		var row items.VendorForItem
		require.NoError(t, json.NewDecoder(res.Body).Decode(&row))
		return row
	}

	first := link(items.AddVendorToItemRequest{
		VendorSKU: ptrS("SKU-1"), CostPrice: ptrS("1500"), ProductURL: ptrS("https://toko.local/a"),
	})
	second := link(items.AddVendorToItemRequest{VendorSKU: ptrS("SKU-2"), CostPrice: ptrS(""), ProductURL: ptrS("")})
	assert.Equal(t, first.VendorProductID, second.VendorProductID, "same offer row")

	rows := listVendors(t, it.ID)
	require.Len(t, rows, 1)
	got := rows[0]
	assert.Equal(t, vendorID, got.VendorID)
	require.NotNil(t, got.VendorSKU)
	assert.Equal(t, "SKU-2", *got.VendorSKU)
	require.NotNil(t, got.CostPrice)
	assert.Equal(t, "0.00", *got.CostPrice, "a blank cost is stored as zero")
	assert.Nil(t, got.ProductURL, "a blank URL clears it")
}

// vendorId is required.
func TestHandler_AddVendor_RequiresVendorID(t *testing.T) {
	it := createItem(t, items.CreateItemRequest{Name: uniqueItemName("NO VENDOR")})
	for _, id := range []int64{0, -5} {
		res := doJSON(t, newSrv(t), http.MethodPost, "/items/"+itoa(it.ID)+"/vendors",
			items.AddVendorToItemRequest{VendorID: id})
		res.Body.Close()
		assert.Equal(t, http.StatusUnprocessableEntity, res.StatusCode, "vendorId %d", id)
	}
	assert.Empty(t, listVendors(t, it.ID))
}

// PUT rewrites every field.
func TestHandler_Update_RewritesItem(t *testing.T) {
	it := createItem(t, items.CreateItemRequest{Name: uniqueItemName("UBAH"), Description: ptrS("lama")})
	impa := uniqueIMPA()
	name := uniqueItemName("UBAH BARU")
	res := doJSON(t, newSrv(t), http.MethodPut, "/items/"+itoa(it.ID), items.UpdateItemRequest{
		Name: "  " + name + " ", IMPACode: ptrS(" " + impa + " "), DefaultUnitID: ptrI16(kgUnitID), IsActive: false,
	})
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)

	got, err := items.NewRepo(testutil.Pool(t), testutil.Store(t)).GetByID(context.Background(), it.ID)
	require.NoError(t, err)
	assert.Equal(t, name, got.Name)
	require.NotNil(t, got.IMPACode)
	assert.Equal(t, strings.ToUpper(impa), *got.IMPACode)
	require.NotNil(t, got.DefaultUnitID)
	assert.Equal(t, kgUnitID, *got.DefaultUnitID)
	assert.Nil(t, got.Description, "an omitted description is cleared")
	assert.False(t, got.IsActive)
}

// minScore gates the item layer.
func TestHandler_SearchAdvanced_MinScore(t *testing.T) {
	name := uniqueItemName("AMBANG")
	it := createItem(t, items.CreateItemRequest{Name: name})
	cases := []struct {
		name  string
		query string
		found bool
	}{
		{"default threshold finds the exact name", "", true},
		{"unreachable threshold hides it", "&minScore=1.5", false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			res := doJSON(t, newSrv(t), http.MethodGet, "/items/search-advanced?q="+url.QueryEscape(name)+c.query, nil)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			var out items.AdvancedSearchResponse
			require.NoError(t, json.NewDecoder(res.Body).Decode(&out))
			found := false
			for _, h := range out.Hits {
				found = found || h.ID == it.ID
			}
			assert.Equal(t, c.found, found)
		})
	}
}
