package auth_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/auth"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
	"github.com/nathangalung/internalgns/apps/api/internal/users"
)

func mkAuthServer(t *testing.T) (*httptest.Server, users.User, *auth.Service) {
	t.Helper()
	ctx, tx := testutil.BeginTx(t)
	repo := users.NewRepo(tx, testutil.Store(t))
	u, err := repo.Create(ctx, users.CreateUserRequest{
		Email:    "auth-handler@local",
		Name:     "Auth Handler",
		Password: "hpass-123",
		Role:     users.RoleOperational,
	}, seedUserID)
	require.NoError(t, err)

	svc := auth.NewService(repo, testSecret, time.Hour)
	h := auth.NewHandler(svc)

	requireAuth := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := deps.WithUserID(r.Context(), u.ID)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}

	r := chi.NewRouter()
	r.Mount("/auth", auth.Routes(h, requireAuth))

	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return srv, u, svc
}

func TestHandler_Login_Success(t *testing.T) {
	srv, u, _ := mkAuthServer(t)
	body, _ := json.Marshal(auth.LoginRequest{Email: u.Email, Password: "hpass-123"})
	res, err := srv.Client().Post(srv.URL+"/auth/login", "application/json", bytes.NewReader(body))
	require.NoError(t, err)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	var resp auth.LoginResponse
	require.NoError(t, json.NewDecoder(res.Body).Decode(&resp))
	assert.NotEmpty(t, resp.Token)
}

func TestHandler_Login_BadJSON(t *testing.T) {
	srv, _, _ := mkAuthServer(t)
	res, err := srv.Client().Post(srv.URL+"/auth/login", "application/json", strings.NewReader("?"))
	require.NoError(t, err)
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_Login_MissingEmail(t *testing.T) {
	srv, _, _ := mkAuthServer(t)
	body, _ := json.Marshal(auth.LoginRequest{Password: "x"})
	res, err := srv.Client().Post(srv.URL+"/auth/login", "application/json", bytes.NewReader(body))
	require.NoError(t, err)
	defer res.Body.Close()
	assert.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
}

func TestHandler_Login_MissingPassword(t *testing.T) {
	srv, _, _ := mkAuthServer(t)
	body, _ := json.Marshal(auth.LoginRequest{Email: "x@x"})
	res, err := srv.Client().Post(srv.URL+"/auth/login", "application/json", bytes.NewReader(body))
	require.NoError(t, err)
	defer res.Body.Close()
	assert.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
}

func TestHandler_Login_InvalidCredentials(t *testing.T) {
	srv, u, _ := mkAuthServer(t)
	body, _ := json.Marshal(auth.LoginRequest{Email: u.Email, Password: "wrong"})
	res, err := srv.Client().Post(srv.URL+"/auth/login", "application/json", bytes.NewReader(body))
	require.NoError(t, err)
	defer res.Body.Close()
	assert.Equal(t, http.StatusUnauthorized, res.StatusCode)
}

func TestHandler_Logout(t *testing.T) {
	srv, _, _ := mkAuthServer(t)
	res, err := srv.Client().Post(srv.URL+"/auth/logout", "application/json", nil)
	require.NoError(t, err)
	defer res.Body.Close()
	assert.Equal(t, http.StatusNoContent, res.StatusCode)
}

// mkAuthServerWithRefresh wires the refresh repo so we can hit /auth/refresh
// end-to-end against the real DB tx.
func mkAuthServerWithRefresh(t *testing.T) (*httptest.Server, users.User) {
	t.Helper()
	ctx, tx := testutil.BeginTx(t)
	store := testutil.Store(t)
	repo := users.NewRepo(tx, store)
	u, err := repo.Create(ctx, users.CreateUserRequest{
		Email:    "auth-handler-refresh@local",
		Name:     "Refresh Handler",
		Password: "hpass-123",
		Role:     users.RoleOperational,
	}, seedUserID)
	require.NoError(t, err)

	svc := auth.NewService(repo, testSecret, time.Hour).
		WithRefresh(auth.NewRefreshRepo(tx, store), time.Hour)
	h := auth.NewHandler(svc)
	r := chi.NewRouter()
	r.Mount("/auth", auth.Routes(h, func(next http.Handler) http.Handler { return next }))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return srv, u
}

func TestHandler_Refresh_HappyPath(t *testing.T) {
	srv, u := mkAuthServerWithRefresh(t)

	// Login to mint a refresh token.
	body, _ := json.Marshal(auth.LoginRequest{Email: u.Email, Password: "hpass-123"})
	res, err := srv.Client().Post(srv.URL+"/auth/login", "application/json", bytes.NewReader(body))
	require.NoError(t, err)
	var login auth.LoginResponse
	require.NoError(t, json.NewDecoder(res.Body).Decode(&login))
	res.Body.Close()
	require.NotEmpty(t, login.RefreshToken)

	// Now refresh it.
	body, _ = json.Marshal(auth.RefreshRequest{RefreshToken: login.RefreshToken})
	res, err = srv.Client().Post(srv.URL+"/auth/refresh", "application/json", bytes.NewReader(body))
	require.NoError(t, err)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)

	var rotated auth.LoginResponse
	require.NoError(t, json.NewDecoder(res.Body).Decode(&rotated))
	assert.NotEqual(t, login.RefreshToken, rotated.RefreshToken)
	assert.NotEmpty(t, rotated.Token)
}

func TestHandler_Refresh_BadJSON(t *testing.T) {
	srv, _ := mkAuthServerWithRefresh(t)
	res, err := srv.Client().Post(srv.URL+"/auth/refresh", "application/json", strings.NewReader("?"))
	require.NoError(t, err)
	defer res.Body.Close()
	assert.Equal(t, http.StatusBadRequest, res.StatusCode)
}

