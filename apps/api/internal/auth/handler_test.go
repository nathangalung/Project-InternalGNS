package auth_test

import (
	"bytes"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/auth"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/session"
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
	h := newHandler(svc)

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

func TestHandler_Logout_WithoutCookie(t *testing.T) {
	srv, _, _ := mkAuthServer(t)
	res := cookieCall(t, srv, "/auth/logout", "", nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusNoContent, res.StatusCode)
	assertCleared(t, res)
}

// No refresh store, no cookie.
func TestHandler_Login_WithoutRefreshSetsNoCookie(t *testing.T) {
	srv, u, _ := mkAuthServer(t)
	res := postHandlerLogin(t, srv, u.Email)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	assertNoCookie(t, res)
}

// mkAuthServerWithRefresh wires refresh too.
// The refresh repo lets a test hit /auth/refresh end-to-end against the real
// DB tx.
func mkAuthServerWithRefresh(t *testing.T) (*httptest.Server, users.User) {
	t.Helper()
	srv, u, _ := mkRefreshServerTx(t)
	return srv, u
}

// mkRefreshServerTx also returns the tx.
func mkRefreshServerTx(t *testing.T) (*httptest.Server, users.User, pgx.Tx) {
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
	h := newHandler(svc)
	r := chi.NewRouter()
	r.Mount("/auth", auth.Routes(h, func(next http.Handler) http.Handler { return next }))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)
	return srv, u, tx
}

func postHandlerLogin(t *testing.T, srv *httptest.Server, email string) *http.Response {
	t.Helper()
	body, _ := json.Marshal(auth.LoginRequest{Email: email, Password: "hpass-123"})
	res, err := srv.Client().Post(srv.URL+"/auth/login", "application/json", bytes.NewReader(body))
	require.NoError(t, err)
	return res
}

// loginCookie signs in, returns the cookie.
func loginCookie(t *testing.T, srv *httptest.Server, email string) string {
	t.Helper()
	res := postHandlerLogin(t, srv, email)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	return assertIssued(t, res)
}

// Login issues the cookie only.
func TestHandler_Login_SetsRefreshCookie(t *testing.T) {
	srv, u := mkAuthServerWithRefresh(t)
	res := postHandlerLogin(t, srv, u.Email)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	token := assertIssued(t, res)

	raw, err := io.ReadAll(res.Body)
	require.NoError(t, err)
	assertTokenNotInBody(t, raw, token)
	var body map[string]any
	require.NoError(t, json.Unmarshal(raw, &body))
	assert.NotEmpty(t, body["token"])
	assert.NotContains(t, body, "refreshToken")
	assert.NotContains(t, body, "refreshExpiresAt")
}

// Refresh rotates the cookie.
func TestHandler_Refresh_RotatesCookie(t *testing.T) {
	srv, u := mkAuthServerWithRefresh(t)
	first := loginCookie(t, srv, u.Email)

	res := cookieCall(t, srv, "/auth/refresh", first, nil)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	next := assertIssued(t, res)
	assert.NotEqual(t, first, next)

	raw, err := io.ReadAll(res.Body)
	require.NoError(t, err)
	assertTokenNotInBody(t, raw, next)
	var body auth.LoginResponse
	require.NoError(t, json.Unmarshal(raw, &body))
	assert.NotEmpty(t, body.Token)

	again := cookieCall(t, srv, "/auth/refresh", next, nil)
	defer again.Body.Close()
	assert.Equal(t, http.StatusOK, again.StatusCode)
}

// Page loads never exhaust refresh.
// Every page load and new tab rotates the cookie, all from one office
// address; 25 rotations in a minute must all pass.
func TestHandler_Refresh_ManyPageLoads(t *testing.T) {
	srv, u := mkAuthServerWithRefresh(t)
	token := loginCookie(t, srv, u.Email)
	for i := range 25 {
		res := cookieCall(t, srv, "/auth/refresh", token, nil)
		require.Equal(t, http.StatusOK, res.StatusCode, "refresh %d", i+1)
		token = assertIssued(t, res)
		res.Body.Close()
	}
}

