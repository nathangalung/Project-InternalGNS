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

// A replay within the grace window is flagged as reuse but must NOT revoke
// the sibling session — it is a benign race (duplicate tab, retried request).
func TestService_Refresh_RecentReuseSpareSiblings(t *testing.T) {
	ctx, svc, u := newRefreshSvc(t, 24*time.Hour)

	first, err := svc.Login(ctx, u.Email, "Sup3rSecret!")
	require.NoError(t, err)
	rotated, err := svc.Refresh(ctx, first.RefreshToken)
	require.NoError(t, err)

	// Replay the original immediately — flagged, but within grace.
	_, err = svc.Refresh(ctx, first.RefreshToken)
	assert.ErrorIs(t, err, auth.ErrReusedRefresh)

	// The rotated token is still valid because the replay was a recent race.
	_, err = svc.Refresh(ctx, rotated.RefreshToken)
	require.NoError(t, err)
}

// A replay after the grace window is a genuine reuse and revokes every session.
func TestService_Refresh_OldReuseBlastsAllSessions(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	store := testutil.Store(t)
	userRepo := users.NewRepo(tx, store)
	u, err := userRepo.Create(ctx, users.CreateUserRequest{
		Email: uniqueEmail(t), Name: "Blast IT",
		Password: "Sup3rSecret!", Role: users.RoleOperational,
	}, 1)
	require.NoError(t, err)
	svc := auth.NewService(userRepo, "test-secret-please-change", time.Hour).
		WithRefresh(auth.NewRefreshRepo(tx, store), 24*time.Hour)

	first, err := svc.Login(ctx, u.Email, "Sup3rSecret!")
	require.NoError(t, err)
	rotated, err := svc.Refresh(ctx, first.RefreshToken)
	require.NoError(t, err)

	// Backdate the revocation past the grace window to simulate a real replay.
	_, err = tx.Exec(ctx,
		"UPDATE refresh_tokens SET revoked_at = now() - interval '30 seconds' WHERE revoked_at IS NOT NULL")
	require.NoError(t, err)

	_, err = svc.Refresh(ctx, first.RefreshToken)
	assert.ErrorIs(t, err, auth.ErrReusedRefresh)

	// An old replay blasts every session, so the rotated token is revoked too.
	_, err = svc.Refresh(ctx, rotated.RefreshToken)
	assert.ErrorIs(t, err, auth.ErrRevokedRefresh)
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

// RevokeRefresh (logout) marks the token revoked; a later refresh is told
// the session ended, not that the token was replayed.
func TestService_RevokeRefresh_OnLogout(t *testing.T) {
	ctx, svc, u := newRefreshSvc(t, 24*time.Hour)

	resp, err := svc.Login(ctx, u.Email, "Sup3rSecret!")
	require.NoError(t, err)

	require.NoError(t, svc.RevokeRefresh(ctx, resp.RefreshToken))

	_, err = svc.Refresh(ctx, resp.RefreshToken)
	assert.ErrorIs(t, err, auth.ErrRevokedRefresh)
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

// PurgeExpired drops only rows past the retention window, leaving live and
// recently expired tokens alone.
func TestRefreshRepo_PurgeExpired(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	store := testutil.Store(t)
	userRepo := users.NewRepo(tx, store)

	u, err := userRepo.Create(ctx, users.CreateUserRequest{
		Email: uniqueEmail(t), Name: "Purge IT",
		Password: "Sup3rSecret!", Role: users.RoleOperational,
	}, 1)
	require.NoError(t, err)

	// Isolate the assertion from seeded rows: only these three are counted.
	seed := func(label string, expiresAt time.Time) {
		hash := sha256.Sum256([]byte(t.Name() + label))
		_, err := tx.Exec(ctx, store.Get("auth.refresh_insert"), u.ID, hash[:], expiresAt, 1)
		require.NoError(t, err)
	}
	// Seeds bracket the 7-day retention boundary in auth.refresh_purge_expired.
	now := time.Now()
	seed("live", now.Add(24*time.Hour))
	seed("recent", now.Add(-1*time.Hour))
	seed("inside", now.Add(-6*24*time.Hour))
	seed("outside", now.Add(-8*24*time.Hour))

	repo := auth.NewRefreshRepo(tx, store)
	_, err = repo.PurgeExpired(ctx)
	require.NoError(t, err)

	gone := func(label string) bool {
		hash := sha256.Sum256([]byte(t.Name() + label))
		var absent bool
		require.NoError(t, tx.QueryRow(ctx,
			`SELECT NOT EXISTS(SELECT 1 FROM refresh_tokens WHERE token_hash = $1)`,
			hash[:]).Scan(&absent))
		return absent
	}
	assert.True(t, gone("outside"), "token past the 7-day window must be purged")
	assert.False(t, gone("inside"), "token inside the window must survive")
	assert.False(t, gone("recent"), "recently expired token must survive")
	assert.False(t, gone("live"), "unexpired token must survive")

	var remaining int
	require.NoError(t, tx.QueryRow(ctx,
		`SELECT count(*) FROM refresh_tokens WHERE user_id = $1`, u.ID).Scan(&remaining))
	assert.Equal(t, 3, remaining)
}

// Purge failure reaches the sweep.
// The background loop decides whether to log, so the repo must hand the
// database error back wrapped, not swallow it as zero rows.
func TestRefreshRepo_PurgeExpired_DBError(t *testing.T) {
	repo := auth.NewRefreshRepo(testutil.FakeExec{}, testutil.Store(t))
	n, err := repo.PurgeExpired(context.Background())
	require.ErrorIs(t, err, testutil.ErrFake)
	assert.Contains(t, err.Error(), "purge expired refresh tokens")
	assert.Zero(t, n)
}

// Raw token never reaches the DB — only its SHA-256 digest does. Sanity check
// that the digest size matches what migration 00032 expects.
func TestRefreshToken_HashShape(t *testing.T) {
	sum := sha256.Sum256([]byte("anything"))
	assert.Len(t, sum[:], 32)
}

// AU-13: a token an admin revoked is not evidence of theft. Replaying it
// after the grace window must not blast the session the user opened since.
func TestService_Refresh_AdminRevokedSparesNewSession(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	store := testutil.Store(t)
	userRepo := users.NewRepo(tx, store)
	u, err := userRepo.Create(ctx, users.CreateUserRequest{
		Email: uniqueEmail(t), Name: "Admin Revoke IT",
		Password: "Sup3rSecret!", Role: users.RoleOperational,
	}, 1)
	require.NoError(t, err)
	svc := auth.NewService(userRepo, "test-secret-please-change", time.Hour).
		WithRefresh(auth.NewRefreshRepo(tx, store), 24*time.Hour)

	stale, err := svc.Login(ctx, u.Email, "Sup3rSecret!")
	require.NoError(t, err)

	// A role change revokes every session with reason "admin".
	_, err = userRepo.Update(ctx, u.ID, users.UpdateUserRequest{
		Email: u.Email, Name: u.Name, Role: users.RoleFinance, IsActive: true,
	}, 1)
	require.NoError(t, err)
	_, err = tx.Exec(ctx,
		`UPDATE refresh_tokens SET revoked_at = now() - interval '30 seconds'
		  WHERE user_id = $1 AND revoked_at IS NOT NULL`, u.ID)
	require.NoError(t, err)

	fresh, err := svc.Login(ctx, u.Email, "Sup3rSecret!")
	require.NoError(t, err)

	_, err = svc.Refresh(ctx, stale.RefreshToken)
	assert.ErrorIs(t, err, auth.ErrRevokedRefresh)

	_, err = svc.Refresh(ctx, fresh.RefreshToken)
	require.NoError(t, err, "the session opened after the admin revoke must survive")
}

// A logged-out token replayed later likewise leaves other sessions alone.
func TestService_Refresh_LoggedOutReplaySparesSiblings(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	store := testutil.Store(t)
	userRepo := users.NewRepo(tx, store)
	u, err := userRepo.Create(ctx, users.CreateUserRequest{
		Email: uniqueEmail(t), Name: "Logout IT",
		Password: "Sup3rSecret!", Role: users.RoleOperational,
	}, 1)
	require.NoError(t, err)
	svc := auth.NewService(userRepo, "test-secret-please-change", time.Hour).
		WithRefresh(auth.NewRefreshRepo(tx, store), 24*time.Hour)

	a, err := svc.Login(ctx, u.Email, "Sup3rSecret!")
	require.NoError(t, err)
	b, err := svc.Login(ctx, u.Email, "Sup3rSecret!")
	require.NoError(t, err)
	require.NoError(t, svc.RevokeRefresh(ctx, a.RefreshToken))
	_, err = tx.Exec(ctx,
		`UPDATE refresh_tokens SET revoked_at = now() - interval '30 seconds'
		  WHERE user_id = $1 AND revoked_at IS NOT NULL`, u.ID)
	require.NoError(t, err)

	_, err = svc.Refresh(ctx, a.RefreshToken)
	assert.ErrorIs(t, err, auth.ErrRevokedRefresh)

	_, err = svc.Refresh(ctx, b.RefreshToken)
	require.NoError(t, err)
}

// Refresh tokens follow the version.
// Every production bump also revokes the refresh tokens, so the bump alone
// is written here to prove the binding holds without that revocation.
func TestService_Refresh_BoundToSessionVersion(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	store := testutil.Store(t)
	repo := users.NewRepo(tx, store)
	u, err := repo.Create(ctx, users.CreateUserRequest{
		Email: uniqueEmail(t), Name: "Version IT", Password: "Sup3rSecret!", Role: users.RoleOperational,
	}, 1)
	require.NoError(t, err)
	svc := auth.NewService(repo, "test-secret-please-change", time.Hour).
		WithRefresh(auth.NewRefreshRepo(tx, store), 24*time.Hour)

	stale, err := svc.Login(ctx, u.Email, "Sup3rSecret!")
	require.NoError(t, err)
	_, err = tx.Exec(ctx, store.Get("users.bump_session_version"), u.ID)
	require.NoError(t, err)

	_, err = svc.Refresh(ctx, stale.RefreshToken)
	assert.ErrorIs(t, err, auth.ErrRevokedRefresh, "a token minted before the bump is ended, not expired or reused")

	fresh, err := svc.Login(ctx, u.Email, "Sup3rSecret!")
	require.NoError(t, err)
	rotated, err := svc.Refresh(ctx, fresh.RefreshToken)
	require.NoError(t, err, "the stale refusal must not blast the newer session")
	_, err = svc.Authenticate(ctx, rotated.Token)
	require.NoError(t, err, "a refreshed access token carries the live version")
}
