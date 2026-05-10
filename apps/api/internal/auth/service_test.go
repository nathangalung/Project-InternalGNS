package auth_test

import (
	"context"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/auth"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
	"github.com/nathangalung/internalgns/apps/api/internal/users"
)

const (
	seedUserID int64  = 1
	testSecret string = "test-secret-key-do-not-use"
)

func mkSvc(t *testing.T) *auth.Service {
	t.Helper()
	_, tx := testutil.BeginTx(t)
	return auth.NewService(users.NewRepo(tx, testutil.Store(t)), testSecret, time.Hour)
}

func mkUserAndSvc(t *testing.T) (*auth.Service, users.User) {
	t.Helper()
	ctx, tx := testutil.BeginTx(t)
	repo := users.NewRepo(tx, testutil.Store(t))
	u, err := repo.Create(ctx, users.CreateUserRequest{
		Email:    "auth-test@local",
		Name:     "Auth User",
		Password: "secret-pass",
		Role:     users.RoleOperational,
	}, seedUserID)
	require.NoError(t, err)
	return auth.NewService(repo, testSecret, time.Hour), u
}

func TestService_Login_Success(t *testing.T) {
	svc, u := mkUserAndSvc(t)

	resp, err := svc.Login(context.Background(), u.Email, "secret-pass")
	require.NoError(t, err)
	assert.NotEmpty(t, resp.Token)
	assert.Greater(t, resp.ExpiresAt, time.Now().Unix())
	assert.Equal(t, u.ID, resp.User.ID)
}

func TestService_Login_WrongPassword(t *testing.T) {
	svc, u := mkUserAndSvc(t)

	_, err := svc.Login(context.Background(), u.Email, "wrong-password")
	assert.ErrorIs(t, err, auth.ErrInvalidCredentials)
}

func TestService_Login_UserNotFound(t *testing.T) {
	svc := mkSvc(t)

	_, err := svc.Login(context.Background(), "missing@nowhere.local", "any")
	assert.ErrorIs(t, err, auth.ErrEmailNotRegistered)
}

func TestService_Login_DBError(t *testing.T) {
	repo := users.NewRepo(testutil.FakeExec{}, testutil.Store(t))
	svc := auth.NewService(repo, testSecret, time.Hour)
	_, err := svc.Login(context.Background(), "x@x", "any")
	assert.ErrorIs(t, err, testutil.ErrFake)
}

func TestService_Me_DBError(t *testing.T) {
	repo := users.NewRepo(testutil.FakeExec{}, testutil.Store(t))
	svc := auth.NewService(repo, testSecret, time.Hour)
	_, err := svc.Me(context.Background(), 1)
	assert.ErrorIs(t, err, testutil.ErrFake)
}

func TestService_Verify_GoodToken(t *testing.T) {
	svc, u := mkUserAndSvc(t)
	resp, err := svc.Login(context.Background(), u.Email, "secret-pass")
	require.NoError(t, err)

	claims, err := svc.Verify(resp.Token)
	require.NoError(t, err)
	assert.Equal(t, users.RoleOperational, claims.Role)

	id, err := claims.UserID()
	require.NoError(t, err)
	assert.Equal(t, u.ID, id)
}

func TestService_Verify_BadToken(t *testing.T) {
	svc := mkSvc(t)
	_, err := svc.Verify("not-a-real-token")
	assert.ErrorIs(t, err, auth.ErrInvalidToken)
}

func TestService_Verify_ExpiredToken(t *testing.T) {
	_, tx := testutil.BeginTx(t)
	repo := users.NewRepo(tx, testutil.Store(t))
	svc := auth.NewService(repo, testSecret, -time.Hour)

	ctx, txCreate := testutil.BeginTx(t)
	repoCreate := users.NewRepo(txCreate, testutil.Store(t))
	u, err := repoCreate.Create(ctx, users.CreateUserRequest{
		Email: "exp@local", Name: "Exp", Password: "p", Role: users.RoleFinance,
	}, seedUserID)
	require.NoError(t, err)
	_ = u

	now := time.Now().Add(-2 * time.Hour)
	claims := auth.Claims{
		Role: users.RoleFinance,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "internalgns-api",
			Subject:   "1",
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
		},
	}
	expired, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte(testSecret))
	require.NoError(t, err)

	_, err = svc.Verify(expired)
	assert.ErrorIs(t, err, auth.ErrInvalidToken)
}

func TestService_Verify_WrongSecret(t *testing.T) {
	svc := mkSvc(t)

	other := auth.NewService(nil, "different-secret", time.Hour)
	_ = other
	now := time.Now()
	claims := auth.Claims{
		Role: users.RoleSuperadmin,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "internalgns-api",
			Subject:   "1",
			IssuedAt:  jwt.NewNumericDate(now),
			NotBefore: jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
		},
	}
	bad, err := jwt.NewWithClaims(jwt.SigningMethodHS256, claims).SignedString([]byte("different-secret"))
	require.NoError(t, err)

	_, err = svc.Verify(bad)
	assert.ErrorIs(t, err, auth.ErrInvalidToken)
}

func TestService_Me(t *testing.T) {
	svc, u := mkUserAndSvc(t)
	got, err := svc.Me(context.Background(), u.ID)
	require.NoError(t, err)
	assert.Equal(t, u.ID, got.ID)
}

func TestClaims_UserID_Empty(t *testing.T) {
	c := auth.Claims{}
	_, err := c.UserID()
	assert.ErrorIs(t, err, auth.ErrInvalidToken)
}

func TestClaims_UserID_NonNumeric(t *testing.T) {
	c := auth.Claims{RegisteredClaims: jwt.RegisteredClaims{Subject: "abc"}}
	_, err := c.UserID()
	assert.ErrorIs(t, err, auth.ErrInvalidToken)
}

func TestClaims_UserID_Numeric(t *testing.T) {
	c := auth.Claims{RegisteredClaims: jwt.RegisteredClaims{Subject: "42"}}
	id, err := c.UserID()
	require.NoError(t, err)
	assert.Equal(t, int64(42), id)
}
