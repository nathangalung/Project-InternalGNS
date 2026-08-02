package app

import (
	"net/http"
	"net/http/httptest"
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
	_, tx := testutil.BeginTx(t)
	return auth.NewService(users.NewRepo(tx, testutil.Store(t)), middlewareSecret, time.Hour)
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
	svc := mkSvc(t)
	now := time.Now()
	claims := auth.Claims{
		Role: users.RoleSuperadmin,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "internalgns-api",
			Subject:   "42",
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

	called := false
	mw := authMiddleware(svc)
	mw(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
		called = true
		assert.Equal(t, int64(42), deps.CurrentUserID(r.Context()))
	})).ServeHTTP(w, r)
	assert.True(t, called)
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
	svc := mkSvc(t)
	now := time.Now()
	claims := auth.Claims{
		Role: users.RoleSuperadmin,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "internalgns-api",
			Subject:   "7",
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
		},
	}
	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(middlewareSecret))
	require.NoError(t, err)

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
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			var budget time.Duration
			h := requestTimeout(short, long)(http.HandlerFunc(func(_ http.ResponseWriter, r *http.Request) {
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