// Refresh reads only the cookie.
// A token in the body, the old contract, is ignored and left unspent.
func TestHandler_Refresh_IgnoresBodyToken(t *testing.T) {
	srv, u := mkAuthServerWithRefresh(t)
	token := loginCookie(t, srv, u.Email)

	body, _ := json.Marshal(map[string]string{"refreshToken": token})
	res := cookieCall(t, srv, "/auth/refresh", "", func(r *http.Request) {
		r.Body = io.NopCloser(bytes.NewReader(body))
		r.ContentLength = int64(len(body))
		r.Header.Set("Content-Type", "application/json")
	})
	defer res.Body.Close()
	assert.Equal(t, http.StatusUnauthorized, res.StatusCode)
	assert.Equal(t, auth.DetailNotSignedIn, problemDetail(t, res))

	ok := cookieCall(t, srv, "/auth/refresh", token, nil)
	defer ok.Body.Close()
	assert.Equal(t, http.StatusOK, ok.StatusCode, "the body token must not have been spent")
}

// Refused refresh clears the cookie.
func TestHandler_Refresh_Refusals(t *testing.T) {
	cases := []struct {
		name   string
		token  func(t *testing.T, srv *httptest.Server, email string) string
		detail string
	}{
		{"no cookie", func(*testing.T, *httptest.Server, string) string { return "" },
			auth.DetailNotSignedIn},
		{"unknown token", func(*testing.T, *httptest.Server, string) string { return "not-a-token" },
			"Token penyegar tidak valid. Silakan masuk kembali."},
		{"revoked by logout", func(t *testing.T, srv *httptest.Server, email string) string {
			token := loginCookie(t, srv, email)
			res := cookieCall(t, srv, "/auth/logout", token, nil)
			res.Body.Close()
			require.Equal(t, http.StatusNoContent, res.StatusCode)
			return token
		}, "Sesi Anda sudah diakhiri. Silakan masuk kembali."},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv, u := mkAuthServerWithRefresh(t)
			res := cookieCall(t, srv, "/auth/refresh", tc.token(t, srv, u.Email), nil)
			defer res.Body.Close()
			assert.Equal(t, http.StatusUnauthorized, res.StatusCode)
			assertCleared(t, res)
			assert.Equal(t, tc.detail, problemDetail(t, res))
		})
	}
}

// Rotate once, return both tokens.
func rotateCookie(t *testing.T, srv *httptest.Server, email string) (string, string) {
	t.Helper()
	first := loginCookie(t, srv, email)
	res := cookieCall(t, srv, "/auth/refresh", first, nil)
	defer res.Body.Close()
	require.Equal(t, http.StatusOK, res.StatusCode)
	return first, assertIssued(t, res)
}

// Replay past grace clears cookie.
func TestHandler_Refresh_ReplayPastGraceClears(t *testing.T) {
	srv, u, tx := mkRefreshServerTx(t)
	first, rotated := rotateCookie(t, srv, u.Email)
	_, err := tx.Exec(t.Context(), `UPDATE refresh_tokens SET revoked_at = now() - interval '30 seconds'
		WHERE user_id = $1 AND revoked_at IS NOT NULL`, u.ID)
	require.NoError(t, err)

	res := cookieCall(t, srv, "/auth/refresh", first, nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusUnauthorized, res.StatusCode)
	assert.Equal(t, "Token penyegar sudah pernah dipakai. Silakan masuk kembali.", problemDetail(t, res))
	assertCleared(t, res)

	ended := cookieCall(t, srv, "/auth/refresh", rotated, nil)
	defer ended.Body.Close()
	assert.Equal(t, http.StatusUnauthorized, ended.StatusCode, "a replay ends every session")
}

