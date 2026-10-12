package vendors_test

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/validate"
	"github.com/nathangalung/internalgns/apps/api/internal/vendors"
)

// The vendor keeps its store link.
// Link Toko is where the vendor sells, stored trimmed; a blank or absent
// link stores none, since PUT replaces the vendor like its location.
func TestHandler_StoreURL_Saved(t *testing.T) {
	srv := newSrv(t)
	cases := []struct {
		name string
		sent *string
		want *string
	}{
		{"padded link stored trimmed", ptr("  https://toko.example/maju  "), ptr("https://toko.example/maju")},
		{"blank stores none", ptr("   "), nil},
		{"absent stores none", nil, nil},
	}
	for _, c := range cases {
		t.Run("create "+c.name, func(t *testing.T) {
			res := doJSON(t, srv, http.MethodPost, "/vendors/", vendors.CreateVendorRequest{
				Name: "CV Toko Daring", StoreURL: c.sent,
			})
			defer res.Body.Close()
			require.Equal(t, http.StatusCreated, res.StatusCode)
			var v vendors.Vendor
			require.NoError(t, json.NewDecoder(res.Body).Decode(&v))
			assert.Equal(t, c.want, v.StoreURL)
			assert.Equal(t, c.want, getVendor(t, srv, v.ID).StoreURL)
		})
		t.Run("update "+c.name, func(t *testing.T) {
			id := insertVendor(t, "CV Toko Ganti", "Jakarta", true)
			first := doJSON(t, srv, http.MethodPut, vendorPath(id, ""), vendors.UpdateVendorRequest{
				Name: "CV Toko Ganti", StoreURL: ptr("https://lama.example"), IsActive: true,
			})
			first.Body.Close()
			require.Equal(t, http.StatusOK, first.StatusCode)

			res := doJSON(t, srv, http.MethodPut, vendorPath(id, ""), vendors.UpdateVendorRequest{
				Name: "CV Toko Ganti", StoreURL: c.sent, IsActive: true,
			})
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			var v vendors.Vendor
			require.NoError(t, json.NewDecoder(res.Body).Decode(&v))
			assert.Equal(t, c.want, v.StoreURL)
			assert.Equal(t, c.want, getVendor(t, srv, id).StoreURL)
		})
	}
}

// A store link must be a web address.
// Anything but http or https is a 422 on storeUrl, and the stored row
// keeps its link.
func TestHandler_StoreURL_Refused(t *testing.T) {
	srv := newSrv(t)
	id := insertVendor(t, "CV Toko Tetap", "Jakarta", true)
	keep := doJSON(t, srv, http.MethodPut, vendorPath(id, ""), vendors.UpdateVendorRequest{
		Name: "CV Toko Tetap", StoreURL: ptr("https://tetap.example"), IsActive: true,
	})
	keep.Body.Close()
	require.Equal(t, http.StatusOK, keep.StatusCode)

	cases := []struct {
		name, method, path, url string
	}{
		{"create script link", http.MethodPost, "/vendors/", "javascript:alert(1)"},
		{"create no scheme", http.MethodPost, "/vendors/", "tokopedia.com/maju"},
		{"update script link", http.MethodPut, vendorPath(id, ""), "javascript:alert(1)"},
		{"update spaces", http.MethodPut, vendorPath(id, ""), "https://toko.example/a b"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			res := doJSON(t, srv, c.method, c.path, vendors.UpdateVendorRequest{
				Name: "CV Toko Tetap", StoreURL: ptr(c.url), IsActive: true,
			})
			defer res.Body.Close()
			require.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
			var p httperr.Error
			require.NoError(t, json.NewDecoder(res.Body).Decode(&p))
			assert.Equal(t, map[string]string{"storeUrl": validate.StoreURLMessage}, p.Fields)
		})
	}
	both := doJSON(t, srv, http.MethodPut, vendorPath(id, ""), vendors.UpdateVendorRequest{
		Name: "CV Toko Tetap", ContactInfo: &vendors.ContactInfo{Email: "toko@maju"},
		StoreURL: ptr("ftp://toko.example"), IsActive: true,
	})
	defer both.Body.Close()
	require.Equal(t, http.StatusUnprocessableEntity, both.StatusCode)
	var p httperr.Error
	require.NoError(t, json.NewDecoder(both.Body).Decode(&p))
	assert.Equal(t, map[string]string{
		"contactInfo.email": validate.EmailMessage,
		"storeUrl":          validate.StoreURLMessage,
	}, p.Fields, "one answer names every bad field")

	assert.Equal(t, ptr("https://tetap.example"), getVendor(t, srv, id).StoreURL)
}
