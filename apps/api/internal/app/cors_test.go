package app

import (
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/db/queries"
)

// corsRouter needs no database.
func corsRouter(t *testing.T, origins []string) http.Handler {
	t.Helper()
	store, err := queries.Load()
	require.NoError(t, err)
	return NewRouter(Config{
		Env:                "test",
		JWTSecret:          "cors-test-secret",
		JWTExpiry:          time.Hour,
		CORSAllowedOrigins: origins,
	}, nil, store, nil)
}

// Credentials go to listed origins only.
// The refresh cookie rides on credentialed requests, so a preflight from any
// other origin, or from anywhere when the list is a wildcard, must get no
// Access-Control-Allow-Origin and no Access-Control-Allow-Credentials.
func TestRouter_CORSCredentials(t *testing.T) {
	const listed = "https://internal.globalsakti.com"
	cases := []struct {
		name    string
		origins []string
		origin  string
		method  string
		allowed bool
	}{
		{"listed origin preflight", []string{listed}, listed, http.MethodOptions, true},
		{"listed origin request", []string{listed}, listed, http.MethodGet, true},
		{"foreign origin preflight", []string{listed}, "https://evil.example", http.MethodOptions, false},
		{"foreign origin request", []string{listed}, "https://evil.example", http.MethodGet, false},
		{"lookalike origin", []string{listed}, listed + ".evil.example", http.MethodOptions, false},
		{"null origin", []string{listed}, "null", http.MethodOptions, false},
		{"wildcard list allows nobody", []string{"*"}, "https://evil.example", http.MethodOptions, false},
		{"empty list allows nobody", nil, "https://evil.example", http.MethodOptions, false},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			req := httptest.NewRequest(c.method, "/healthz", nil)
			req.Header.Set("Origin", c.origin)
			if c.method == http.MethodOptions {
				req.URL.Path = "/api/v1/auth/refresh"
				req.Header.Set("Access-Control-Request-Method", http.MethodPost)
				req.Header.Set("Access-Control-Request-Headers", "content-type, x-gns-csrf")
			}
			rec := httptest.NewRecorder()
			corsRouter(t, c.origins).ServeHTTP(rec, req)

			h := rec.Result().Header
			if !c.allowed {
				assert.Empty(t, h.Get("Access-Control-Allow-Origin"))
				assert.Empty(t, h.Get("Access-Control-Allow-Credentials"))
				return
			}
			assert.Equal(t, c.origin, h.Get("Access-Control-Allow-Origin"))
			assert.Equal(t, "true", h.Get("Access-Control-Allow-Credentials"))
			if c.method == http.MethodOptions {
				assert.Contains(t, strings.ToLower(h.Get("Access-Control-Allow-Headers")), "x-gns-csrf")
			}
		})
	}
}
