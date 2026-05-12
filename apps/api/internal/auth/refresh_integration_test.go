package auth_test

import (
	"context"
	"crypto/sha256"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/auth"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
	"github.com/nathangalung/internalgns/apps/api/internal/users"
)

func newRefreshSvc(t *testing.T, ttl time.Duration) (context.Context, *auth.Service, users.User) {
	t.Helper()
	ctx, tx := testutil.BeginTx(t)
	store := testutil.Store(t)
	userRepo := users.NewRepo(tx, store)

	created, err := userRepo.Create(ctx, users.CreateUserRequest{
		Email: uniqueEmail(t), Name: "Refresh IT",
		Password: "Sup3rSecret!", Role: users.RoleOperational,
	}, 1)
	require.NoError(t, err)

	svc := auth.NewService(userRepo, "test-secret-please-change", time.Hour).
		WithRefresh(auth.NewRefreshRepo(tx, store), ttl)
	return ctx, svc, created
}

// Login with WithRefresh issues both JWT + opaque refresh token.
func TestService_Login_IssuesRefreshToken(t *testing.T) {
	ctx, svc, u := newRefreshSvc(t, 24*time.Hour)

	resp, err := svc.Login(ctx, u.Email, "Sup3rSecret!")
	require.NoError(t, err)
	require.NotEmpty(t, resp.Token)
	require.NotEmpty(t, resp.RefreshToken)
	assert.WithinDuration(t, time.Now().Add(24*time.Hour), time.Unix(resp.RefreshExpiresAt, 0), 5*time.Second)
}

// Happy path: Refresh rotates the token (old != new, both usable in order).
func TestService_Refresh_HappyPathRotation(t *testing.T) {
	ctx, svc, u := newRefreshSvc(t, 24*time.Hour)

	first, err := svc.Login(ctx, u.Email, "Sup3rSecret!")
	require.NoError(t, err)

	second, err := svc.Refresh(ctx, first.RefreshToken)
	require.NoError(t, err)
	assert.NotEqual(t, first.RefreshToken, second.RefreshToken)
	assert.NotEmpty(t, second.Token)
	assert.Equal(t, first.User.ID, second.User.ID)
}

// Reuse detection: redeeming the same token twice yields ErrReusedRefresh
// and revokes any sibling tokens.
func TestService_Refresh_ReuseTriggersUserBlast(t *testing.T) {
	ctx, svc, u := newRefreshSvc(t, 24*time.Hour)

	first, err := svc.Login(ctx, u.Email, "Sup3rSecret!")
	require.NoError(t, err)
	rotated, err := svc.Refresh(ctx, first.RefreshToken)
	require.NoError(t, err)

	// Replay the original — must be flagged as reuse.
	_, err = svc.Refresh(ctx, first.RefreshToken)
	assert.ErrorIs(t, err, auth.ErrReusedRefresh)

	// The rotated (still-active) token must now also be revoked.
	_, err = svc.Refresh(ctx, rotated.RefreshToken)
	assert.ErrorIs(t, err, auth.ErrReusedRefresh,
		"sibling token must be revoked when reuse is detected")
}

// Unknown token: never been issued.
func TestService_Refresh_UnknownTokenInvalid(t *testing.T) {
	ctx, svc, _ := newRefreshSvc(t, 24*time.Hour)

	_, err := svc.Refresh(ctx, "definitely-not-a-real-token")
	assert.ErrorIs(t, err, auth.ErrInvalidRefresh)
}

// Empty token shortcut.
func TestService_Refresh_EmptyTokenInvalid(t *testing.T) {
	ctx, svc, _ := newRefreshSvc(t, 24*time.Hour)
	_, err := svc.Refresh(ctx, "")
	assert.ErrorIs(t, err, auth.ErrInvalidRefresh)
}

// Expired token: issue with negative TTL, immediately expired.
func TestService_Refresh_ExpiredToken(t *testing.T) {
	ctx, svc, u := newRefreshSvc(t, -time.Second)

	resp, err := svc.Login(ctx, u.Email, "Sup3rSecret!")
	require.NoError(t, err)

	_, err = svc.Refresh(ctx, resp.RefreshToken)
	assert.ErrorIs(t, err, auth.ErrExpiredRefresh)
}

// RevokeRefresh (logout) marks the token revoked; subsequent refresh fails
// as reuse (active-token-hash → revoked state).
func TestService_RevokeRefresh_OnLogout(t *testing.T) {
	ctx, svc, u := newRefreshSvc(t, 24*time.Hour)

	resp, err := svc.Login(ctx, u.Email, "Sup3rSecret!")
	require.NoError(t, err)

	require.NoError(t, svc.RevokeRefresh(ctx, resp.RefreshToken))

	_, err = svc.Refresh(ctx, resp.RefreshToken)
	assert.ErrorIs(t, err, auth.ErrReusedRefresh)
}

// RevokeRefresh is idempotent (already revoked is a silent no-op).
func TestService_RevokeRefresh_Idempotent(t *testing.T) {
	ctx, svc, u := newRefreshSvc(t, 24*time.Hour)

	resp, err := svc.Login(ctx, u.Email, "Sup3rSecret!")
	require.NoError(t, err)
	require.NoError(t, svc.RevokeRefresh(ctx, resp.RefreshToken))
	require.NoError(t, svc.RevokeRefresh(ctx, resp.RefreshToken))
	require.NoError(t, svc.RevokeRefresh(ctx, ""))
	require.NoError(t, svc.RevokeRefresh(ctx, "garbage"))
}

// Raw token never reaches the DB — only its SHA-256 digest does. Sanity check
// that the digest size matches what migration 00032 expects.
func TestRefreshToken_HashShape(t *testing.T) {
	sum := sha256.Sum256([]byte("anything"))
	assert.Len(t, sum[:], 32)
}
