package app

import (
	"context"
	"encoding/json"
	"fmt"
	"net/http"
	"net/http/httptest"
	"sort"
	"strconv"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/db/queries"
	"github.com/nathangalung/internalgns/apps/api/internal/auth"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
	"github.com/nathangalung/internalgns/apps/api/internal/users"
)

// mintToken signs a user's token.
func mintToken(t *testing.T, userID int64, role string) string {
	t.Helper()
	now := time.Now()
	claims := auth.Claims{
		Role:           users.Role(role),
		SessionVersion: 1,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "internalgns-api",
			Subject:   strconv.FormatInt(userID, 10),
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
		},
	}
	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte("router-test-secret"))
	require.NoError(t, err)
	return signed
}

// Router enforces each mount's roles.
// The middleware reads the role from the account, not the claim, so each
// role needs a real user of its own.
func TestRouter_RBACPerMount(t *testing.T) {
	r := mkRouter(t)
	userIDs := rbacUsers(t)
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	// policy marks each role's access.
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
				req.Header.Set("Authorization", "Bearer "+mintToken(t, userIDs[role.name], role.name))
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
	cleaner := testutil.NewCleaner(t)
	srv, err := NewServer(context.Background(), cfg)
	trackSeeded(t, cleaner, cfg.SuperadminEmail)
	require.NoError(t, err)
	require.NotNil(t, srv)
	t.Cleanup(srv.Close)
	assert.Equal(t, ":0", srv.HTTP.Addr)
}

// Close releases the pool.
// Otherwise every boot leaks 20 connections.
func TestNewServer_CloseReleasesPool(t *testing.T) {
	_ = testutil.Pool(t)
	cfg := Config{
		Env:                "test",
		HTTPAddr:           ":0",
		DatabaseURL:        testutil.DSN(),
		JWTSecret:          "close-pool-secret",
		JWTExpiry:          time.Hour,
		CORSAllowedOrigins: []string{"*"},
		SuperadminEmail:    "closepool-admin@local",
		SuperadminName:     "Close Pool Admin",
		SuperadminPassword: "secret-pass",
	}
	// Cancelled after the build so the refresh-purge loop stops with it,
	// as SIGTERM does in production.
	cleaner := testutil.NewCleaner(t)
	ctx, cancel := context.WithCancel(context.Background())
	srv, err := NewServer(ctx, cfg)
	trackSeeded(t, cleaner, cfg.SuperadminEmail)
	require.NoError(t, err)
	require.NoError(t, srv.pool.Ping(context.Background()))
	cancel()

	srv.Close()
	assert.Error(t, srv.pool.Ping(context.Background()), "pool must be closed")
	srv.Close() // idempotent: main defers it after Shutdown
}

// Failed boot returns no server.
// No caller can then leak a half-built one.
func TestNewServer_FailedBootReturnsNoServer(t *testing.T) {
	_ = testutil.Pool(t)
	long := strings.Repeat("a", 80)
	cases := []struct {
		name string
		dsn  string
		pw   string
		ctx  func() context.Context
	}{
		{"bad dsn", "not-a-real-dsn::::", "p", context.Background},
		{"cancelled ctx", testutil.DSN(), "p", func() context.Context {
			ctx, cancel := context.WithCancel(context.Background())
			cancel()
			return ctx
		}},
		{"seed rejects long password", testutil.DSN(), long, context.Background},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			cfg := Config{
				Env:                "test",
				HTTPAddr:           ":0",
				DatabaseURL:        c.dsn,
				JWTSecret:          "x",
				JWTExpiry:          time.Hour,
				CORSAllowedOrigins: []string{"*"},
				SuperadminEmail:    "failed-boot@local",
				SuperadminPassword: c.pw,
			}
			srv, err := NewServer(c.ctx(), cfg)
			require.Error(t, err)
			assert.Nil(t, srv)
		})
	}
}

// Long budget covers render routes.
// It covers exactly the workbook and PDF routes.
func TestRouter_RenderRoutesClassified(t *testing.T) {
	store, err := queries.Load()
	require.NoError(t, err)
	cfg := Config{
		Env:           "test",
		HTTPAddr:      ":0",
		JWTSecret:     "render-route-secret",
		JWTExpiry:     time.Hour,
		TemplatesRoot: t.TempDir(), // registers the PDF routes
	}
	r := NewRouter(cfg, nil, store, nil)

	var long, short []string
	err = chi.Walk(r, func(_, route string, _ http.Handler, _ ...func(http.Handler) http.Handler) error {
		if isRenderRoute(route) {
			long = append(long, route)
			return nil
		}
		short = append(short, route)
		return nil
	})
	require.NoError(t, err)
	sort.Strings(long)

	assert.Equal(t, []string{
		"/api/v1/dashboard/export.xlsx",
		"/api/v1/invoices/coretax.xlsx",
		"/api/v1/invoices/export.xlsx",
		"/api/v1/invoices/{id}/pdf",
		"/api/v1/purchase-orders/export.xlsx",
		"/api/v1/purchase-orders/{id}/delivery-note.pdf",
		"/api/v1/quotations/export.xlsx",
		"/api/v1/quotations/{id}/pdf",
	}, long)
	// Guard the other direction: a single-invoice XML render is not a bulk job.
	assert.Contains(t, short, "/api/v1/invoices/{id}/coretax.xml")
}

