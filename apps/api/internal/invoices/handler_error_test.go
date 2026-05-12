package invoices_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/invoices"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

func faultySrv(t *testing.T) *httptest.Server {
	return testutil.FaultyServer(t, seedUserID, func(r chi.Router, d deps.Deps) {
		r.Mount("/invoices", invoices.Routes(d))
	})
}

func TestHandler_ErrorPaths(t *testing.T) {
	srv := faultySrv(t)

	cases := []struct {
		name   string
		method string
		path   string
		body   any
		want   int
	}{
		{"list", http.MethodGet, "/invoices/", nil, http.StatusInternalServerError},
		{"summary", http.MethodGet, "/invoices/summary", nil, http.StatusInternalServerError},
		{"get", http.MethodGet, "/invoices/1", nil, http.StatusInternalServerError},
		{"get_by_quotation", http.MethodGet, "/invoices/by-quotation/1", nil, http.StatusInternalServerError},
		{"change_status", http.MethodPatch, "/invoices/1/status",
			invoices.ChangeStatusRequest{Status: invoices.StatusSent}, http.StatusInternalServerError},
		{"update_dates", http.MethodPatch, "/invoices/1/dates",
			invoices.UpdateDatesRequest{}, http.StatusInternalServerError},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var rdr *bytes.Reader
			if c.body != nil {
				raw, _ := json.Marshal(c.body)
				rdr = bytes.NewReader(raw)
			}
			var req *http.Request
			var err error
			if rdr != nil {
				req, err = http.NewRequest(c.method, srv.URL+c.path, rdr)
				req.Header.Set("Content-Type", "application/json")
			} else {
				req, err = http.NewRequest(c.method, srv.URL+c.path, nil)
			}
			require.NoError(t, err)
			// Optimistic-lock guarded routes need If-Match to reach repo.
			if c.name == "update_dates" {
				req.Header.Set("If-Match", "1")
			}
			res, err := srv.Client().Do(req)
			require.NoError(t, err)
			defer res.Body.Close()
			assert.Equal(t, c.want, res.StatusCode)
		})
	}
}
