package auth_test

import (
	"context"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/auth"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
	"github.com/nathangalung/internalgns/apps/api/internal/users"
)

// Serialize against acceptance suites on shared DB.
func TestMain(m *testing.M) {
	release := testutil.LockProcessForTests()
	code := m.Run()
	release()
	os.Exit(code)
}

// Full login cycle against real DB: create user via users.Repo, hit
// auth.Service.Login, then verify the issued JWT and Me lookup.
func TestService_LoginCycle_IntegratesUsersRepo(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := users.NewRepo(tx, testutil.Store(t))

	email := uniqueEmail(t)
	created, err := repo.Create(ctx, users.CreateUserRequest{
		Email:    email,
		Name:     "Auth IT",
		Password: "Sup3rSecret!",
		Role:     users.RoleOperational,
	}, 1)
	require.NoError(t, err)

	svc := auth.NewService(repo, "test-secret-please-change", time.Hour)

	resp, err := svc.Login(ctx, email, "Sup3rSecret!")
	require.NoError(t, err)
	require.NotEmpty(t, resp.Token)
	assert.Equal(t, created.ID, resp.User.ID)
	assert.WithinDuration(t, time.Now().Add(time.Hour), time.Unix(resp.ExpiresAt, 0), 5*time.Second)

	claims, err := svc.Verify(resp.Token)
	require.NoError(t, err)
	uid, err := claims.UserID()
	require.NoError(t, err)
	assert.Equal(t, created.ID, uid)

	me, err := svc.Me(ctx, uid)
	require.NoError(t, err)
	// Stored case-folded; login still matches the mixed-case input above.
	assert.Equal(t, strings.ToLower(email), me.Email)
}

func TestService_Login_WrongPassword_RealDB(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := users.NewRepo(tx, testutil.Store(t))
	email := uniqueEmail(t)
	_, err := repo.Create(ctx, users.CreateUserRequest{
		Email: email, Name: "x", Password: "right-pw", Role: users.RoleOperational,
	}, 1)
	require.NoError(t, err)

	svc := auth.NewService(repo, "s", time.Minute)
	_, err = svc.Login(ctx, email, "wrong-pw")
	assert.ErrorIs(t, err, auth.ErrInvalidCredentials)
}

func TestService_Login_UnknownEmail_RealDB(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := users.NewRepo(tx, testutil.Store(t))

	svc := auth.NewService(repo, "s", time.Minute)
	_, err := svc.Login(ctx, "nobody@example.test", "anything")
	assert.ErrorIs(t, err, auth.ErrInvalidCredentials)
}

func TestService_Login_LocksAfterFiveFailures_RealDB(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := users.NewRepo(tx, testutil.Store(t))
	email := uniqueEmail(t)
	_, err := repo.Create(ctx, users.CreateUserRequest{
		Email: email, Name: "x", Password: "right-pw", Role: users.RoleOperational,
	}, 1)
	require.NoError(t, err)

	svc := auth.NewService(repo, "test-secret-please-change", time.Minute)

	for i := 0; i < 5; i++ {
		_, err = svc.Login(ctx, email, "wrong-pw")
		assert.ErrorIs(t, err, auth.ErrInvalidCredentials)
	}

	// Locked now: even the correct password is refused.
	_, err = svc.Login(ctx, email, "right-pw")
	assert.ErrorIs(t, err, auth.ErrAccountLocked)

	st, err := repo.LockStatus(ctx, email)
	require.NoError(t, err)
	require.NotNil(t, st.LockedUntil)
	assert.True(t, st.LockedUntil.After(time.Now()))
}

// An elapsed lockout must start a fresh window instead of re-locking on the
// first later miss, otherwise one wrong password every 15 minutes holds the
// account out forever.
func TestService_Login_ExpiredLockout_StartsFreshWindow_RealDB(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := users.NewRepo(tx, testutil.Store(t))
	email := uniqueEmail(t)
	_, err := repo.Create(ctx, users.CreateUserRequest{
		Email: email, Name: "x", Password: "right-pw", Role: users.RoleOperational,
	}, 1)
	require.NoError(t, err)

	svc := auth.NewService(repo, "test-secret-please-change", time.Minute)

	for i := 0; i < 5; i++ {
		_, _ = svc.Login(ctx, email, "wrong-pw")
	}
	expireLockout(ctx, t, tx, email)

	// One more miss inside the elapsed window: counts as the first of a new
	// window, so it must not lock again.
	_, err = svc.Login(ctx, email, "wrong-pw")
	assert.ErrorIs(t, err, auth.ErrInvalidCredentials)

	st, err := repo.LockStatus(ctx, email)
	require.NoError(t, err)
	assert.Equal(t, 1, st.FailedLoginAttempts)
	assert.Nil(t, st.LockedUntil)
}

