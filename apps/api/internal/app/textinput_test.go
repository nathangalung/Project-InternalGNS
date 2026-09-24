package app

import (
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

// Unstorable text is the caller's mistake.
// Postgres refuses a NUL byte and invalid UTF-8 in a text parameter with
// SQLSTATE 22021. Only clients, vendors and items screen their query
// strings, so on every other slice that refusal reached the caller as a 500
// and paged the error stream (MD-17).
func TestRouter_UnstorableTextIsClientError(t *testing.T) {
	r := mkRouter(t)
	userIDs := rbacUsers(t)
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	bearer := "Bearer " + mintToken(t, userIDs["superadmin"], "superadmin")

	cases := []struct {
		name   string
		method string
		path   string
		body   string
	}{
		{"users NUL search", http.MethodGet, "/api/v1/users/?q=a%00b", ""},
		{"users bad UTF-8 search", http.MethodGet, "/api/v1/users/?q=%ff", ""},
		{"quotations NUL search", http.MethodGet, "/api/v1/quotations/?q=a%00b", ""},
		{"quotations bad UTF-8 search", http.MethodGet, "/api/v1/quotations/?q=%ff", ""},
		{"purchase orders NUL search", http.MethodGet, "/api/v1/purchase-orders/?q=a%00b", ""},
		{"invoices NUL search", http.MethodGet, "/api/v1/invoices/?q=a%00b", ""},
		{"clients NUL search", http.MethodGet, "/api/v1/clients/?q=a%00b", ""},
		{"vendors NUL search", http.MethodGet, "/api/v1/vendors/?q=a%00b", ""},
		{"items NUL search", http.MethodGet, "/api/v1/items/?q=a%00b", ""},
		{"user name with NUL", http.MethodPost, "/api/v1/users/",
			`{"email":"nul-name@test.local","name":"a\u0000b","password":"Kuat-sandi-9!","role":"operational"}`},
		{"user name past the column", http.MethodPost, "/api/v1/users/",
			`{"email":"long-name@test.local","name":"` + strings.Repeat("n", 256) + `","password":"Kuat-sandi-9!","role":"operational"}`},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			req, err := http.NewRequest(c.method, srv.URL+c.path, strings.NewReader(c.body))
			require.NoError(t, err)
			req.Header.Set("Authorization", bearer)
			req.Header.Set("Content-Type", "application/json")
			res, err := srv.Client().Do(req)
			require.NoError(t, err)
			defer res.Body.Close()

			assert.GreaterOrEqual(t, res.StatusCode, 400)
			assert.Less(t, res.StatusCode, 500, "unstorable text must not be a server error")
			assert.Equal(t, "application/problem+json", res.Header.Get("Content-Type"))
			var problem struct {
				Detail string `json:"detail"`
			}
			require.NoError(t, json.NewDecoder(res.Body).Decode(&problem))
			assert.NotEmpty(t, problem.Detail)
		})
	}

	// A refused create stores nothing.
	var n int
	require.NoError(t, testutil.Pool(t).QueryRow(t.Context(),
		`SELECT count(*) FROM users WHERE email IN ('nul-name@test.local', 'long-name@test.local')`).Scan(&n))
	assert.Zero(t, n)
}
