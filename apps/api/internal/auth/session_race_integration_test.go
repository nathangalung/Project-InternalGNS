package auth_test

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"

	"github.com/nathangalung/internalgns/apps/api/internal/auth"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
	"github.com/nathangalung/internalgns/apps/api/internal/users"
)

const racePassword = "Lama-pw1!"

// committedUser creates a user outside any test transaction, since the
// race needs a second connection to see it.
func committedUser(t *testing.T) (*auth.Service, users.User) {
	t.Helper()
	testutil.RequireDB(t)
	pool := testutil.Pool(t)
	store := testutil.Store(t)
	repo := users.NewRepo(pool, store)
	u, err := repo.Create(context.Background(), users.CreateUserRequest{
		Email: uniqueEmail(t), Name: "Race", Password: racePassword, Role: users.RoleOperational,
	}, 1)
	require.NoError(t, err)
	t.Cleanup(func() {
		ctx := context.Background()
		_, _ = pool.Exec(ctx, `DELETE FROM refresh_tokens WHERE user_id = $1`, u.ID)
		_, _ = pool.Exec(ctx, `DELETE FROM users WHERE id = $1`, u.ID)
	})
	svc := auth.NewService(repo, "session-race-secret", time.Hour).
		WithRefresh(auth.NewRefreshRepo(pool, store), 24*time.Hour)
	return svc, u
}

// holdUserRow opens a password change that has not reached its writes yet.
func holdUserRow(t *testing.T, id int64) pgx.Tx {
	t.Helper()
	tx, err := testutil.Pool(t).Begin(context.Background())
	require.NoError(t, err)
	t.Cleanup(func() { _ = tx.Rollback(context.Background()) })
	_, err = tx.Exec(context.Background(), `UPDATE users SET updated_at = updated_at WHERE id = $1`, id)
	require.NoError(t, err)
	return tx
}

// finishReset runs the reset's writes on the held transaction and commits.
func finishReset(t *testing.T, tx pgx.Tx, id int64) {
	t.Helper()
	ctx := context.Background()
	store := testutil.Store(t)
	hash, err := bcrypt.GenerateFromPassword([]byte("Baru-pw2@"), bcrypt.MinCost)
	require.NoError(t, err)
	_, err = tx.Exec(ctx, store.Get("users.update_password"), string(hash), int64(1), id)
	require.NoError(t, err)
	_, err = tx.Exec(ctx, store.Get("auth.refresh_revoke_user"), id, "admin")
	require.NoError(t, err)
	require.NoError(t, tx.Commit(ctx))
}

func activeRefreshTokens(t *testing.T, id int64) int {
	t.Helper()
	var n int
	require.NoError(t, testutil.Pool(t).QueryRow(context.Background(),
		`SELECT COUNT(*) FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL`, id).Scan(&n))
	return n
}

// requireStillBlocked fails when the call finished while the reset was open.
func requireStillBlocked(t *testing.T, done <-chan struct{}) {
	t.Helper()
	select {
	case <-done:
		t.Fatal("the call finished while a password change on the account was in flight")
	case <-time.After(500 * time.Millisecond):
	}
}

// Decision (2): a refresh racing a reset must not mint a session the reset
// never saw. It waits for the reset, then finds its token revoked.
func TestService_Refresh_CannotOutliveAConcurrentReset(t *testing.T) {
	svc, u := committedUser(t)
	sess, err := svc.Login(context.Background(), u.Email, racePassword)
	require.NoError(t, err)

	holder := holdUserRow(t, u.ID)
	done := make(chan struct{})
	var refreshErr error
	go func() {
		defer close(done)
		_, refreshErr = svc.Refresh(context.Background(), sess.RefreshToken)
	}()

	requireStillBlocked(t, done)
	finishReset(t, holder, u.ID)
	<-done

	assert.ErrorIs(t, refreshErr, auth.ErrRevokedRefresh)
	assert.Equal(t, 0, activeRefreshTokens(t, u.ID))
}

// A login with the old password racing a reset must not survive it.
func TestService_Login_CannotOutliveAConcurrentReset(t *testing.T) {
	svc, u := committedUser(t)

	holder := holdUserRow(t, u.ID)
	done := make(chan struct{})
	var loginErr error
	go func() {
		defer close(done)
		_, loginErr = svc.Login(context.Background(), u.Email, racePassword)
	}()

	requireStillBlocked(t, done)
	finishReset(t, holder, u.ID)
	<-done

	assert.ErrorIs(t, loginErr, auth.ErrInvalidCredentials)
	assert.Equal(t, 0, activeRefreshTokens(t, u.ID))
}

// Wait until holder blocks someone.
func waitBlockedOn(t *testing.T, holder pgx.Tx, done <-chan struct{}) {
	t.Helper()
	ctx := context.Background()
	var pid int
	require.NoError(t, holder.QueryRow(ctx, `SELECT pg_backend_pid()`).Scan(&pid))
	deadline := time.After(5 * time.Second)
	for {
		var waiting bool
		require.NoError(t, testutil.Pool(t).QueryRow(ctx,
			`SELECT EXISTS (SELECT 1 FROM pg_stat_activity WHERE $1 = ANY(pg_blocking_pids(pid)))`,
			pid).Scan(&waiting))
		if waiting {
			return
		}
		select {
		case <-done:
			t.Fatal("the call finished without waiting for the held account row")
		case <-deadline:
			t.Fatal("the call never blocked on the held account row")
		case <-time.After(10 * time.Millisecond):
		}
	}
}

// A reset beats self-service change.
// The change raced an admin reset and the hash it verified is gone, so it
// is refused and the reset stands.
func TestService_ChangeOwnPassword_CannotOverwriteAConcurrentReset(t *testing.T) {
	svc, u := committedUser(t)

	holder := holdUserRow(t, u.ID)
	done := make(chan struct{})
	var changeErr error
	go func() {
		defer close(done)
		changeErr = svc.ChangeOwnPassword(context.Background(), u.ID, racePassword, "Sendiri-pw3#")
	}()

	waitBlockedOn(t, holder, done)
	finishReset(t, holder, u.ID)
	<-done

	assert.ErrorIs(t, changeErr, auth.ErrPasswordChanged)
	_, err := svc.Login(context.Background(), u.Email, "Baru-pw2@")
	require.NoError(t, err, "the admin reset must stand")
	_, err = svc.Login(context.Background(), u.Email, "Sendiri-pw3#")
	assert.ErrorIs(t, err, auth.ErrInvalidCredentials)
}
