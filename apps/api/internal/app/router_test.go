package app

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
)

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
	return NewRouter(cfg, pool, store)
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
