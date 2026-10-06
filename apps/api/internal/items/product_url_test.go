package items_test

import (
	"encoding/json"
	"fmt"
	"net/http"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/items"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/validate"
)

// Store links are web addresses.
// A link that is not http or https is a 422 on productUrl and stores
// nothing; a padded link is stored trimmed, and a blank one clears it.
func TestHandler_AddVendor_ProductURL(t *testing.T) {
	srv := newSrv(t)
	it := createItem(t, items.CreateItemRequest{Name: fmt.Sprintf("Barang Link %d", time.Now().UnixNano())})
	vendor := createVendor(t, true)
	path := fmt.Sprintf("/items/%d/vendors", it.ID)

	bad := doJSON(t, srv, http.MethodPost, path, map[string]any{"vendorId": vendor, "productUrl": "javascript:alert(1)"})
	defer bad.Body.Close()
	require.Equal(t, http.StatusUnprocessableEntity, bad.StatusCode)
	var p httperr.Error
	require.NoError(t, json.NewDecoder(bad.Body).Decode(&p))
	assert.Equal(t, map[string]string{"productUrl": validate.URLMessage}, p.Fields)

	ok := doJSON(t, srv, http.MethodPost, path, map[string]any{"vendorId": vendor, "productUrl": "  https://toko.example/barang  "})
	defer ok.Body.Close()
	require.Equal(t, http.StatusCreated, ok.StatusCode)
	var row items.VendorForItem
	require.NoError(t, json.NewDecoder(ok.Body).Decode(&row))
	require.NotNil(t, row.ProductURL)
	assert.Equal(t, "https://toko.example/barang", *row.ProductURL)

	clear := doJSON(t, srv, http.MethodPost, path, map[string]any{"vendorId": vendor, "productUrl": ""})
	defer clear.Body.Close()
	require.Equal(t, http.StatusCreated, clear.StatusCode)
	var cleared items.VendorForItem
	require.NoError(t, json.NewDecoder(clear.Body).Decode(&cleared))
	assert.Nil(t, cleared.ProductURL)
}
