package users_test

import (
	"context"
	"fmt"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
	"github.com/nathangalung/internalgns/apps/api/internal/users"
)

// mkSuperadmin creates a superadmin.
// When sole is true it leaves it the only active one inside the caller's
// transaction.
func mkSuperadmin(t *testing.T, ctx context.Context, tx pgx.Tx, repo *users.Repo, email string, sole bool) users.User {
	t.Helper()
	u, err := repo.Create(ctx, users.CreateUserRequest{
		Email: email, Name: "Admin", Password: "secret123", Role: users.RoleSuperadmin,
	}, seedUserID)
	require.NoError(t, err)
	if sole {
		_, err = tx.Exec(ctx,
			`UPDATE users SET is_active = FALSE WHERE role = 'superadmin' AND id <> $1`, u.ID)
		require.NoError(t, err)
	}
	return u
}

func activeTokens(t *testing.T, ctx context.Context, tx pgx.Tx, userID int64) int {
	t.Helper()
	var n int
	require.NoError(t, tx.QueryRow(ctx,
		`SELECT COUNT(*) FROM refresh_tokens WHERE user_id = $1 AND revoked_at IS NULL`,
		userID).Scan(&n))
	return n
}

func addToken(t *testing.T, ctx context.Context, tx pgx.Tx, userID int64, hash string) {
	t.Helper()
	_, err := tx.Exec(ctx,
		`INSERT INTO refresh_tokens (user_id, token_hash, expires_at, session_version)
		 SELECT $1, $2, now() + interval '1 hour', session_version FROM users WHERE id = $1`, userID, []byte(hash))
	require.NoError(t, err)
}

func TestRepo_Update_RejectsLastSuperadminDemotion(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := users.NewRepo(tx, testutil.Store(t))
	admin := mkSuperadmin(t, ctx, tx, repo, "sole-admin@example.local", true)

	_, err := repo.Update(ctx, admin.ID, users.UpdateUserRequest{
		Email: admin.Email, Name: admin.Name, Role: users.RoleFinance, IsActive: true,
	}, seedUserID)
	assert.ErrorIs(t, err, users.ErrLastSuperadmin)

	_, err = repo.Update(ctx, admin.ID, users.UpdateUserRequest{
		Email: admin.Email, Name: admin.Name, Role: users.RoleSuperadmin, IsActive: false,
	}, seedUserID)
	assert.ErrorIs(t, err, users.ErrLastSuperadmin)

	still, err := repo.GetByID(ctx, admin.ID)
	require.NoError(t, err)
	assert.Equal(t, users.RoleSuperadmin, still.Role)
	assert.True(t, still.IsActive)
}

func TestRepo_Update_AllowsDemotionWhenAnotherSuperadminActive(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := users.NewRepo(tx, testutil.Store(t))
	admin := mkSuperadmin(t, ctx, tx, repo, "spare-admin@example.local", true)
	mkSuperadmin(t, ctx, tx, repo, "other-admin@example.local", false)

	u, err := repo.Update(ctx, admin.ID, users.UpdateUserRequest{
		Email: admin.Email, Name: admin.Name, Role: users.RoleFinance, IsActive: true,
	}, seedUserID)
	require.NoError(t, err)
	assert.Equal(t, users.RoleFinance, u.Role)
}

// Guard ignores non-superadmins.
func TestRepo_Update_AllowsDeactivatingNonSuperadmin(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := users.NewRepo(tx, testutil.Store(t))

	u, err := repo.Create(ctx, users.CreateUserRequest{
		Email: "staff@example.local", Name: "Staff", Password: "secret123",
		Role: users.RoleOperational,
	}, seedUserID)
	require.NoError(t, err)

	got, err := repo.Update(ctx, u.ID, users.UpdateUserRequest{
		Email: u.Email, Name: u.Name, Role: users.RoleOperational, IsActive: false,
	}, seedUserID)
	require.NoError(t, err)
	assert.False(t, got.IsActive)
}

func TestRepo_UpdatePassword_RevokesRefreshTokens(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := users.NewRepo(tx, testutil.Store(t))

	u, err := repo.Create(ctx, users.CreateUserRequest{
		Email: "pwd-revoke@example.local", Name: "Pwd", Password: "old-secret",
		Role: users.RoleFinance,
	}, seedUserID)
	require.NoError(t, err)
	addToken(t, ctx, tx, u.ID, "revoke-on-password-change")
	require.Equal(t, 1, activeTokens(t, ctx, tx, u.ID))

	require.NoError(t, repo.UpdatePassword(ctx, u.ID, "new-secret", seedUserID))
	assert.Equal(t, 0, activeTokens(t, ctx, tx, u.ID))
}

func TestRepo_Update_RevokesOnRoleChangeAndDeactivation(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := users.NewRepo(tx, testutil.Store(t))

	u, err := repo.Create(ctx, users.CreateUserRequest{
		Email: "role-revoke@example.local", Name: "Role", Password: "secret123",
		Role: users.RoleOperational,
	}, seedUserID)
	require.NoError(t, err)

	addToken(t, ctx, tx, u.ID, "revoke-on-role-change")
	_, err = repo.Update(ctx, u.ID, users.UpdateUserRequest{
		Email: u.Email, Name: u.Name, Role: users.RoleFinance, IsActive: true,
	}, seedUserID)
	require.NoError(t, err)
	assert.Equal(t, 0, activeTokens(t, ctx, tx, u.ID))

	addToken(t, ctx, tx, u.ID, "revoke-on-deactivation")
	_, err = repo.Update(ctx, u.ID, users.UpdateUserRequest{
		Email: u.Email, Name: u.Name, Role: users.RoleFinance, IsActive: false,
	}, seedUserID)
	require.NoError(t, err)
	assert.Equal(t, 0, activeTokens(t, ctx, tx, u.ID))
}

