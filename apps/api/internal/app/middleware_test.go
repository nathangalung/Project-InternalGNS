package app

import (
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"strconv"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/auth"
	"github.com/nathangalung/internalgns/apps/api/internal/shared/deps"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
	"github.com/nathangalung/internalgns/apps/api/internal/users"
)

const middlewareSecret = "middleware-test-secret"

func mkSvc(t *testing.T) *auth.Service {
	t.Helper()
	svc, _, _ := mkSvcWithRepo(t)
	return svc
}

// mkSvcWithRepo exposes the repo so a test can create the account its token
// names; the middleware now reads live account state per request.
func mkSvcWithRepo(t *testing.T) (*auth.Service, *users.Repo, context.Context) {
	t.Helper()
	ctx, tx := testutil.BeginTx(t)
	repo := users.NewRepo(tx, testutil.Store(t))
	return auth.NewService(repo, middlewareSecret, time.Hour), repo, ctx
}

// mkMiddlewareUser creates an account for a middleware test.
func mkMiddlewareUser(t *testing.T, ctx context.Context, repo *users.Repo, role users.Role) users.User {
	t.Helper()
	u, err := repo.Create(ctx, users.CreateUserRequest{
		Email:    fmt.Sprintf("mw-%s-%d@test", t.Name(), time.Now().UnixNano()),
		Name:     "Middleware",
		Password: "Middle-pw1!",
		Role:     role,
	}, 1)
	require.NoError(t, err)
	return u
}

// mkToken signs a token for a subject.
func mkToken(t *testing.T, subject string) string {
	t.Helper()
	now := time.Now()
	claims := auth.Claims{
		Role: users.RoleSuperadmin,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "internalgns-api",
			Subject:   subject,
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
		},
	}
	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(middlewareSecret))
	require.NoError(t, err)
	return signed
}

func protectedHandler(t *testing.T, svc *auth.Service) http.Handler {
	t.Helper()
	mw := authMiddleware(svc)
	return mw(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		id := deps.CurrentUserID(r.Context())
		assert.Greater(t, id, int64(0))
		w.WriteHeader(http.StatusOK)
	}))
}

func TestAuthMiddleware_NoHeader(t *testing.T) {
	svc := mkSvc(t)
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	w := httptest.NewRecorder()
	mw := authMiddleware(svc)
	mw(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})).ServeHTTP(w, r)
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestAuthMiddleware_NoBearerPrefix(t *testing.T) {
	svc := mkSvc(t)
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.Header.Set("Authorization", "NotBearer xxx")
	w := httptest.NewRecorder()
	mw := authMiddleware(svc)
	mw(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})).ServeHTTP(w, r)
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestAuthMiddleware_EmptyToken(t *testing.T) {
	svc := mkSvc(t)
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.Header.Set("Authorization", "Bearer ")
	w := httptest.NewRecorder()
	mw := authMiddleware(svc)
	mw(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})).ServeHTTP(w, r)
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestAuthMiddleware_InvalidToken(t *testing.T) {
	svc := mkSvc(t)
	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.Header.Set("Authorization", "Bearer not-a-jwt")
	w := httptest.NewRecorder()
	mw := authMiddleware(svc)
	mw(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})).ServeHTTP(w, r)
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestAuthMiddleware_BadSubject(t *testing.T) {
	svc := mkSvc(t)
	now := time.Now()
	claims := auth.Claims{
		Role: users.RoleSuperadmin,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "internalgns-api",
			Subject:   "not-a-number",
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
		},
	}
	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(middlewareSecret))
	require.NoError(t, err)

	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.Header.Set("Authorization", "Bearer "+signed)
	w := httptest.NewRecorder()
	mw := authMiddleware(svc)
	mw(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})).ServeHTTP(w, r)
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestAuthMiddleware_HappyPath(t *testing.T) {
	svc, repo, ctx := mkSvcWithRepo(t)
	u := mkMiddlewareUser(t, ctx, repo, users.RoleSuperadmin)
	signed := mkToken(t, strconv.FormatInt(u.ID, 10))

	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.Header.Set("Authorization", "Bearer "+signed)
	w := httptest.NewRecorder()

	called := false
	mw := authMiddleware(svc)
	mw(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		called = true
		assert.Equal(t, u.ID, deps.CurrentUserID(r.Context()))
	})).ServeHTTP(w, r)
	assert.True(t, called)
}