// The fresh window must still lock once it reaches five misses of its own.
func TestService_Login_FreshWindowAfterExpiry_LocksAgain_RealDB(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := users.NewRepo(tx, testutil.Store(t))
	email := uniqueEmail(t)
	_, err := repo.Create(ctx, users.CreateUserRequest{
		Email: email, Name: "x", Password: "right-pw", Role: users.RoleOperational,
	}, 1)
	require.NoError(t, err)

	svc := auth.NewService(repo, "test-secret-please-change", time.Minute)

	for i := 0; i < 5; i++ {
		_, _ = svc.Login(ctx, email, "wrong-pw")
	}
	expireLockout(ctx, t, tx, email)

	for i := 0; i < 5; i++ {
		_, _ = svc.Login(ctx, email, "wrong-pw")
	}

	st, err := repo.LockStatus(ctx, email)
	require.NoError(t, err)
	assert.Equal(t, 5, st.FailedLoginAttempts)
	require.NotNil(t, st.LockedUntil)
	assert.True(t, st.LockedUntil.After(time.Now()))

	_, err = svc.Login(ctx, email, "right-pw")
	assert.ErrorIs(t, err, auth.ErrAccountLocked)
}

// After the lockout elapses the right password must work again and wipe the
// counter, even once a miss has opened a new window.
func TestService_Login_SuccessAfterExpiredLockout_ClearsCounter_RealDB(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := users.NewRepo(tx, testutil.Store(t))
	email := uniqueEmail(t)
	_, err := repo.Create(ctx, users.CreateUserRequest{
		Email: email, Name: "x", Password: "right-pw", Role: users.RoleOperational,
	}, 1)
	require.NoError(t, err)

	svc := auth.NewService(repo, "test-secret-please-change", time.Minute)

	for i := 0; i < 5; i++ {
		_, _ = svc.Login(ctx, email, "wrong-pw")
	}
	expireLockout(ctx, t, tx, email)
	_, _ = svc.Login(ctx, email, "wrong-pw")

	_, err = svc.Login(ctx, email, "right-pw")
	require.NoError(t, err)

	st, err := repo.LockStatus(ctx, email)
	require.NoError(t, err)
	assert.Equal(t, 0, st.FailedLoginAttempts)
	assert.Nil(t, st.LockedUntil)
}

// Backdates an active lockout so the window reads as elapsed. Wall-clock
// waiting is not an option and now() is frozen per transaction.
func expireLockout(ctx context.Context, t *testing.T, tx pgx.Tx, email string) {
	t.Helper()
	_, err := tx.Exec(ctx,
		`UPDATE users SET locked_until = now() - interval '1 hour'
		  WHERE LOWER(email) = LOWER($1)`, email)
	require.NoError(t, err)
}

func TestService_Login_SuccessResetsAttempts_RealDB(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := users.NewRepo(tx, testutil.Store(t))
	email := uniqueEmail(t)
	_, err := repo.Create(ctx, users.CreateUserRequest{
		Email: email, Name: "x", Password: "right-pw", Role: users.RoleOperational,
	}, 1)
	require.NoError(t, err)

	svc := auth.NewService(repo, "test-secret-please-change", time.Minute)

	for i := 0; i < 3; i++ {
		_, _ = svc.Login(ctx, email, "wrong-pw")
	}
	_, err = svc.Login(ctx, email, "right-pw")
	require.NoError(t, err)

	st, err := repo.LockStatus(ctx, email)
	require.NoError(t, err)
	assert.Equal(t, 0, st.FailedLoginAttempts)
	assert.Nil(t, st.LockedUntil)
}

// uniqueEmail keeps tests in the same process from colliding on the unique
// email index even though each test runs in its own rolled-back tx.
func uniqueEmail(t *testing.T) string {
	t.Helper()
	return "auth-it-" + t.Name() + "-" + time.Now().UTC().Format("150405.000000") + "@test"
}
