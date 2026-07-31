package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/auth"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
	"github.com/nathangalung/internalgns/apps/api/internal/users"
)

// Mint a valid bearer token for a role.
func mintToken(t *testing.T, role string) string {
	t.Helper()
	now := time.Now()
	claims := auth.Claims{
		Role: users.Role(role),
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "internalgns-api",
			Subject:   "1",
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
		},
	}
	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte("router-test-secret"))
	require.NoError(t, err)
	return signed
}

// Each role-gated mount enforces its policy at the router.
func TestRouter_RBACPerMount(t *testing.T) {
	r := mkRouter(t)
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	// allowed = expect any status except 403; denied = expect 403.
	type policy struct{ superadmin, finance, operational bool }
	subtrees := []struct {
		path string
		want policy
	}{
		{"/api/v1/quotations", policy{true, false, true}},
		{"/api/v1/purchase-orders", policy{true, false, true}},
		{"/api/v1/invoices", policy{true, true, false}},
		{"/api/v1/users", policy{true, false, false}},
	}
	roles := []struct {
		name    string
		allowed func(policy) bool
	}{
		{"superadmin", func(p policy) bool { return p.superadmin }},
		{"finance", func(p policy) bool { return p.finance }},
		{"operational", func(p policy) bool { return p.operational }},
	}
	for _, st := range subtrees {
		for _, role := range roles {
			t.Run(st.path+"/"+role.name, func(t *testing.T) {
				req, _ := http.NewRequest(http.MethodGet, srv.URL+st.path, nil)
				req.Header.Set("Authorization", "Bearer "+mintToken(t, role.name))
				res, err := srv.Client().Do(req)
				require.NoError(t, err)
				defer res.Body.Close()
				if role.allowed(st.want) {
					assert.NotEqual(t, http.StatusForbidden, res.StatusCode,
						"%s should reach %s", role.name, st.path)
				} else {
					assert.Equal(t, http.StatusForbidden, res.StatusCode,
						"%s must be forbidden on %s", role.name, st.path)
				}
			})
		}
	}
}

func mkRouter(t *testing.T) http.Handler {
	t.Helper()
	pool := testutil.Pool(t)
	store := testutil.Store(t)
	cfg := Config{
		Env:                "test",
		HTTPAddr:           ":0",
		DatabaseURL:        "ignored",
		JWTSecret:          "router-test-secret",
		JWTExpiry:          time.Hour,
		CORSAllowedOrigins: []string{"http://localhost:5173"},
	}
	return NewRouter(cfg, pool, store, nil)
}

func TestRouter_Healthz(t *testing.T) {
	r := mkRouter(t)
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	res, err := srv.Client().Get(srv.URL + "/healthz")
	require.NoError(t, err)
	defer res.Body.Close()
	assert.Equal(t, http.StatusOK, res.StatusCode)

	var body map[string]string
	require.NoError(t, json.NewDecoder(res.Body).Decode(&body))
	assert.Equal(t, "ok", body["status"])
}

func TestRouter_Readyz(t *testing.T) {
	r := mkRouter(t)
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	res, err := srv.Client().Get(srv.URL + "/readyz")
	require.NoError(t, err)
	defer res.Body.Close()
	// mkRouter wires a live pool, so readiness passes.
	assert.Equal(t, http.StatusOK, res.StatusCode)

	var body map[string]string
	require.NoError(t, json.NewDecoder(res.Body).Decode(&body))
	assert.Equal(t, "ready", body["status"])
}

func TestRouter_ProtectedRoutesRequireAuth(t *testing.T) {
	r := mkRouter(t)
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	paths := []string{
		"/api/v1/units",
		"/api/v1/countries",
		"/api/v1/clients",
		"/api/v1/items",
		"/api/v1/vendors",
		"/api/v1/quotations",
		"/api/v1/dashboard/summary",
	}
	for _, p := range paths {
		t.Run(p, func(t *testing.T) {
			res, err := srv.Client().Get(srv.URL + p)
			require.NoError(t, err)
			defer res.Body.Close()
			assert.Equal(t, http.StatusUnauthorized, res.StatusCode)
		})
	}
}