// A structurally valid token must not outlive the account state behind it.
func TestAuthMiddleware_LiveAccountState(t *testing.T) {
	tests := []struct {
		name     string
		mutate   func(t *testing.T, ctx context.Context, repo *users.Repo, u users.User)
		wantCode int
		wantRole string
	}{
		{
			name:     "active user passes with its stored role",
			mutate:   func(*testing.T, context.Context, *users.Repo, users.User) {},
			wantCode: http.StatusOK,
			wantRole: string(users.RoleOperational),
		},
		{
			name: "deactivated user is refused at once",
			mutate: func(t *testing.T, ctx context.Context, repo *users.Repo, u users.User) {
				_, err := repo.Update(ctx, u.ID, users.UpdateUserRequest{
					Email: u.Email, Name: u.Name, Role: u.Role, IsActive: false,
				}, 1)
				require.NoError(t, err)
			},
			wantCode: http.StatusUnauthorized,
		},
		{
			name: "role change reaches the live token",
			mutate: func(t *testing.T, ctx context.Context, repo *users.Repo, u users.User) {
				_, err := repo.Update(ctx, u.ID, users.UpdateUserRequest{
					Email: u.Email, Name: u.Name, Role: users.RoleFinance, IsActive: true,
				}, 1)
				require.NoError(t, err)
			},
			wantCode: http.StatusOK,
			wantRole: string(users.RoleFinance),
		},
		{
			name: "password reset ends the token",
			mutate: func(t *testing.T, ctx context.Context, repo *users.Repo, u users.User) {
				require.NoError(t, repo.UpdatePassword(ctx, u.ID, "Another-pw1!", 1))
			},
			wantCode: http.StatusUnauthorized,
		},
	}

	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			svc, repo, ctx := mkSvcWithRepo(t)
			u := mkMiddlewareUser(t, ctx, repo, users.RoleOperational)
			signed := mkToken(t, strconv.FormatInt(u.ID, 10))
			tc.mutate(t, ctx, repo, u)

			r := httptest.NewRequest(http.MethodGet, "/", nil)
			r.Header.Set("Authorization", "Bearer "+signed)
			w := httptest.NewRecorder()
			gotRole := ""
			authMiddleware(svc)(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
				gotRole = deps.CurrentUserRole(r.Context())
				w.WriteHeader(http.StatusOK)
			})).ServeHTTP(w, r)

			assert.Equal(t, tc.wantCode, w.Code)
			assert.Equal(t, tc.wantRole, gotRole)
		})
	}
}

func TestAuthMiddleware_ExpiredToken(t *testing.T) {
	svc := mkSvc(t)
	past := time.Now().Add(-2 * time.Hour)
	claims := auth.Claims{
		Role: users.RoleSuperadmin,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "internalgns-api",
			Subject:   "1",
			IssuedAt:  jwt.NewNumericDate(past),
			NotBefore: jwt.NewNumericDate(past),
			ExpiresAt: jwt.NewNumericDate(past.Add(time.Hour)),
		},
	}
	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(middlewareSecret))
	require.NoError(t, err)

	r := httptest.NewRequest(http.MethodGet, "/", nil)
	r.Header.Set("Authorization", "Bearer "+signed)
	w := httptest.NewRecorder()
	mw := authMiddleware(svc)
	mw(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})).ServeHTTP(w, r)
	assert.Equal(t, http.StatusUnauthorized, w.Code)
}

func TestAuthMiddleware_PreservesProtectedHandler(t *testing.T) {
	svc, repo, ctx := mkSvcWithRepo(t)
	u := mkMiddlewareUser(t, ctx, repo, users.RoleSuperadmin)
	signed := mkToken(t, strconv.FormatInt(u.ID, 10))

	srv := httptest.NewServer(protectedHandler(t, svc))
	defer srv.Close()

	req, _ := http.NewRequest(http.MethodGet, srv.URL, nil)
	req.Header.Set("Authorization", "Bearer "+signed)
	res, err := srv.Client().Do(req)
	require.NoError(t, err)
	defer res.Body.Close()
	assert.Equal(t, http.StatusOK, res.StatusCode)
}

func TestAuthorizeBucket(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	guarded := authorizeBucket(next)

	cases := []struct {
		role, bucket string
		want         int
	}{
		{"finance", "invoice-attachments", http.StatusOK},
		{"operational", "invoice-attachments", http.StatusForbidden},
		{"operational", "po-docs", http.StatusOK},
		{"finance", "po-docs", http.StatusForbidden},
		{"operational", "client-logos", http.StatusOK},
		{"operational", "", http.StatusForbidden},
	}
	for _, c := range cases {
		req := httptest.NewRequest(http.MethodGet, "/storage/object?bucket="+c.bucket, nil)
		req = req.WithContext(deps.WithUserRole(req.Context(), c.role))
		rec := httptest.NewRecorder()
		guarded.ServeHTTP(rec, req)
		if rec.Code != c.want {
			t.Errorf("role %q bucket %q: got %d want %d", c.role, c.bucket, rec.Code, c.want)
		}
	}
}

