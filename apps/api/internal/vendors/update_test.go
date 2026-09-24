package vendors_test

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/vendors"
)

// PUT replaces contactInfo (MD-05).
//
// The detail form clears email and phone by sending contactInfo without
// them; the API must store exactly what it was sent, not merge.
func TestHandler_Update_ReplacesContactInfo(t *testing.T) {
	cases := []struct {
		name        string
		contactInfo json.RawMessage
		location    *string
		wantContact string
	}{
		{"empty object clears email and phone", json.RawMessage(`{}`), ptr("Surabaya"), `{}`},
		{"phone only drops email", json.RawMessage(`{"phone":"0822222222"}`), ptr("Surabaya"), `{"phone":"0822222222"}`},
		{"omitted clears contact and location", nil, nil, `null`},
	}
	srv := newSrv(t)
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			id := insertVendor(t, "CV Kontak Ganti", "Jakarta", true)
			res := doJSON(t, srv, http.MethodPut, vendorPath(id, ""), vendors.UpdateVendorRequest{
				Name: "CV Kontak Ganti", Location: c.location, ContactInfo: c.contactInfo, IsActive: true,
			})
			res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)

			got := getVendor(t, srv, id)
			assert.Equal(t, c.location, got.Location)
			assert.JSONEq(t, c.wantContact, string(got.ContactInfo))
		})
	}
}

// Deactivation shows on read.
func TestHandler_Update_Deactivates(t *testing.T) {
	srv := newSrv(t)
	id := insertVendor(t, "CV Tutup Buku", "Medan", true)

	res := doJSON(t, srv, http.MethodPut, vendorPath(id, ""), vendors.UpdateVendorRequest{
		Name: "  CV Tutup Buku  ", Location: ptr("Medan"), IsActive: false,
	})
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	var put vendors.Vendor
	require.NoError(t, json.NewDecoder(res.Body).Decode(&put))
	assert.Equal(t, "CV Tutup Buku", put.Name, "name stored trimmed")
	assert.False(t, put.IsActive)

	got := getVendor(t, srv, id)
	assert.False(t, got.IsActive)
	assert.Equal(t, "CV Tutup Buku", got.Name)
}

func getVendor(t *testing.T, srv *httptest.Server, id int64) vendors.Vendor {
	t.Helper()
	res := doJSON(t, srv, http.MethodGet, vendorPath(id, ""), nil)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	var v vendors.Vendor
	require.NoError(t, json.NewDecoder(res.Body).Decode(&v))
	return v
}