// Reuse inside grace keeps cookie.
// Two tabs share one cookie jar: the loser of a concurrent rotation must not
// expire the winner's fresh cookie, since the service judged it a race.
func TestHandler_Refresh_ReuseInsideGraceKeepsCookie(t *testing.T) {
	srv, u := mkAuthServerWithRefresh(t)
	first, rotated := rotateCookie(t, srv, u.Email)

	res := cookieCall(t, srv, "/auth/refresh", first, nil)
	defer res.Body.Close()
	assert.Equal(t, http.StatusUnauthorized, res.StatusCode)
	assert.Equal(t, "Token penyegar sudah pernah dipakai. Silakan masuk kembali.", problemDetail(t, res))
	assertNoCookie(t, res)

	ok := cookieCall(t, srv, "/auth/refresh", rotated, nil)
	defer ok.Body.Close()
	assert.Equal(t, http.StatusOK, ok.StatusCode, "the winner's session survives the race")
}

// loginFrom posts a shaped login.
func loginFrom(t *testing.T, srv *httptest.Server, email, origin, contentType string) *http.Response {
	t.Helper()
	body, _ := json.Marshal(auth.LoginRequest{Email: email, Password: "hpass-123"})
	req, err := http.NewRequest(http.MethodPost, srv.URL+"/auth/login", bytes.NewReader(body))
	require.NoError(t, err)
	if origin != "" {
		req.Header.Set("Origin", origin)
	}
	if contentType != "" {
		req.Header.Set("Content-Type", contentType)
	}
	res, err := srv.Client().Do(req)
	require.NoError(t, err)
	return res
}

// Login refuses foreign pages.
// A browser always sends Origin on a POST, so a cross-site form or a sibling
// subdomain cannot plant a cookie; a client without Origin still signs in.
// Only JSON is read, which a plain form cannot send.
func TestHandler_Login_RefusesForeignPage(t *testing.T) {
	cases := []struct {
		name        string
		origin      string
		contentType string
		status      int
		detail      string
	}{
		{"listed origin", testOrigin, "application/json", http.StatusOK, ""},
		{"no origin", "", "application/json", http.StatusOK, ""},
		{"json with charset", testOrigin, "application/json; charset=utf-8", http.StatusOK, ""},
		{"foreign origin", "https://evil.example", "application/json", http.StatusForbidden, session.DetailOriginRefused},
		{"null origin", "null", "application/json", http.StatusForbidden, session.DetailOriginRefused},
		{"foreign form", "https://evil.example", "text/plain", http.StatusForbidden, session.DetailOriginRefused},
		{"plain text", testOrigin, "text/plain", http.StatusUnsupportedMediaType, auth.DetailJSONOnly},
		{"form encoded", "", "application/x-www-form-urlencoded", http.StatusUnsupportedMediaType, auth.DetailJSONOnly},
		{"no content type", testOrigin, "", http.StatusUnsupportedMediaType, auth.DetailJSONOnly},
		{"unparsable content type", testOrigin, "application/json; =", http.StatusUnsupportedMediaType, auth.DetailJSONOnly},
	}
	for _, tc := range cases {
		t.Run(tc.name, func(t *testing.T) {
			srv, u := mkAuthServerWithRefresh(t)
			res := loginFrom(t, srv, u.Email, tc.origin, tc.contentType)
			defer res.Body.Close()
			require.Equal(t, tc.status, res.StatusCode)
			if tc.status == http.StatusOK {
				assertIssued(t, res)
				return
			}
			assert.Equal(t, tc.detail, problemDetail(t, res))
			assertNoCookie(t, res)
		})
	}
}

