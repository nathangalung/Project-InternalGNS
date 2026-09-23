package auth_test

import (
	"bytes"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/go-chi/chi/v5"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/auth"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
	"github.com/nathangalung/internalgns/apps/api/internal/users"
)

// D17: a hard lock let anyone lock a known superadmin address out on
// purpose. Guessing is throttled instead, and the right password still works.
func TestService_Login_ThrottledAccountStillAcceptsCorrectPassword(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := users.NewRepo(tx, testutil.Store(t))
	email := uniqueEmail(t)
	_, err := repo.Create(ctx, users.CreateUserRequest{
		Email: email, Name: "x", Password: "Right-pw1!", Role: users.RoleOperational,
	}, 1)
	require.NoError(t, err)

	svc := auth.NewService(repo, "test-secret-please-change", time.Minute)
	for i := 0; i < 5; i++ {
		_, err = svc.Login(ctx, email, "Wrong-pw1!")
		assert.ErrorIs(t, err, auth.ErrInvalidCredentials)
	}

	resp, err := svc.Login(ctx, email, "Right-pw1!")
	require.NoError(t, err)
	assert.NotEmpty(t, resp.Token)

	st, err := repo.LockStatus(ctx, email)
	require.NoError(t, err)
	assert.Equal(t, 0, st.FailedLoginAttempts)
	assert.Nil(t, st.LockedUntil)
}

// A throttled account answers the same 401 a wrong password does, so the
// response never tells an attacker which addresses are under attack.
func TestHandler_Login_ThrottledAccountAnswersUnauthorized(t *testing.T) {
	_, u, svc := mkAuthServer(t)
	// Mounted without the per-IP limiter, whose own 429 would mask the
	// verdict this test is about after five attempts.
	r := chi.NewRouter()
	r.Post("/auth/login", auth.NewHandler(svc).Login)
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	for i := 0; i < 7; i++ {
		res := postLogin(t, srv.URL, u.Email, "Wrong-pw1!")
		res.Body.Close()
		assert.Equal(t, http.StatusUnauthorized, res.StatusCode, "attempt %d", i+1)
	}
}

// AU-8: an admin password reset must unstick a throttled account.
func TestRepo_UpdatePassword_ClearsThrottle(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := users.NewRepo(tx, testutil.Store(t))
	email := uniqueEmail(t)
	u, err := repo.Create(ctx, users.CreateUserRequest{
		Email: email, Name: "x", Password: "Right-pw1!", Role: users.RoleOperational,
	}, 1)
	require.NoError(t, err)

	svc := auth.NewService(repo, "test-secret-please-change", time.Minute)
	for i := 0; i < 5; i++ {
		_, _ = svc.Login(ctx, email, "Wrong-pw1!")
	}

	require.NoError(t, repo.UpdatePassword(ctx, u.ID, "Reset-pw1!", 1))

	st, err := repo.LockStatus(ctx, email)
	require.NoError(t, err)
	assert.Equal(t, 0, st.FailedLoginAttempts)
	assert.Nil(t, st.LockedUntil)
}

// postLogin posts a login body.
func postLogin(t *testing.T, base, email, password string) *http.Response {
	t.Helper()
	body, err := json.Marshal(auth.LoginRequest{Email: email, Password: password})
	require.NoError(t, err)
	res, err := http.Post(base+"/auth/login", "application/json", bytes.NewReader(body))
	require.NoError(t, err)
	return res
}
