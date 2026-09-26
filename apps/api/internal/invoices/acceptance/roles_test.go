package acceptance_test

import (
	"context"
	"fmt"
	"net/http/httptest"
	"strconv"
	"sync"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"

	"github.com/nathangalung/internalgns/apps/api/internal/app"
	"github.com/nathangalung/internalgns/apps/api/internal/auth"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
	"github.com/nathangalung/internalgns/apps/api/internal/users"
)

const (
	roleTestSecret = "invoice-acceptance-role-secret"
	cancelReason   = "Salah alamat penagihan"
)

// roleUsers holds per-role accounts.
// Accounts and the real router are built once per suite, on first use, and
// the accounts are deleted by the suite cleaner.
type roleUsers struct {
	t       *testing.T
	cleaner *testutil.Cleaner
	mu      sync.Mutex
	ids     map[string]int64
	srv     *httptest.Server
}

func newRoleUsers(t *testing.T, cleaner *testutil.Cleaner) *roleUsers {
	return &roleUsers{t: t, cleaner: cleaner, ids: map[string]int64{}}
}

func (r *roleUsers) id(role string) (int64, error) {
	r.mu.Lock()
	defer r.mu.Unlock()
	if id, ok := r.ids[role]; ok {
		return id, nil
	}
	u, err := users.NewRepo(testutil.Pool(r.t), testutil.Store(r.t)).Create(context.Background(), users.CreateUserRequest{
		Email:    fmt.Sprintf("inv-accept-%s-%d@test.local", role, time.Now().UnixNano()),
		Name:     "Invoice acceptance " + role,
		Password: "Invoice-accept-pw1!",
		Role:     users.Role(role),
	}, defaultUserID)
	if err != nil {
		return 0, fmt.Errorf("create %s user: %w", role, err)
	}
	r.cleaner.User(u.ID)
	r.ids[role] = u.ID
	return u.ID, nil
}

func (r *roleUsers) server() *httptest.Server {
	r.mu.Lock()
	defer r.mu.Unlock()
	if r.srv != nil {
		return r.srv
	}
	router := app.NewRouter(app.Config{
		Env:                "test",
		HTTPAddr:           ":0",
		DatabaseURL:        "ignored",
		JWTSecret:          roleTestSecret,
		JWTExpiry:          time.Hour,
		CORSAllowedOrigins: []string{"http://localhost:5173"},
	}, testutil.Pool(r.t), testutil.Store(r.t), nil)
	r.srv = httptest.NewServer(router)
	r.t.Cleanup(r.srv.Close)
	return r.srv
}

// bearerFor mints a router token.
func bearerFor(t *testing.T, userID int64, role users.Role) string {
	t.Helper()
	now := time.Now()
	claims := auth.Claims{
		Role:           role,
		SessionVersion: 1,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "internalgns-api",
			Subject:   strconv.FormatInt(userID, 10),
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
		},
	}
	signed, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(roleTestSecret))
	if err != nil {
		t.Fatalf("sign token: %v", err)
	}
	return "Bearer " + signed
}
