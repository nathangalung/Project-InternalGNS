package clients_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/clients"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

func faultySrv(t *testing.T) *httptest.Server {
	return testutil.FaultyServer(t, seedUserID, func(r chi.Router, d deps.Deps) {
		r.Mount("/clients", clients.Routes(d))
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
		{"list", http.MethodGet, "/clients/", nil, http.StatusInternalServerError},
		{"get", http.MethodGet, "/clients/1", nil, http.StatusInternalServerError},
		{"search", http.MethodGet, "/clients/search?q=x", nil, http.StatusInternalServerError},
		{"list_contacts", http.MethodGet, "/clients/1/contacts", nil, http.StatusInternalServerError},
		{"create", http.MethodPost, "/clients/",
			clients.CreateClientRequest{Name: "X"}, http.StatusInternalServerError},
		{"create_contact", http.MethodPost, "/clients/1/contacts",
			clients.CreateContactRequest{Name: "X"}, http.StatusInternalServerError},
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
			res, err := srv.Client().Do(req)
			require.NoError(t, err)
			defer res.Body.Close()
			assert.Equal(t, c.want, res.StatusCode)
		})
	}
}
