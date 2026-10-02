package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/shared/httpx"
)

// An oversized JSON body is a 413.
// The 2 MiB body limit used to surface as 400 "invalid json", which told
// the user the request was malformed instead of too large.
func TestRouter_OversizedJSONIs413(t *testing.T) {
	r := mkRouter(t)
	userIDs := rbacUsers(t)
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	body := `{"notes":"` + strings.Repeat("a", 2*1024*1024) + `"}`

	cases := []struct{ method, path string }{
		{http.MethodPost, "/api/v1/quotations/"},
		{http.MethodPut, "/api/v1/quotations/1/header"},
		{http.MethodPost, "/api/v1/quotations/1/lines"},
		{http.MethodPost, "/api/v1/quotations/1/revise"},
		{http.MethodPost, "/api/v1/quotations/1/send"},
		{http.MethodPost, "/api/v1/items/match-rows"},
		{http.MethodPost, "/api/v1/clients/"},
	}
	for _, c := range cases {
		t.Run(c.method+" "+c.path, func(t *testing.T) {
			req, err := http.NewRequest(c.method, srv.URL+c.path, strings.NewReader(body))
			require.NoError(t, err)
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Authorization", "Bearer "+mintToken(t, userIDs["superadmin"], "superadmin"))
			res, err := srv.Client().Do(req)
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusRequestEntityTooLarge, res.StatusCode)
			var p struct {
				Detail string `json:"detail"`
			}
			require.NoError(t, json.NewDecoder(res.Body).Decode(&p))
			assert.Equal(t, httpx.BodyTooLargeDetail, p.Detail)
		})
	}
}
