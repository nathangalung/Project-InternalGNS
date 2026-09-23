package vendors_test

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/nathangalung/internalgns/apps/api/internal/vendors"
)

const missingVendorID = "999999999"

// Reject unstorable query text with 400.
func TestHandler_QueryParamTextIsValidated(t *testing.T) {
	srv := newSrv(t)
	tests := []struct {
		name string
		path string
	}{
		{"nul byte in list q", "/vendors/?q=%00"},
		{"invalid utf8 in list q", "/vendors/?q=%ff%fe"},
		{"nul byte in search q", "/vendors/search?q=ab%00"},
		{"nul byte in countryName", "/vendors/?countryName=ab%00"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			res := doJSON(t, srv, http.MethodGet, tt.path, nil)
			defer res.Body.Close()
			assert.Equal(t, http.StatusBadRequest, res.StatusCode)
		})
	}
}

// Sub-collections of a missing vendor answer 404.
func TestHandler_ListItems_MissingParentIsNotFound(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/vendors/"+missingVendorID+"/items", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusNotFound, res.StatusCode)
}

// Whitespace-only names are rejected.
func TestHandler_Name_WhitespaceOnlyRejected(t *testing.T) {
	srv := newSrv(t)
	tests := []struct {
		name string
		body vendors.CreateVendorRequest
	}{
		{"spaces", vendors.CreateVendorRequest{Name: "   "}},
		{"tab and newline", vendors.CreateVendorRequest{Name: "\t\n "}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			res := doJSON(t, srv, http.MethodPost, "/vendors/", tt.body)
			defer res.Body.Close()
			assert.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
		})
	}
}
