package clients_test

import (
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
)

const missingClientID = "999999999"

// Reject unstorable query text with 400.
func TestHandler_QueryParamTextIsValidated(t *testing.T) {
	srv := newSrv(t)
	tests := []struct {
		name string
		path string
	}{
		{"nul byte in list q", "/clients/?q=%00"},
		{"invalid utf8 in list q", "/clients/?q=%ff%fe"},
		{"nul byte in search q", "/clients/search?q=ab%00"},
		{"nul byte in countryCode", "/clients/?countryCode=ab%00"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			res := doJSON(t, srv, http.MethodGet, tt.path, nil)
			defer res.Body.Close()
			assert.Equal(t, http.StatusBadRequest, res.StatusCode)
		})
	}
}

// Sub-collections of a missing client answer 404.
func TestHandler_ListContacts_MissingParentIsNotFound(t *testing.T) {
	srv := newSrv(t)
	res := doJSON(t, srv, http.MethodGet, "/clients/"+missingClientID+"/contacts", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusNotFound, res.StatusCode)
}

// Whitespace-only names are rejected on clients and contacts.
func TestHandler_Name_WhitespaceOnlyRejected(t *testing.T) {
	srv := newSrv(t)
	tests := []struct {
		name   string
		method string
		path   string
		body   any
	}{
		{"client spaces", http.MethodPost, "/clients/", clients.CreateClientRequest{Name: "   "}},
		{"client tab", http.MethodPost, "/clients/", clients.CreateClientRequest{Name: "\t\n "}},
		{"contact spaces", http.MethodPost, "/clients/1/contacts", clients.CreateContactRequest{Name: "  "}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			res := doJSON(t, srv, tt.method, tt.path, tt.body)
			defer res.Body.Close()
			assert.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
		})
	}
}
