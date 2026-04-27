package vendors_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
	"github.com/nathangalung/internalgns/apps/api/internal/vendors"
)

func faultySrv(t *testing.T) *httptest.Server {
	return testutil.FaultyServer(t, seedUserID, func(r chi.Router, d deps.Deps) {
		r.Mount("/vendors", vendors.Routes(d))
	})
}

func TestHandler_ErrorPaths(t *testing.T) {
	srv := faultySrv(t)

	cases := []struct {
		name   string
		method string
		path   string
		body   any
	}{
		{"list", http.MethodGet, "/vendors/", nil},
		{"get", http.MethodGet, "/vendors/1", nil},
		{"search", http.MethodGet, "/vendors/search?q=x", nil},
		{"items", http.MethodGet, "/vendors/1/items", nil},
		{"create", http.MethodPost, "/vendors/", vendors.CreateVendorRequest{Name: "X"}},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var body *bytes.Reader
			if c.body != nil {
				raw, _ := json.Marshal(c.body)
				body = bytes.NewReader(raw)
			}
			var req *http.Request
			var err error
			if body != nil {
				req, err = http.NewRequest(c.method, srv.URL+c.path, body)
				req.Header.Set("Content-Type", "application/json")
			} else {
				req, err = http.NewRequest(c.method, srv.URL+c.path, nil)
			}
			require.NoError(t, err)
			res, err := srv.Client().Do(req)
			require.NoError(t, err)
			defer res.Body.Close()
			assert.Equal(t, http.StatusInternalServerError, res.StatusCode)
		})
	}
}
