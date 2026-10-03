package auth_test

import (
	"bytes"
	"context"
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
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
	"github.com/nathangalung/internalgns/apps/api/internal/users"
)

// Throttled accounts accept correct passwords.
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

// Throttling answers a plain 401.
// It is the same 401 a wrong password gets, so the response never tells an
// attacker which addresses are under attack.
func TestHandler_Login_ThrottledAccountAnswersUnauthorized(t *testing.T) {
	_, u, svc := mkAuthServer(t)
	// Mounted without the per-IP limiter, whose own 429 would mask the
	// verdict this test is about after five attempts.
	r := chi.NewRouter()
	r.Post("/auth/login", newHandler(svc).Login)
	srv := httptest.NewServer(r)
	t.Cleanup(srv.Close)

	for i := 0; i < 7; i++ {
		res := postLogin(t, srv.URL, u.Email, "Wrong-pw1!")
		res.Body.Close()
		assert.Equal(t, http.StatusUnauthorized, res.StatusCode, "attempt %d", i+1)
	}
}

// Password reset clears the throttle.
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

// Backoff never tells accounts apart.
// A registered, an unknown and a deactivated address pay the same delay
// after the same number of misses, so timing cannot confirm an account.
func TestService_Login_BackoffMatchesForUnknownAddresses(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := users.NewRepo(tx, testutil.Store(t))
	registered := "known-" + uniqueEmail(t)
	_, err := repo.Create(ctx, users.CreateUserRequest{
		Email: registered, Name: "x", Password: "Right-pw1!", Role: users.RoleOperational,
	}, 1)
	require.NoError(t, err)
	inactive := false
	deactivated := "closed-" + uniqueEmail(t)
	_, err = repo.Create(ctx, users.CreateUserRequest{
		Email: deactivated, Name: "x", Password: "Right-pw1!", Role: users.RoleOperational,
		IsActive: &inactive,
	}, 1)
	require.NoError(t, err)

	const attempts = 8
	delays := func(email string) []time.Duration {
		svc := auth.NewService(repo, "test-secret-please-change", time.Minute)
		got := recordWaits(svc)
		for range attempts {
			_, err := svc.Login(ctx, email, "Wrong-pw1!")
			require.ErrorIs(t, err, auth.ErrInvalidCredentials)
		}
		return *got
	}

	want := delays(registered)
	require.Len(t, want, attempts)
	assert.Equal(t, 250*time.Millisecond, want[5], "the sixth attempt pays the first delay")
	assert.Equal(t, want, delays("nobody-"+uniqueEmail(t)), "unknown address")
	assert.Equal(t, want, delays(deactivated), "deactivated address")
}

// Spelling never splits the tally.
// Five misses as one spelling and a sixth as another reach one count,
// account or not, so mixing spellings cannot open a timing gap.
func TestService_Login_BackoffIgnoresSpelling(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := users.NewRepo(tx, testutil.Store(t))
	account := func(prefix string) string {
		email := strings.ToLower(prefix + uniqueEmail(t))
		_, err := repo.Create(ctx, users.CreateUserRequest{
			Email: email, Name: "x", Password: "Right-pw1!", Role: users.RoleOperational,
		}, 1)
		require.NoError(t, err)
		return email
	}
	padded := func(s string) string { return " " + s + "\t" }

	tests := []struct {
		name     string
		email    string
		spelling func(string) string
	}{
		{"registered, padded", account("pad-"), padded},
		{"registered, upper case", account("upper-"), strings.ToUpper},
		{"unknown, padded", strings.ToLower("nobody-pad-" + uniqueEmail(t)), padded},
		{"unknown, upper case", strings.ToLower("nobody-upper-" + uniqueEmail(t)), strings.ToUpper},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			svc := auth.NewService(repo, "test-secret-please-change", time.Minute)
			got := recordWaits(svc)
			for _, email := range []string{tc.email, tc.email, tc.email, tc.email, tc.email, tc.spelling(tc.email)} {
				_, err := svc.Login(ctx, email, "Wrong-pw1!")
				require.ErrorIs(t, err, auth.ErrInvalidCredentials)
			}
			assert.Equal(t, []time.Duration{0, 0, 0, 0, 0, 250 * time.Millisecond}, *got)
		})
	}
}

// recordWaits captures each backoff wait.
func recordWaits(svc *auth.Service) *[]time.Duration {
	var got []time.Duration
	auth.SetThrottle(svc, func(_ context.Context, d time.Duration) { got = append(got, d) })
	return &got
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