func TestRouter_AuthLoginIsPublic(t *testing.T) {
	r := mkRouter(t)
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	req, _ := http.NewRequestWithContext(context.Background(),
		http.MethodPost, srv.URL+"/api/v1/auth/login", nil)
	res, err := srv.Client().Do(req)
	require.NoError(t, err)
	defer res.Body.Close()
	assert.NotEqual(t, http.StatusUnauthorized, res.StatusCode)
}

func TestRouter_CORSPreflight(t *testing.T) {
	r := mkRouter(t)
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	req, _ := http.NewRequest(http.MethodOptions, srv.URL+"/api/v1/units", nil)
	req.Header.Set("Origin", "http://localhost:5173")
	req.Header.Set("Access-Control-Request-Method", "GET")
	req.Header.Set("Access-Control-Request-Headers", "Authorization")
	res, err := srv.Client().Do(req)
	require.NoError(t, err)
	defer res.Body.Close()

	assert.Equal(t, "http://localhost:5173", res.Header.Get("Access-Control-Allow-Origin"))
}

func TestRouter_NotFound(t *testing.T) {
	r := mkRouter(t)
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	res, err := srv.Client().Get(srv.URL + "/api/v1/nope")
	require.NoError(t, err)
	defer res.Body.Close()
	assert.Equal(t, http.StatusNotFound, res.StatusCode)
}

func TestNewServer_BadDSN(t *testing.T) {
	cfg := Config{
		Env:                "test",
		HTTPAddr:           ":0",
		DatabaseURL:        "not-a-real-dsn::::",
		JWTSecret:          "x",
		JWTExpiry:          time.Hour,
		CORSAllowedOrigins: []string{"*"},
		SuperadminEmail:    "a@a",
		SuperadminPassword: "p",
	}
	_, err := NewServer(context.Background(), cfg)
	assert.Error(t, err)
}

func TestNewServer_MigrationsFailOnCancelledCtx(t *testing.T) {
	_ = testutil.Pool(t)
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	cfg := Config{
		Env:                "test",
		HTTPAddr:           ":0",
		DatabaseURL:        testutil.DSN(),
		JWTSecret:          "x",
		JWTExpiry:          time.Hour,
		CORSAllowedOrigins: []string{"*"},
		SuperadminEmail:    "a@a",
		SuperadminPassword: "p",
	}
	_, err := NewServer(ctx, cfg)
	assert.Error(t, err)
}

func TestNewServer_SeedFailsOnLongPassword(t *testing.T) {
	_ = testutil.Pool(t)
	long := make([]byte, 80)
	for i := range long {
		long[i] = 'a'
	}
	cfg := Config{
		Env:                "test",
		HTTPAddr:           ":0",
		DatabaseURL:        testutil.DSN(),
		JWTSecret:          "x",
		JWTExpiry:          time.Hour,
		CORSAllowedOrigins: []string{"*"},
		SuperadminEmail:    "long-pw-admin@local",
		SuperadminPassword: string(long),
	}
	_, err := NewServer(context.Background(), cfg)
	assert.Error(t, err)
}

func TestNewServer_HappyPath(t *testing.T) {
	_ = testutil.Pool(t)
	cfg := Config{
		Env:                "test",
		HTTPAddr:           ":0",
		DatabaseURL:        testutil.DSN(),
		JWTSecret:          "happy-secret",
		JWTExpiry:          time.Hour,
		CORSAllowedOrigins: []string{"*"},
		SuperadminEmail:    "newserver-admin@local",
		SuperadminName:     "NewServer Admin",
		SuperadminPassword: "secret-pass",
	}
	srv, err := NewServer(context.Background(), cfg)
	require.NoError(t, err)
	require.NotNil(t, srv)
	assert.Equal(t, ":0", srv.Addr)
}
