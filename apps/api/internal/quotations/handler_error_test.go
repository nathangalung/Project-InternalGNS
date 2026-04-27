package quotations_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/quotations"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

func faultySrv(t *testing.T) *httptest.Server {
	return testutil.FaultyServer(t, 1, func(r chi.Router, d deps.Deps) {
		r.Mount("/quotations", quotations.Routes(d))
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
		{"list", http.MethodGet, "/quotations/", nil, http.StatusInternalServerError},
		{"stats", http.MethodGet, "/quotations/stats", nil, http.StatusInternalServerError},
		{"get", http.MethodGet, "/quotations/1", nil, http.StatusInternalServerError},
		{"create", http.MethodPost, "/quotations/", quotations.CreateRequest{
			CompanyClientID: 1,
			DiscountPct:     "0",
			Items: []quotations.CreateItem{
				{RequestedName: "X", Qty: "1", UnitID: 19, SellingPrice: "1"},
			},
		}, http.StatusBadRequest},
		{"update", http.MethodPut, "/quotations/1", quotations.UpdateRequest{
			DiscountPct: "0",
			Items: []quotations.CreateItem{
				{RequestedName: "X", Qty: "1", UnitID: 19, SellingPrice: "1"},
			},
		}, http.StatusBadRequest},
		{"status", http.MethodPatch, "/quotations/1/status",
			quotations.ChangeStatusRequest{Status: "sent"}, http.StatusBadRequest},
		{"send", http.MethodPost, "/quotations/1/send", nil, http.StatusBadRequest},
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
			assert.Equal(t, c.want, res.StatusCode)
		})
	}
}