// rbacUsers creates per-role users.
func rbacUsers(t *testing.T) map[string]int64 {
	t.Helper()
	cleaner := testutil.NewCleaner(t)
	repo := users.NewRepo(testutil.Pool(t), testutil.Store(t))
	userIDs := map[string]int64{}
	for _, role := range []users.Role{users.RoleSuperadmin, users.RoleFinance, users.RoleOperational} {
		u, err := repo.Create(context.Background(), users.CreateUserRequest{
			Email:    fmt.Sprintf("rbac-%s-%d@test.local", role, time.Now().UnixNano()),
			Name:     "RBAC " + string(role),
			Password: "Rbac-mount-pw1!",
			Role:     role,
		}, 1)
		require.NoError(t, err)
		cleaner.User(u.ID)
		userIDs[string(role)] = u.ID
	}
	return userIDs
}

// Finance reads items and vendors.
// It writes neither.
// Client writes stay open to finance for NPWP and TKU. Every write carries
// an empty body, so an allowed request stops at validation and stores
// nothing.
func TestRouter_FinanceReadOnlyOnItemsAndVendors(t *testing.T) {
	r := mkRouter(t)
	userIDs := rbacUsers(t)
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	cases := []struct {
		role   string
		method string
		path   string
		denied bool
	}{
		{"finance", http.MethodPost, "/api/v1/items/", true},
		{"finance", http.MethodPut, "/api/v1/items/1", true},
		{"finance", http.MethodPost, "/api/v1/items/1/vendors", true},
		{"finance", http.MethodPost, "/api/v1/items/match-rows", true},
		{"finance", http.MethodPatch, "/api/v1/items/1/image", true},
		{"finance", http.MethodGet, "/api/v1/items/1/image/upload-url?fileName=x.png", true},
		{"finance", http.MethodPost, "/api/v1/vendors/", true},
		{"finance", http.MethodPut, "/api/v1/vendors/1", true},
		{"finance", http.MethodPatch, "/api/v1/vendors/1/logo", true},
		{"finance", http.MethodGet, "/api/v1/vendors/1/logo/upload-url?fileName=x.png", true},
		{"finance", http.MethodGet, "/api/v1/items/", false},
		{"finance", http.MethodGet, "/api/v1/items/1", false},
		{"finance", http.MethodGet, "/api/v1/items/search?q=bolt", false},
		{"finance", http.MethodGet, "/api/v1/items/1/vendors", false},
		{"finance", http.MethodGet, "/api/v1/vendors/", false},
		{"finance", http.MethodGet, "/api/v1/vendors/1", false},
		{"finance", http.MethodPut, "/api/v1/clients/1", false},
		{"finance", http.MethodPost, "/api/v1/clients/", false},
		{"operational", http.MethodPost, "/api/v1/items/", false},
		{"operational", http.MethodPut, "/api/v1/vendors/1", false},
		{"operational", http.MethodGet, "/api/v1/items/1/image/upload-url?fileName=x.png", false},
		{"superadmin", http.MethodPost, "/api/v1/vendors/", false},
	}
	for _, c := range cases {
		t.Run(c.role+" "+c.method+" "+c.path, func(t *testing.T) {
			var body *strings.Reader
			if c.method != http.MethodGet {
				body = strings.NewReader("{}")
			} else {
				body = strings.NewReader("")
			}
			req, err := http.NewRequest(c.method, srv.URL+c.path, body)
			require.NoError(t, err)
			req.Header.Set("Content-Type", "application/json")
			req.Header.Set("Authorization", "Bearer "+mintToken(t, userIDs[c.role], c.role))
			res, err := srv.Client().Do(req)
			require.NoError(t, err)
			defer res.Body.Close()
			if c.denied {
				assert.Equal(t, http.StatusForbidden, res.StatusCode)
				return
			}
			assert.NotEqual(t, http.StatusForbidden, res.StatusCode)
			assert.NotEqual(t, http.StatusInternalServerError, res.StatusCode, "an allowed call must not break")
		})
	}
}