// Refused logins spend no budget.
// A foreign page must not exhaust the victim's per-address login limit.
func TestHandler_Login_RefusalSkipsLimiter(t *testing.T) {
	srv, u, _ := mkAuthServer(t)
	for range 6 {
		res := loginFrom(t, srv, u.Email, "https://evil.example", "application/json")
		res.Body.Close()
		require.Equal(t, http.StatusForbidden, res.StatusCode)
		res = loginFrom(t, srv, u.Email, testOrigin, "text/plain")
		res.Body.Close()
		require.Equal(t, http.StatusUnsupportedMediaType, res.StatusCode)
	}
	res := loginFrom(t, srv, u.Email, testOrigin, "application/json")
	defer res.Body.Close()
	assert.Equal(t, http.StatusOK, res.StatusCode)
}

// Cookie routes demand Origin, header.
// A refused request spends nothing: the cookie still refreshes afterwards.
func TestHandler_CookieRoutes_CSRFGuard(t *testing.T) {
	cases := []struct {
		name   string
		mutate func(*http.Request)
		detail string
	}{
		{"missing csrf header", func(r *http.Request) { r.Header.Del(session.CSRFHeader) }, session.DetailCSRFMissing},
		{"foreign origin", func(r *http.Request) { r.Header.Set("Origin", "https://evil.example") }, session.DetailOriginRefused},
		{"missing origin", func(r *http.Request) { r.Header.Del("Origin") }, session.DetailOriginRefused},
	}
	for _, path := range []string{"/auth/refresh", "/auth/logout"} {
		for _, tc := range cases {
			t.Run(path+"/"+tc.name, func(t *testing.T) {
				srv, u := mkAuthServerWithRefresh(t)
				token := loginCookie(t, srv, u.Email)

				res := cookieCall(t, srv, path, token, tc.mutate)
				defer res.Body.Close()
				assert.Equal(t, http.StatusForbidden, res.StatusCode)
				assert.Equal(t, tc.detail, problemDetail(t, res))
				assertNoCookie(t, res)

				ok := cookieCall(t, srv, "/auth/refresh", token, nil)
				defer ok.Body.Close()
				assert.Equal(t, http.StatusOK, ok.StatusCode)
			})
		}
	}
}

// Logout revokes and clears the cookie.
func TestHandler_Logout_RevokesCookieToken(t *testing.T) {
	srv, u := mkAuthServerWithRefresh(t)
	token := loginCookie(t, srv, u.Email)

	res := cookieCall(t, srv, "/auth/logout", token, nil)
	defer res.Body.Close()
	require.Equal(t, http.StatusNoContent, res.StatusCode)
	assertCleared(t, res)

	after := cookieCall(t, srv, "/auth/refresh", token, nil)
	defer after.Body.Close()
	assert.Equal(t, http.StatusUnauthorized, after.StatusCode)
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
	h := newHandler(svc)

	bypass := func(next http.Handler) http.Handler { return next }

	r := chi.NewRouter()
	r.Mount("/auth", auth.Routes(h, bypass))
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	res, err := srv.Client().Get(srv.URL + "/auth/me")
	require.NoError(t, err)
	defer res.Body.Close()
	assert.Equal(t, http.StatusUnauthorized, res.StatusCode)
	assert.Equal(t, "Anda belum masuk. Silakan masuk terlebih dahulu.", problemDetail(t, res))
}

func TestHandler_Login_DBError(t *testing.T) {
	repo := users.NewRepo(testutil.FakeExec{}, testutil.Store(t))
	svc := auth.NewService(repo, testSecret, time.Hour)
	h := newHandler(svc)

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
	h := newHandler(svc)

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
	h := newHandler(svc)

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
	assert.Equal(t, "Sesi Anda tidak berlaku lagi. Silakan masuk kembali.", problemDetail(t, res))
}

// problemDetail decodes the problem+json detail.
func problemDetail(t *testing.T, res *http.Response) string {
	t.Helper()
	var p struct {
		Detail string `json:"detail"`
	}
	require.NoError(t, json.NewDecoder(res.Body).Decode(&p))
	return p.Detail
}
