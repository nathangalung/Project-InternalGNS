package users_test

import (
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"
	"golang.org/x/crypto/bcrypt"

	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
	"github.com/nathangalung/internalgns/apps/api/internal/users"
)

const seedUserID int64 = 1

func TestRepo_GetByEmail_Found(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := users.NewRepo(tx, testutil.Store(t))

	u, err := repo.GetByEmail(ctx, "test-superadmin@globalsakti.local")
	if err == users.ErrNotFound {
		// Fallback when superadmin missing.
		req := users.CreateUserRequest{
			Email:    "lookup-test@local",
			Name:     "Lookup",
			Password: "secret123",
			Role:     users.RoleOperational,
		}
		_, err = repo.Create(ctx, req, seedUserID)
		require.NoError(t, err)
		u, err = repo.GetByEmail(ctx, "lookup-test@local")
	}
	require.NoError(t, err)
	assert.NotEmpty(t, u.Email)
}

func TestRepo_GetByEmail_NotFound(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := users.NewRepo(tx, testutil.Store(t))

	_, err := repo.GetByEmail(ctx, "no-such-user@nowhere.example")
	assert.ErrorIs(t, err, users.ErrNotFound)
}

func TestRepo_GetByID_Found(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := users.NewRepo(tx, testutil.Store(t))

	u, err := repo.GetByID(ctx, seedUserID)
	require.NoError(t, err)
	assert.Equal(t, seedUserID, u.ID)
}

func TestRepo_GetByID_NotFound(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := users.NewRepo(tx, testutil.Store(t))

	_, err := repo.GetByID(ctx, 99999999)
	assert.ErrorIs(t, err, users.ErrNotFound)
}

func TestRepo_Create(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := users.NewRepo(tx, testutil.Store(t))

	req := users.CreateUserRequest{
		Email:    "newuser@example.local",
		Name:     "New User",
		Password: "p4ssw0rd!",
		Role:     users.RoleOperational,
	}
	u, err := repo.Create(ctx, req, seedUserID)
	require.NoError(t, err)
	assert.Greater(t, u.ID, int64(0))
	assert.Equal(t, "newuser@example.local", u.Email)
	assert.Equal(t, users.RoleOperational, u.Role)

	require.NoError(t, bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte("p4ssw0rd!")))
}

func TestRepo_UpdatePassword(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := users.NewRepo(tx, testutil.Store(t))

	req := users.CreateUserRequest{
		Email:    "pwd@example.local",
		Name:     "Pwd User",
		Password: "old-pass",
		Role:     users.RoleFinance,
	}
	created, err := repo.Create(ctx, req, seedUserID)
	require.NoError(t, err)

	require.NoError(t, repo.UpdatePassword(ctx, created.ID, "new-pass", seedUserID))

	u, err := repo.GetByID(ctx, created.ID)
	require.NoError(t, err)
	require.NoError(t, bcrypt.CompareHashAndPassword([]byte(u.PasswordHash), []byte("new-pass")))
}

func TestRepo_UpdatePassword_NotFound(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := users.NewRepo(tx, testutil.Store(t))

	err := repo.UpdatePassword(ctx, 99999999, "anything", seedUserID)
	assert.ErrorIs(t, err, users.ErrNotFound)
}
