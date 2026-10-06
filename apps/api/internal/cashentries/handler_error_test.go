package cashentries_test

import (
	"net/http"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"

	"github.com/nathangalung/internalgns/apps/api/internal/cashentries"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// A failing database is a 500.
func TestHandler_ErrorPaths(t *testing.T) {
	srv := testutil.FaultyServer(t, seedUserID, func(r chi.Router, d deps.Deps) {
		r.Mount("/cash-entries", cashentries.Routes(d))
	})
	version := map[string]string{"If-Match": "1"}
	for _, c := range []struct {
		name, method, path string
		body               any
		header             map[string]string
	}{
		{"list", http.MethodGet, "/cash-entries/", nil, nil},
		{"summary", http.MethodGet, "/cash-entries/summary", nil, nil},
		{"categories", http.MethodGet, "/cash-entries/categories", nil, nil},
		{"get", http.MethodGet, "/cash-entries/1", nil, nil},
		{"create", http.MethodPost, "/cash-entries/", valid(), nil},
		{"update", http.MethodPut, "/cash-entries/1", valid(), version},
		{"delete", http.MethodDelete, "/cash-entries/1", nil, nil},
		{"export", http.MethodGet, "/cash-entries/export.xlsx", nil, nil},
	} {
		t.Run(c.name, func(t *testing.T) {
			code, _, _ := call(t, srv, c.method, c.path, c.body, c.header)
			assert.Equal(t, http.StatusInternalServerError, code)
		})
	}

	code, _, _ := call(t, srv, http.MethodPut, "/cash-entries/1", valid(), map[string]string{"If-Match": "x"})
	assert.Equal(t, http.StatusBadRequest, code, "a bad If-Match")
}