// Renames keep sessions alive.
// A rename is not security-relevant.
func TestRepo_Update_KeepsTokensOnNameChange(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := users.NewRepo(tx, testutil.Store(t))

	u, err := repo.Create(ctx, users.CreateUserRequest{
		Email: "rename@example.local", Name: "Before", Password: "secret123",
		Role: users.RoleOperational,
	}, seedUserID)
	require.NoError(t, err)
	addToken(t, ctx, tx, u.ID, "keep-on-rename")

	_, err = repo.Update(ctx, u.ID, users.UpdateUserRequest{
		Email: u.Email, Name: "After", Role: users.RoleOperational, IsActive: true,
	}, seedUserID)
	require.NoError(t, err)
	assert.Equal(t, 1, activeTokens(t, ctx, tx, u.ID))
}

func TestRepo_EmailNormalizedOnWrite(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := users.NewRepo(tx, testutil.Store(t))

	u, err := repo.Create(ctx, users.CreateUserRequest{
		Email: "  MiXeD@Example.Local ", Name: "Mixed", Password: "secret123",
		Role: users.RoleOperational,
	}, seedUserID)
	require.NoError(t, err)
	assert.Equal(t, "mixed@example.local", u.Email)

	updated, err := repo.Update(ctx, u.ID, users.UpdateUserRequest{
		Email: "OTHER@Example.Local", Name: "Mixed", Role: users.RoleOperational, IsActive: true,
	}, seedUserID)
	require.NoError(t, err)
	assert.Equal(t, "other@example.local", updated.Email)
}

// Case-variant duplicate emails fail.
// The case-folded unique index must reject them.
func TestRepo_Create_RejectsCaseDuplicateEmail(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := users.NewRepo(tx, testutil.Store(t))

	req := users.CreateUserRequest{
		Email: "dup-case@example.local", Name: "Dup", Password: "secret123",
		Role: users.RoleOperational,
	}
	_, err := repo.Create(ctx, req, seedUserID)
	require.NoError(t, err)

	// Raw insert: normalization would hide the index behind UNIQUE(email).
	_, err = tx.Exec(ctx,
		`INSERT INTO users (email, name, password_hash, role, is_active, created_by, updated_by)
		 VALUES ('DUP-CASE@Example.Local', 'Dup', 'x', 'operational', TRUE, $1, $1)`, seedUserID)
	require.Error(t, err)
	assert.Contains(t, err.Error(), "users_email_lower_idx")
}

// Which changes bump the version.
// Only security-relevant changes end sessions; a rename or a reactivation
// must leave the version where it is.
func TestRepo_SessionVersionBumps(t *testing.T) {
	tests := []struct {
		name   string
		active bool
		change func(ctx context.Context, repo *users.Repo, u users.User) error
		bumps  int64
	}{
		{"role change", true,
			func(ctx context.Context, repo *users.Repo, u users.User) error {
				_, err := repo.Update(ctx, u.ID, users.UpdateUserRequest{Email: u.Email, Name: u.Name, Role: users.RoleFinance, IsActive: true}, seedUserID)
				return err
			}, 1},
		{"deactivation", true,
			func(ctx context.Context, repo *users.Repo, u users.User) error {
				_, err := repo.Update(ctx, u.ID, users.UpdateUserRequest{Email: u.Email, Name: u.Name, Role: u.Role, IsActive: false}, seedUserID)
				return err
			}, 1},
		{"password reset", true,
			func(ctx context.Context, repo *users.Repo, u users.User) error {
				return repo.UpdatePassword(ctx, u.ID, "Another-pw1!", seedUserID)
			}, 1},
		{"rename", true,
			func(ctx context.Context, repo *users.Repo, u users.User) error {
				_, err := repo.Update(ctx, u.ID, users.UpdateUserRequest{Email: u.Email, Name: "Renamed", Role: u.Role, IsActive: true}, seedUserID)
				return err
			}, 0},
		{"reactivation", false,
			func(ctx context.Context, repo *users.Repo, u users.User) error {
				_, err := repo.Update(ctx, u.ID, users.UpdateUserRequest{Email: u.Email, Name: u.Name, Role: u.Role, IsActive: true}, seedUserID)
				return err
			}, 0},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			ctx, tx := testutil.BeginTx(t)
			repo := users.NewRepo(tx, testutil.Store(t))
			u, err := repo.Create(ctx, users.CreateUserRequest{
				Email: fmt.Sprintf("version-%d@example.local", time.Now().UnixNano()), Name: "Version",
				Password: "Version-pw1!", Role: users.RoleOperational, IsActive: &tc.active,
			}, seedUserID)
			require.NoError(t, err)
			before, err := repo.AuthContext(ctx, u.ID)
			require.NoError(t, err)

			require.NoError(t, tc.change(ctx, repo, u))

			after, err := repo.AuthContext(ctx, u.ID)
			require.NoError(t, err)
			assert.Equal(t, before.SessionVersion+tc.bumps, after.SessionVersion)
		})
	}
}
