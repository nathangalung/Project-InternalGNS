package vendors_test

import (
	"context"
	"encoding/json"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/httperr"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/validate"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
	"github.com/nathangalung/internalgns/apps/api/internal/vendors"
)

// Contact info fails per field.
// A bad phone or email in contactInfo is a 422 on the nested key, and the
// stored row is untouched.
func TestHandler_ContactInfo_FieldLevel422(t *testing.T) {
	srv := newSrv(t)
	id := insertVendor(t, "CV Kontak Salah", "Jakarta", true)
	cases := []struct {
		name   string
		method string
		path   string
		info   vendors.ContactInfo
		want   map[string]string
	}{
		{"create 13 digit phone", http.MethodPost, "/vendors/",
			vendors.ContactInfo{Phone: "8123456789012"},
			map[string]string{"contactInfo.phone": validate.PhoneMessage}},
		{"create bad email", http.MethodPost, "/vendors/",
			vendors.ContactInfo{Email: "toko@maju"},
			map[string]string{"contactInfo.email": validate.EmailMessage}},
		{"update 8 digit phone and bad email", http.MethodPut, vendorPath(id, ""),
			vendors.ContactInfo{Phone: "81234567", Email: "toko maju@x.id"},
			map[string]string{
				"contactInfo.phone": validate.PhoneMessage,
				"contactInfo.email": validate.EmailMessage,
			}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			info := c.info
			res := doJSON(t, srv, c.method, c.path, vendors.UpdateVendorRequest{
				Name: "CV Kontak Salah", ContactInfo: &info, IsActive: true,
			})
			defer res.Body.Close()
			require.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
			var p httperr.Error
			require.NoError(t, json.NewDecoder(res.Body).Decode(&p))
			assert.Equal(t, c.want, p.Fields)
		})
	}

	got := getVendor(t, srv, id)
	assert.Equal(t, &vendors.ContactInfo{Email: "awal@vendor.local", Phone: "0811111111"}, got.ContactInfo)
}

// Valid contact info round-trips.
// Phone at both bounds, a trimmed-free email and the SKU are stored as sent.
func TestHandler_ContactInfo_ValidSaves(t *testing.T) {
	srv := newSrv(t)
	for _, info := range []vendors.ContactInfo{
		{Phone: "812345678", Email: "toko@maju.co.id", SKU: "SKU-1"},
		{Phone: "0812-3456-7890"},
		{Email: "toko@maju.com"},
	} {
		res := doJSON(t, srv, http.MethodPost, "/vendors/", vendors.CreateVendorRequest{
			Name: "CV Kontak Benar", ContactInfo: &info,
		})
		var v vendors.Vendor
		require.Equal(t, http.StatusCreated, res.StatusCode)
		require.NoError(t, json.NewDecoder(res.Body).Decode(&v))
		res.Body.Close()
		testutil.NewCleaner(t).Vendor(v.ID)
		assert.Equal(t, &info, v.ContactInfo)
	}
}

// Contact info is an object.
func TestHandler_ContactInfo_NotObjectIsBadRequest(t *testing.T) {
	srv := newSrv(t)
	for _, raw := range []string{`"toko@maju.com"`, `[1]`, `{"phone":81234567890}`} {
		res := doJSON(t, srv, http.MethodPost, "/vendors/",
			json.RawMessage(`{"name":"CV Bukan Objek","contactInfo":`+raw+`}`))
		res.Body.Close()
		assert.Equal(t, http.StatusBadRequest, res.StatusCode, raw)
	}
}

// Keys outside the shape drop.
// The contract is email, phone and sku; anything else is neither stored on
// write nor returned on read.
func TestHandler_ContactInfo_UnknownKeysDrop(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodPost, "/vendors/",
		json.RawMessage(`{"name":"CV Kunci Lain","contactInfo":{"email":"toko@maju.com","fax":"021555"}}`))
	defer res.Body.Close()
	require.Equal(t, http.StatusCreated, res.StatusCode)
	var v vendors.Vendor
	require.NoError(t, json.NewDecoder(res.Body).Decode(&v))
	testutil.NewCleaner(t).Vendor(v.ID)

	var stored string
	require.NoError(t, testutil.Pool(t).QueryRow(context.Background(),
		`SELECT contact_info::text FROM vendors WHERE id = $1`, v.ID).Scan(&stored))
	assert.JSONEq(t, `{"email":"toko@maju.com"}`, stored)

	_, err := testutil.Pool(t).Exec(context.Background(),
		`UPDATE vendors SET contact_info = '{"phone":"0811111111","fax":"021555"}' WHERE id = $1`, v.ID)
	require.NoError(t, err)
	assert.Equal(t, &vendors.ContactInfo{Phone: "0811111111"}, getVendor(t, srv, v.ID).ContactInfo)
}