func TestHandler_Refresh_Missing(t *testing.T) {
	srv, _ := mkAuthServerWithRefresh(t)
	body, _ := json.Marshal(auth.RefreshRequest{})
	res, err := srv.Client().Post(srv.URL+"/auth/refresh", "application/json", bytes.NewReader(body))
	require.NoError(t, err)
	defer res.Body.Close()
	assert.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
}

func TestHandler_Refresh_Unknown(t *testing.T) {
	srv, _ := mkAuthServerWithRefresh(t)
	body, _ := json.Marshal(auth.RefreshRequest{RefreshToken: "not-a-token"})
	res, err := srv.Client().Post(srv.URL+"/auth/refresh", "application/json", bytes.NewReader(body))
	require.NoError(t, err)
	defer res.Body.Close()
	assert.Equal(t, http.StatusUnauthorized, res.StatusCode)
}

func TestHandler_Logout_WithRefreshToken(t *testing.T) {
	srv, u := mkAuthServerWithRefresh(t)
	body, _ := json.Marshal(auth.LoginRequest{Email: u.Email, Password: "hpass-123"})
	res, err := srv.Client().Post(srv.URL+"/auth/login", "application/json", bytes.NewReader(body))
	require.NoError(t, err)
	var login auth.LoginResponse
	require.NoError(t, json.NewDecoder(res.Body).Decode(&login))
	res.Body.Close()

	body, _ = json.Marshal(auth.LogoutRequest{RefreshToken: login.RefreshToken})
	res, err = srv.Client().Post(srv.URL+"/auth/logout", "application/json", bytes.NewReader(body))
	require.NoError(t, err)
	defer res.Body.Close()
	require.Equal(t, http.StatusNoContent, res.StatusCode)

	// The revoked token should no longer refresh — reuse is detected.
	body, _ = json.Marshal(auth.RefreshRequest{RefreshToken: login.RefreshToken})
	res, err = srv.Client().Post(srv.URL+"/auth/refresh", "application/json", bytes.NewReader(body))
	require.NoError(t, err)
	defer res.Body.Close()
	assert.Equal(t, http.StatusUnauthorized, res.StatusCode)
}

func TestHandler_Me(t *testing.T) {
	srv, u, _ := mkAuthServer(t)
	req, _ := http.NewRequest(http.MethodGet, srv.URL+"/auth/me", nil)
	res, err := srv.Client().Do(req)
	require.NoError(t, err)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	var got auth.MeUser
	require.NoError(t, json.NewDecoder(res.Body).Decode(&got))
	assert.Equal(t, u.ID, got.ID)
	assert.Equal(t, u.Email, got.Email)
}

func TestHandler_Me_NoUserID(t *testing.T) {
	t.Helper()
	_, tx := testutil.BeginTx(t)
	repo := users.NewRepo(tx, testutil.Store(t))
	svc := auth.NewService(repo, testSecret, time.Hour)
	h := auth.NewHandler(svc)

	bypass := func(next http.Handler) http.Handler { return next }

	r := chi.NewRouter()
	r.Mount("/auth", auth.Routes(h, bypass))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	res, err := srv.Client().Get(srv.URL + "/auth/me")
	require.NoError(t, err)
	defer res.Body.Close()
	assert.Equal(t, http.StatusUnauthorized, res.StatusCode)
}

func TestHandler_Login_DBError(t *testing.T) {
	repo := users.NewRepo(testutil.FakeExec{}, testutil.Store(t))
	svc := auth.NewService(repo, testSecret, time.Hour)
	h := auth.NewHandler(svc)

	r := chi.NewRouter()
	r.Mount("/auth", auth.Routes(h, func(next http.Handler) http.Handler { return next }))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	body, _ := json.Marshal(auth.LoginRequest{Email: "x@x", Password: "p"})
	res, err := srv.Client().Post(srv.URL+"/auth/login", "application/json", bytes.NewReader(body))
	require.NoError(t, err)
	defer res.Body.Close()
	assert.Equal(t, http.StatusInternalServerError, res.StatusCode)
}

func TestHandler_Me_DBError(t *testing.T) {
	repo := users.NewRepo(testutil.FakeExec{}, testutil.Store(t))
	svc := auth.NewService(repo, testSecret, time.Hour)
	h := auth.NewHandler(svc)

	requireAuth := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := deps.WithUserID(r.Context(), 1)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}

	r := chi.NewRouter()
	r.Mount("/auth", auth.Routes(h, requireAuth))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	res, err := srv.Client().Get(srv.URL + "/auth/me")
	require.NoError(t, err)
	defer res.Body.Close()
	assert.Equal(t, http.StatusInternalServerError, res.StatusCode)
}

func TestHandler_Me_UserGone(t *testing.T) {
	t.Helper()
	_, tx := testutil.BeginTx(t)
	repo := users.NewRepo(tx, testutil.Store(t))
	svc := auth.NewService(repo, testSecret, time.Hour)
	h := auth.NewHandler(svc)

	requireAuth := func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ctx := deps.WithUserID(r.Context(), 99999999)
			next.ServeHTTP(w, r.WithContext(ctx))
		})
	}

	r := chi.NewRouter()
	r.Mount("/auth", auth.Routes(h, requireAuth))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	res, err := srv.Client().Get(srv.URL + "/auth/me")
	require.NoError(t, err)
	defer res.Body.Close()
	assert.Equal(t, http.StatusUnauthorized, res.StatusCode)
}
