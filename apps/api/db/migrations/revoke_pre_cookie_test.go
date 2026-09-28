package migrations_test

import (
	"crypto/sha256"
	"fmt"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/auth"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
	"github.com/nathangalung/internalgns/apps/api/internal/users"
)

const revokeMigration = "00076_revoke_pre_cookie_refresh_tokens.sql"

// Pre-cookie refresh tokens die.
// A token issued before the migration is refused as revoked, not as a
// replay, so sessions started after the deploy survive it; a token already
// rotated keeps its reason.
func TestMigration00076_RevokesPreCookieRefreshTokens(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	store := testutil.Store(t)
	userRepo := users.NewRepo(tx, store)
	u, err := userRepo.Create(ctx, users.CreateUserRequest{
		Email:    fmt.Sprintf("m00076.%d@globalsakti.com", time.Now().UnixNano()),
		Name:     "Migrasi 00076",
		Password: "Sup3rSecret!",
		Role:     users.RoleOperational,
	}, 1)
	require.NoError(t, err)
	svc := auth.NewService(userRepo, "test-secret-please-change", time.Hour).
		WithRefresh(auth.NewRefreshRepo(tx, store), 24*time.Hour)

	rotated, err := svc.Login(ctx, u.Email, "Sup3rSecret!")
	require.NoError(t, err)
	pre, err := svc.Refresh(ctx, rotated.RefreshToken)
	require.NoError(t, err)

	_, err = tx.Exec(ctx, upSQL(t, revokeMigration))
	require.NoError(t, err)

	post, err := svc.Login(ctx, u.Email, "Sup3rSecret!")
	require.NoError(t, err)

	_, err = svc.Refresh(ctx, pre.RefreshToken)
	require.ErrorIs(t, err, auth.ErrRevokedRefresh)
	assert.NotErrorIs(t, err, auth.ErrReusedRefresh, "a migrated token is not a replay")

	_, err = svc.Refresh(ctx, post.RefreshToken)
	require.NoError(t, err, "a session started after the migration must survive")

	reason := func(raw string) string {
		t.Helper()
		sum := sha256.Sum256([]byte(raw))
		var r string
		require.NoError(t, tx.QueryRow(ctx,
			`SELECT revoked_reason FROM refresh_tokens WHERE token_hash = $1`, sum[:]).Scan(&r))
		return r
	}
	assert.Equal(t, "cookie_migration", reason(pre.RefreshToken))
	assert.Equal(t, "rotated", reason(rotated.RefreshToken))
}
