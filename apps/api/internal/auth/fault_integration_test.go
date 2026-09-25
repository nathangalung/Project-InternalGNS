package auth_test

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/db/queries"
	"github.com/nathangalung/internalgns/apps/api/internal/auth"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
	"github.com/nathangalung/internalgns/apps/api/internal/users"
)

const faultPassword = "Fault-pw1!"

// Typed failing query stand-ins.
var failingSQL = map[string]string{
	"users.get_by_id":            `SELECT 1 / 0 WHERE $1::bigint IS NOT NULL`,
	"users.lock_status":          `SELECT (1 / 0) AS failed_login_attempts, NULL::timestamptz AS locked_until WHERE $1::text IS NOT NULL`,
	"users.record_failed_login":  `SELECT 1 / 0 WHERE $1::text IS NOT NULL`,
	"users.reset_login_attempts": `SELECT 1 / 0 WHERE $1::bigint IS NOT NULL AND $2::text IS NOT NULL`,
	"auth.refresh_insert":        `SELECT 1 / 0 WHERE $1::bigint IS NOT NULL AND $2::bytea IS NOT NULL AND $3::timestamptz IS NOT NULL AND $4::integer IS NOT NULL`,
	"auth.refresh_lock_owner":    `SELECT 1 / 0 WHERE $1::bytea IS NOT NULL`,
	"auth.refresh_redeem":        `SELECT 1 / 0, 1 WHERE $1::bytea IS NOT NULL`,
	"auth.refresh_lookup":        `SELECT 1 / 0, TRUE, 'x', FALSE, FALSE WHERE $1::bytea IS NOT NULL AND $2::float8 IS NOT NULL`,
	"auth.refresh_revoke_user":   `SELECT 1 / 0 WHERE $1::bigint IS NOT NULL AND $2::text IS NOT NULL`,
	"auth.refresh_revoke_token":  `SELECT 1 / 0 WHERE $1::bytea IS NOT NULL`,
}

// noLockRow mimics a late deactivation.
const noLockRow = `SELECT 0 AS failed_login_attempts, NULL::timestamptz AS locked_until WHERE $1::text IS NULL`

// storeWith overrides real queries.
func storeWith(t *testing.T, overrides map[string]string) queries.Store {
	t.Helper()
	store := queries.Store{}
	for k, v := range testutil.Store(t) {
		store[k] = v
	}
	for k, v := range overrides {
		store[k] = v
	}
	return store
}

// failing swaps in failingSQL.
func failing(t *testing.T, keys ...string) queries.Store {
	t.Helper()
	o := map[string]string{}
	for _, k := range keys {
		sql, ok := failingSQL[k]
		require.True(t, ok, "no failing stand-in for %s", k)
		o[k] = sql
	}
	return storeWith(t, o)
}

// svcOn builds a refreshing service.
func svcOn(tx pgx.Tx, store queries.Store) *auth.Service {
	return auth.NewService(users.NewRepo(tx, store), "fault-secret", time.Hour).
		WithRefresh(auth.NewRefreshRepo(tx, store), 24*time.Hour)
}

// faultAccount creates a transactional account.
func faultAccount(t *testing.T) (context.Context, pgx.Tx, users.User) {
	t.Helper()
	ctx, tx := testutil.BeginTx(t)
	u, err := users.NewRepo(tx, testutil.Store(t)).Create(ctx, users.CreateUserRequest{
		Email: uniqueEmail(t), Name: "Fault", Password: faultPassword, Role: users.RoleOperational,
	}, 1)
	require.NoError(t, err)
	return ctx, tx, u
}

// requireDBFault expects division by zero.
func requireDBFault(t *testing.T, err error) {
	t.Helper()
	var pgErr *pgconn.PgError
	require.ErrorAs(t, err, &pgErr)
	assert.Equal(t, "22012", pgErr.Code)
}

func refreshTokenCount(t *testing.T, ctx context.Context, tx pgx.Tx, userID int64) int {
	t.Helper()
	var n int
	require.NoError(t, tx.QueryRow(ctx,
		`SELECT COUNT(*) FROM refresh_tokens WHERE user_id = $1`, userID).Scan(&n))
	return n
}

// Closed between reads: same verdict.
// An account deactivated after its row was read gets the neutral verdict,
// not an error that would tell it apart from a wrong password.
func TestService_Login_AccountClosedBetweenReads(t *testing.T) {
	ctx, tx, u := faultAccount(t)
	svc := svcOn(tx, storeWith(t, map[string]string{"users.lock_status": noLockRow}))

	_, err := svc.Login(ctx, u.Email, faultPassword)
	assert.ErrorIs(t, err, auth.ErrInvalidCredentials)
}

// Bookkeeping never overturns the verdict.
// A miss whose counter cannot be written is still the neutral 401, not a
// 500 that only failing accounts would see.
func TestService_Login_FailedBookkeepingKeepsVerdict(t *testing.T) {
	ctx, tx, u := faultAccount(t)
	svc := svcOn(tx, failing(t, "users.record_failed_login"))

	_, err := svc.Login(ctx, u.Email, "Salah-pw9!")
	assert.ErrorIs(t, err, auth.ErrInvalidCredentials)
}

