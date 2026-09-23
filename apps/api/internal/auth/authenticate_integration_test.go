package auth_test

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/auth"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
	"github.com/nathangalung/internalgns/apps/api/internal/users"
)

// waitForNextSecond sleeps past the next whole-second boundary.
func waitForNextSecond() {
	now := time.Now()
	time.Sleep(now.Truncate(time.Second).Add(time.Second + 20*time.Millisecond).Sub(now))
}

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

// AU-2: a role change must reach the existing access token, not wait for exp.
func TestService_Authenticate_RoleChangeTakesEffect(t *testing.T) {
	ctx, _, repo, svc, u, token := mkLoggedIn(t, users.RoleOperational)

	_, err := repo.Update(ctx, u.ID, users.UpdateUserRequest{
		Email: u.Email, Name: u.Name, Role: users.RoleFinance, IsActive: true,
	}, 1)
	require.NoError(t, err)

	ident, err := svc.Authenticate(ctx, token)
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

// A token issued after the reset must keep working.
func TestService_Authenticate_TokenIssuedAfterResetStillValid(t *testing.T) {
	ctx, _, repo, svc, u, _ := mkLoggedIn(t, users.RoleOperational)

	require.NoError(t, repo.UpdatePassword(ctx, u.ID, "Another-pw1!", 1))
	// iat is second-granular, so cross the next second boundary before the
	// new login: a token minted in the same second as the reset is refused.
	waitForNextSecond()

	resp, err := svc.Login(ctx, u.Email, "Another-pw1!")
	require.NoError(t, err)
	ident, err := svc.Authenticate(ctx, resp.Token)
	require.NoError(t, err)
	assert.Equal(t, u.ID, ident.UserID)
}