func TestSecurityHeaders(t *testing.T) {
	next := http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		w.WriteHeader(http.StatusOK)
	})
	rec := httptest.NewRecorder()
	securityHeadersMiddleware(next).ServeHTTP(rec, httptest.NewRequest(http.MethodGet, "/", nil))
	assert.Equal(t, "nosniff", rec.Header().Get("X-Content-Type-Options"))
	assert.Equal(t, "DENY", rec.Header().Get("X-Frame-Options"))
	assert.Contains(t, rec.Header().Get("Content-Security-Policy"), "default-src 'none'")
}

// Render routes get the long budget, everything else the default.
func TestRequestTimeout_BudgetPerPath(t *testing.T) {
	const short, long = 50 * time.Millisecond, time.Hour

	tests := []struct {
		name     string
		path     string
		wantLong bool
	}{
		{"list", "/api/v1/invoices", false},
		{"single xml", "/api/v1/invoices/1/coretax.xml", false},
		{"list export", "/api/v1/invoices/export.xlsx", true},
		{"coretax export", "/api/v1/invoices/coretax.xlsx", true},
		{"invoice pdf", "/api/v1/invoices/1/pdf", true},
		{"delivery note", "/api/v1/purchase-orders/1/delivery-note.pdf", true},
		{"storage object", "/api/v1/storage/object", true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var budget time.Duration
			h := requestTimeout(short, long, long)(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
				deadline, ok := r.Context().Deadline()
				require.True(t, ok)
				budget = time.Until(deadline)
			}))
			h.ServeHTTP(httptest.NewRecorder(), httptest.NewRequest(http.MethodGet, tc.path, nil))

			if tc.wantLong {
				assert.Greater(t, budget, short)
			} else {
				assert.LessOrEqual(t, budget, short)
			}
		})
	}
}

// A slow asset upload must outlive the server ReadTimeout that guards every
// other route. The handler context budget alone cannot do this: ReadTimeout
// covers reading the body, so it fires first and severs the connection.
func TestRequestTimeout_StorageRouteExtendsReadDeadline(t *testing.T) {
	const readTimeout = 300 * time.Millisecond
	const stall = 900 * time.Millisecond

	tests := []struct {
		name    string
		path    string
		wantErr bool
	}{
		{"storage upload survives", "/api/v1/storage/object", false},
		{"other route keeps ReadTimeout", "/api/v1/clients/1/logo", true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			h := requestTimeout(time.Minute, time.Minute, time.Minute)(
				http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
					if _, err := io.ReadAll(r.Body); err != nil {
						http.Error(w, err.Error(), http.StatusRequestTimeout)
						return
					}
					w.WriteHeader(http.StatusNoContent)
				}))
			// accessLogMiddleware wraps the writer, so the controller has to
			// unwrap past it to reach the connection.
			srv := httptest.NewUnstartedServer(accessLogMiddleware(h))
			srv.Config.ReadTimeout = readTimeout
			srv.Start()
			t.Cleanup(srv.Close)

			pr, pw := io.Pipe()
			go func() {
				_, _ = pw.Write([]byte("first"))
				time.Sleep(stall)
				_, _ = pw.Write([]byte("second"))
				_ = pw.Close()
			}()

			req, err := http.NewRequest(http.MethodPut, srv.URL+tc.path, pr)
			require.NoError(t, err)
			res, err := srv.Client().Do(req)
			if tc.wantErr {
				if err == nil {
					defer res.Body.Close()
					assert.NotEqual(t, http.StatusNoContent, res.StatusCode)
				}
				return
			}
			require.NoError(t, err)
			defer res.Body.Close()
			assert.Equal(t, http.StatusNoContent, res.StatusCode)
		})
	}
}

// Every 401 detail reaches the toast, so it reads as Indonesian.
func TestAuthMiddleware_UnauthorizedDetailIsIndonesian(t *testing.T) {
	svc := mkSvc(t)
	tests := []struct {
		name   string
		header string
		want   string
	}{
		{"no header", "", "Anda belum masuk. Silakan masuk terlebih dahulu."},
		{"not a jwt", "Bearer not-a-jwt", "Token akses tidak valid atau sudah kedaluwarsa. Silakan masuk kembali."},
		{"account gone", "Bearer " + mkToken(t, "99999999"), "Sesi Anda tidak berlaku lagi. Silakan masuk kembali."},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			r := httptest.NewRequest(http.MethodGet, "/", nil)
			if tc.header != "" {
				r.Header.Set("Authorization", tc.header)
			}
			w := httptest.NewRecorder()
			authMiddleware(svc)(http.HandlerFunc(func(http.ResponseWriter, *http.Request) {})).ServeHTTP(w, r)
			require.Equal(t, http.StatusUnauthorized, w.Code)
			var p struct {
				Detail string `json:"detail"`
			}
			require.NoError(t, json.NewDecoder(w.Body).Decode(&p))
			assert.Equal(t, tc.want, p.Detail)
		})
	}
}