// Storage failures are errors.
// Never a credential verdict, and no session is left behind.
func TestService_Login_StorageFailuresSurface(t *testing.T) {
	tests := []struct {
		name string
		key  string
		// outer fails outside login's transaction.
		// It reports a failure outside the login's own transaction, which
		// aborts the test transaction too.
		outer bool
	}{
		{"lock status", "users.lock_status", true},
		{"claim", "users.reset_login_attempts", false},
		{"refresh token insert", "auth.refresh_insert", false},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ctx, tx, u := faultAccount(t)
			resp, err := svcOn(tx, failing(t, tc.key)).Login(ctx, u.Email, faultPassword)
			requireDBFault(t, err)
			assert.NotErrorIs(t, err, auth.ErrInvalidCredentials)
			assert.Empty(t, resp.Token)
			if tc.outer {
				return
			}
			assert.Zero(t, refreshTokenCount(t, ctx, tx, u.ID))
			_, err = svcOn(tx, testutil.Store(t)).Login(ctx, u.Email, faultPassword)
			require.NoError(t, err, "the account must still sign in once storage recovers")
		})
	}
}

// Failed refresh keeps the token.
// Everything the refresh did rolls back, so the client can retry the same
// token once the database recovers instead of being signed out.
func TestService_Refresh_StorageFailureKeepsTheToken(t *testing.T) {
	for _, key := range []string{"auth.refresh_lock_owner", "auth.refresh_redeem", "users.get_by_id", "auth.refresh_insert"} {
		t.Run(key, func(t *testing.T) {
			ctx, tx, u := faultAccount(t)
			real := svcOn(tx, testutil.Store(t))
			sess, err := real.Login(ctx, u.Email, faultPassword)
			require.NoError(t, err)

			_, err = svcOn(tx, failing(t, key)).Refresh(ctx, sess.RefreshToken)
			requireDBFault(t, err)

			next, err := real.Refresh(ctx, sess.RefreshToken)
			require.NoError(t, err)
			assert.NotEqual(t, sess.RefreshToken, next.RefreshToken)
		})
	}
}

// Unexplained refusal surfaces.
func TestService_Refresh_RefusalLookupFailureSurfaces(t *testing.T) {
	ctx, tx, u := faultAccount(t)
	real := svcOn(tx, testutil.Store(t))
	sess, err := real.Login(ctx, u.Email, faultPassword)
	require.NoError(t, err)
	_, err = real.Refresh(ctx, sess.RefreshToken)
	require.NoError(t, err)

	_, err = svcOn(tx, failing(t, "auth.refresh_lookup")).Refresh(ctx, sess.RefreshToken)
	requireDBFault(t, err)
	assert.NotErrorIs(t, err, auth.ErrReusedRefresh)
}

// Failed replay blast ends nothing.
// The revocation of every session and the replay verdict are one unit, so
// a failed blast is an error and the live session is left as it was.
func TestService_Refresh_ReplayBlastFailureSurfaces(t *testing.T) {
	ctx, tx, u := faultAccount(t)
	real := svcOn(tx, testutil.Store(t))
	first, err := real.Login(ctx, u.Email, faultPassword)
	require.NoError(t, err)
	second, err := real.Refresh(ctx, first.RefreshToken)
	require.NoError(t, err)
	_, err = tx.Exec(ctx, `UPDATE refresh_tokens SET revoked_at = now() - interval '1 minute'
		WHERE user_id = $1 AND revoked_at IS NOT NULL`, u.ID)
	require.NoError(t, err)

	_, err = svcOn(tx, failing(t, "auth.refresh_revoke_user")).Refresh(ctx, first.RefreshToken)
	requireDBFault(t, err)

	_, err = real.Refresh(ctx, second.RefreshToken)
	assert.NoError(t, err, "the failed blast must not have revoked the live session")
}

// Inactive owner burns the token.
// An account switched off without the admin endpoint (a direct SQL fix)
// still has live tokens; presenting one is refused and consumes it, so
// reactivating the account does not revive the session.
func TestService_Refresh_InactiveOwnerBurnsTheToken(t *testing.T) {
	ctx, tx, u := faultAccount(t)
	svc := svcOn(tx, testutil.Store(t))
	sess, err := svc.Login(ctx, u.Email, faultPassword)
	require.NoError(t, err)

	_, err = tx.Exec(ctx, `UPDATE users SET is_active = FALSE WHERE id = $1`, u.ID)
	require.NoError(t, err)
	_, err = svc.Refresh(ctx, sess.RefreshToken)
	assert.ErrorIs(t, err, auth.ErrInvalidRefresh)

	_, err = tx.Exec(ctx, `UPDATE users SET is_active = TRUE WHERE id = $1`, u.ID)
	require.NoError(t, err)
	_, err = svc.Refresh(ctx, sess.RefreshToken)
	assert.ErrorIs(t, err, auth.ErrReusedRefresh)
}

// Logout surfaces a revoke failure.
func TestService_RevokeRefresh_StorageFailureSurfaces(t *testing.T) {
	ctx, tx, u := faultAccount(t)
	sess, err := svcOn(tx, testutil.Store(t)).Login(ctx, u.Email, faultPassword)
	require.NoError(t, err)

	err = svcOn(tx, failing(t, "auth.refresh_revoke_token")).RevokeRefresh(ctx, sess.RefreshToken)
	requireDBFault(t, err)
}

// Unstorable email is a 422.
// A NUL byte cannot reach the users table, so the lookup's SQLSTATE 22021
// must answer as a 422 on the unauthenticated login, not a 500.
func TestHandler_Login_NulEmailIsNotAServerError(t *testing.T) {
	srv := authServerOn(t, testutil.Store(t), nil)
	res := send(t, srv, http.MethodPost, "/auth/login", `{"email":"a\u0000b@test.local","password":"x"}`)
	defer res.Body.Close()
	assert.Equal(t, http.StatusUnprocessableEntity, res.StatusCode)
	assert.Equal(t, "application/problem+json", res.Header.Get("Content-Type"))
	assert.NotContains(t, problemDetail(t, res), "SQLSTATE")
}
