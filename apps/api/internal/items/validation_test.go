package items_test

import (
	"encoding/json"
	"net/http"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/items"
)

const missingItemID = "999999999"

// Reject unstorable query text with 400.
func TestHandler_QueryParamTextIsValidated(t *testing.T) {
	srv := newSrv(t)
	tests := []struct {
		name string
		path string
	}{
		{"nul byte in list q", "/items/?q=%00"},
		{"nul byte inside list q", "/items/?q=ab%00cd"},
		{"invalid utf8 in list q", "/items/?q=%ff%fe"},
		{"nul byte in search q", "/items/search?q=ab%00"},
		{"nul byte in advanced search q", "/items/search-advanced?q=ab%00"},
		{"nul byte in sortBy", "/items/?sortBy=name%00"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			res := doJSON(t, srv, http.MethodGet, tt.path, nil)
			defer res.Body.Close()
			assert.Equal(t, http.StatusBadRequest, res.StatusCode)
		})
	}
}

// Reject an unparsable unitId filter instead of ignoring it.
func TestHandler_List_InvalidUnitIDIsBadRequest(t *testing.T) {
	srv := newSrv(t)
	tests := []struct {
		name string
		path string
	}{
		{"not a number", "/items/?unitId=abc"},
		{"out of int16 range", "/items/?unitId=99999"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			res := doJSON(t, srv, http.MethodGet, tt.path, nil)
			defer res.Body.Close()
			assert.Equal(t, http.StatusBadRequest, res.StatusCode)
		})
	}
}

// Sub-collections of a missing item answer 404.
func TestHandler_SubCollections_MissingParentIsNotFound(t *testing.T) {
	srv := newSrv(t)
	tests := []struct {
		name string
		path string
	}{
		{"vendors", "/items/" + missingItemID + "/vendors"},
		{"price history", "/items/" + missingItemID + "/price-history"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			res := doJSON(t, srv, http.MethodGet, tt.path, nil)
			defer res.Body.Close()
			assert.Equal(t, http.StatusNotFound, res.StatusCode)
		})
	}
}

// Whitespace-only names are rejected and stored names are trimmed.
func TestHandler_Name_WhitespaceOnlyRejected(t *testing.T) {
	srv := newSrv(t)
	tests := []struct {
		name string
		body items.CreateItemRequest
		want int
	}{
		{"spaces", items.CreateItemRequest{Name: "   "}, http.StatusUnprocessableEntity},
		{"tab and newline", items.CreateItemRequest{Name: "\t\n "}, http.StatusUnprocessableEntity},
		{"empty", items.CreateItemRequest{Name: ""}, http.StatusUnprocessableEntity},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			res := doJSON(t, srv, http.MethodPost, "/items/", tt.body)
			defer res.Body.Close()
			assert.Equal(t, tt.want, res.StatusCode)
		})
	}
}

// Create trims the stored name.
func TestHandler_Create_TrimsName(t *testing.T) {
	srv := newSrv(t)
	unit := defaultUnitID
	name := uniqueItemName("TRIM")
	res := doJSON(t, srv, http.MethodPost, "/items/", items.CreateItemRequest{
		Name: "  " + name + "  ", DefaultUnitID: &unit,
	})
	defer res.Body.Close()
	require.Equal(t, http.StatusCreated, res.StatusCode)

	var created items.Item
	require.NoError(t, json.NewDecoder(res.Body).Decode(&created))
	t.Cleanup(func() { deleteItem(t, created.ID) })
	assert.Equal(t, name, created.Name)
}
