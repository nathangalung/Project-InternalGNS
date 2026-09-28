package app

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/db/queries"
	"github.com/nathangalung/internalgns/apps/api/internal/auth"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/session"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
	"github.com/nathangalung/internalgns/apps/api/internal/users"
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

// Only development drops Secure.
// The router derives the cookie rule from ENV: a development API reached
// over plain-http loopback (make dev) issues a cookie without Secure, and
// every other environment marks it Secure even on loopback.
func TestRouter_RefreshCookieSecurePerEnv(t *testing.T) {
	pool := testutil.Pool(t)
	store := testutil.Store(t)
	cleaner := testutil.NewCleaner(t)
	repo := users.NewRepo(pool, store)
	u, err := repo.Create(context.Background(), users.CreateUserRequest{
		Email:    fmt.Sprintf("cookie-env-%d@test.local", time.Now().UnixNano()),
		Name:     "Cookie Env",
		Password: "Cookie-env-pw1!",
		Role:     users.RoleOperational,
	}, 1)
	require.NoError(t, err)
	cleaner.User(u.ID)

	cases := []struct {
		env    string
		secure bool
	}{
		{"development", false},
		{"test", true},
		{"production", true},
	}
	for _, c := range cases {
		t.Run(c.env, func(t *testing.T) {
			srv := httptest.NewServer(NewRouter(Config{
				Env:                c.env,
				JWTSecret:          "cookie-env-secret",
				JWTExpiry:          time.Hour,
				RefreshTokenExpiry: time.Hour,
				CORSAllowedOrigins: []string{"http://localhost:5174"},
			}, pool, store, nil))
			t.Cleanup(srv.Close)

			body, _ := json.Marshal(auth.LoginRequest{Email: u.Email, Password: "Cookie-env-pw1!"})
			res, err := srv.Client().Post(srv.URL+"/api/v1/auth/login", "application/json", bytes.NewReader(body))
			require.NoError(t, err)
			defer res.Body.Close()
			require.Equal(t, http.StatusOK, res.StatusCode)
			var got *http.Cookie
			for _, ck := range res.Cookies() {
				if ck.Name == session.CookieName {
					got = ck
				}
			}
			require.NotNil(t, got)
			assert.Equal(t, c.secure, got.Secure, got.Raw)
			assert.True(t, got.HttpOnly)
		})
	}
}
