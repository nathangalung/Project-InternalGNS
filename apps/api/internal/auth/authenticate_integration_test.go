package auth_test

import (
	"context"
	"strconv"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/auth"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
	"github.com/nathangalung/internalgns/apps/api/internal/users"
)

// mkLoggedIn creates a user and returns its repo, service and access token.
func mkLoggedIn(t *testing.T, role users.Role) (context.Context, pgx.Tx, *users.Repo, *auth.Service, users.User, string) {
	t.Helper()
	ctx, tx := testutil.BeginTx(t)
	repo := users.NewRepo(tx, testutil.Store(t))
	email := uniqueEmail(t)
	u, err := repo.Create(ctx, users.CreateUserRequest{
		Email: email, Name: "Live Session", Password: "Right-pw1!", Role: role,
	}, 1)
	require.NoError(t, err)

	svc := auth.NewService(repo, "authenticate-test-secret", time.Hour)
	resp, err := svc.Login(ctx, email, "Right-pw1!")
	require.NoError(t, err)
	require.NotEmpty(t, resp.Token)
	return ctx, tx, repo, svc, u, resp.Token
}

// A live token must resolve to the account's current id and role.
func TestService_Authenticate_LiveToken(t *testing.T) {
	ctx, _, _, svc, u, token := mkLoggedIn(t, users.RoleOperational)

	ident, err := svc.Authenticate(ctx, token)
	require.NoError(t, err)
	assert.Equal(t, u.ID, ident.UserID)
	assert.Equal(t, users.RoleOperational, ident.Role)
}

// AU-1: deactivating a user must end the existing access token at once.
func TestService_Authenticate_DeactivatedUserRejected(t *testing.T) {
	ctx, _, repo, svc, u, token := mkLoggedIn(t, users.RoleOperational)

	_, err := repo.Update(ctx, u.ID, users.UpdateUserRequest{
		Email: u.Email, Name: u.Name, Role: users.RoleOperational, IsActive: false,
	}, 1)
	require.NoError(t, err)

	_, err = svc.Authenticate(ctx, token)
	assert.ErrorIs(t, err, auth.ErrSessionRevoked)
}

// AU-2: a role change must reach the existing access token, not wait for
// exp. It ends that token, and the next login carries the new role.
func TestService_Authenticate_RoleChangeTakesEffect(t *testing.T) {
	ctx, _, repo, svc, u, token := mkLoggedIn(t, users.RoleOperational)

	_, err := repo.Update(ctx, u.ID, users.UpdateUserRequest{
		Email: u.Email, Name: u.Name, Role: users.RoleFinance, IsActive: true,
	}, 1)
	require.NoError(t, err)

	_, err = svc.Authenticate(ctx, token)
	assert.ErrorIs(t, err, auth.ErrSessionRevoked)

	resp, err := svc.Login(ctx, u.Email, "Right-pw1!")
	require.NoError(t, err)
	ident, err := svc.Authenticate(ctx, resp.Token)
	require.NoError(t, err)
	assert.Equal(t, users.RoleFinance, ident.Role)
}

// AU-11: a password reset must end the target's existing access token.
func TestService_Authenticate_PasswordResetRevokesToken(t *testing.T) {
	ctx, _, repo, svc, u, token := mkLoggedIn(t, users.RoleOperational)

	require.NoError(t, repo.UpdatePassword(ctx, u.ID, "Another-pw1!", 1))

	_, err := svc.Authenticate(ctx, token)
	assert.ErrorIs(t, err, auth.ErrSessionRevoked)
}

// A token issued after the reset must keep working: the re-login a reset
// forces would otherwise bounce straight back to the login screen.
func TestService_Authenticate_TokenIssuedAfterResetStillValid(t *testing.T) {
	ctx, _, repo, svc, u, _ := mkLoggedIn(t, users.RoleOperational)

	require.NoError(t, repo.UpdatePassword(ctx, u.ID, "Another-pw1!", 1))

	resp, err := svc.Login(ctx, u.Email, "Another-pw1!")
	require.NoError(t, err)
	ident, err := svc.Authenticate(ctx, resp.Token)
	require.NoError(t, err)
	assert.Equal(t, u.ID, ident.UserID)
}

// Backward clock steps keep sessions.
// The host clock that mints the token may step back after Postgres wrote
// the account row; the fresh login must still authenticate.
func TestService_Authenticate_SurvivesBackwardClockStep(t *testing.T) {
	tests := []struct {
		name     string
		password string
		before   func(t *testing.T, ctx context.Context, repo *users.Repo, u users.User)
	}{
		{"fresh account", "Right-pw1!", func(*testing.T, context.Context, *users.Repo, users.User) {}},
		{"after a password reset", "Another-pw1!", func(t *testing.T, ctx context.Context, repo *users.Repo, u users.User) {
			require.NoError(t, repo.UpdatePassword(ctx, u.ID, "Another-pw1!", 1))
		}},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ctx, _, repo, svc, u, _ := mkLoggedIn(t, users.RoleOperational)
			tc.before(t, ctx, repo, u)

			auth.SetClock(svc, func() time.Time { return time.Now().Add(-5 * time.Second) })
			resp, err := svc.Login(ctx, u.Email, tc.password)
			require.NoError(t, err)

			ident, err := svc.Authenticate(ctx, resp.Token)
			require.NoError(t, err)
			assert.Equal(t, u.ID, ident.UserID)
		})
	}
}

// Versionless tokens are refused.
// Every access token minted before the version existed lacks the claim; it
// decodes to 0, which no account holds, so the client must refresh.
func TestService_Authenticate_MissingVersionRefused(t *testing.T) {
	ctx, _, _, svc, u, _ := mkLoggedIn(t, users.RoleOperational)

	now := time.Now()
	legacy, err := jwt.NewWithClaims(jwt.SigningMethodHS256, auth.Claims{
		Role: users.RoleOperational,
		RegisteredClaims: jwt.RegisteredClaims{
			Issuer:    "internalgns-api",
			Subject:   strconv.FormatInt(u.ID, 10),
			IssuedAt:  jwt.NewNumericDate(now),
			ExpiresAt: jwt.NewNumericDate(now.Add(time.Hour)),
		},
	}).SignedString([]byte("authenticate-test-secret"))
	require.NoError(t, err)

	_, err = svc.Authenticate(ctx, legacy)
	assert.ErrorIs(t, err, auth.ErrSessionRevoked)
}

// Forward mint clocks keep sessions.
// The clock that checks nbf may step back after the one that stamped it;
// a token minted seconds "in the future" must still authenticate.
func TestService_Authenticate_SurvivesClockStepAfterMint(t *testing.T) {
	ctx, _, _, svc, u, _ := mkLoggedIn(t, users.RoleOperational)

	auth.SetClock(svc, func() time.Time { return time.Now().Add(5 * time.Second) })
	resp, err := svc.Login(ctx, u.Email, "Right-pw1!")
	require.NoError(t, err)

	ident, err := svc.Authenticate(ctx, resp.Token)
	require.NoError(t, err)
	assert.Equal(t, u.ID, ident.UserID)
}
