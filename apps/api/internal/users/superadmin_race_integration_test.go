package users_test

import (
	"context"
	"fmt"
	"sync"
	"testing"
	"time"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/db/queries"
	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
	"github.com/nathangalung/internalgns/apps/api/internal/users"
)

// soleSuperadminPair leaves two superadmins.
// It parks every other active superadmin, keeping only the two it creates,
// and restores the parked ones afterwards.
func soleSuperadminPair(t *testing.T, repo *users.Repo) (users.User, users.User) {
	t.Helper()
	pool := testutil.Pool(t)
	ctx := context.Background()

	var parked []int64
	rows, err := pool.Query(ctx,
		`SELECT id FROM users WHERE role = 'superadmin' AND is_active = TRUE`)
	require.NoError(t, err)
	for rows.Next() {
		var id int64
		require.NoError(t, rows.Scan(&id))
		parked = append(parked, id)
	}
	rows.Close()
	require.NoError(t, rows.Err())

	_, err = pool.Exec(ctx,
		`UPDATE users SET is_active = FALSE WHERE id = ANY($1)`, parked)
	require.NoError(t, err)
	t.Cleanup(func() {
		_, _ = pool.Exec(context.Background(),
			`UPDATE users SET is_active = TRUE WHERE id = ANY($1)`, parked)
	})

	mk := func(tag string) users.User {
		u, err := repo.Create(ctx, users.CreateUserRequest{
			Email:    fmt.Sprintf("race-%s-%d@test.local", tag, randSuffix()),
			Name:     "Race Admin",
			Password: validPassword,
			Role:     users.RoleSuperadmin,
		}, 1)
		require.NoError(t, err)
		t.Cleanup(func() {
			_, _ = pool.Exec(context.Background(), `DELETE FROM users WHERE id = $1`, u.ID)
		})
		return u
	}
	return mk("a"), mk("b")
}

// Update serialises on the guard.
// D12: the guard is only sound if the precheck and the write are one
// serialised unit. Holding the guard lock elsewhere must therefore block an
// update; without the lock the update sails past its stale precheck.
func TestRepo_Update_SerialisesOnTheSuperadminGuard(t *testing.T) {
	testutil.RequireDB(t)
	pool := testutil.Pool(t)
	repo := users.NewRepo(pool, testutil.Store(t))
	a, _ := soleSuperadminPair(t, repo)

	holder, err := pool.Begin(context.Background())
	require.NoError(t, err)
	defer func() { _ = holder.Rollback(context.Background()) }()
	_, err = holder.Exec(context.Background(),
		`SELECT pg_advisory_xact_lock(hashtext('users_superadmin_guard')::bigint)`)
	require.NoError(t, err)

	ctx, cancel := context.WithTimeout(context.Background(), 1500*time.Millisecond)
	defer cancel()
	_, err = repo.Update(ctx, a.ID, users.UpdateUserRequest{
		Email: a.Email, Name: "Blocked", Role: users.RoleSuperadmin, IsActive: true,
	}, 1)
	require.Error(t, err, "update must wait for the guard lock")
	assert.ErrorIs(t, err, context.DeadlineExceeded)

	require.NoError(t, holder.Rollback(context.Background()))

	_, err = repo.Update(context.Background(), a.ID, users.UpdateUserRequest{
		Email: a.Email, Name: "Unblocked", Role: users.RoleSuperadmin, IsActive: true,
	}, 1)
	require.NoError(t, err)
}

// Racing demotions keep one superadmin.
// Two demotions on the last two superadmins must not both pass.
func TestRepo_Update_ConcurrentDemotionsKeepOneSuperadmin(t *testing.T) {
	testutil.RequireDB(t)
	pool := testutil.Pool(t)
	repo := users.NewRepo(pool, testutil.Store(t))
	a, b := soleSuperadminPair(t, repo)

	demote := func(u users.User) error {
		_, err := repo.Update(context.Background(), u.ID, users.UpdateUserRequest{
			Email: u.Email, Name: u.Name, Role: users.RoleFinance, IsActive: true,
		}, 1)
		return err
	}

	var wg sync.WaitGroup
	errs := make([]error, 2)
	wg.Add(2)
	go func() { defer wg.Done(); errs[0] = demote(a) }()
	go func() { defer wg.Done(); errs[1] = demote(b) }()
	wg.Wait()

	var refused int
	for _, err := range errs {
		if err != nil {
			assert.ErrorIs(t, err, users.ErrLastSuperadmin)
			refused++
		}
	}
	assert.Equal(t, 1, refused, "exactly one demotion must be refused")

	var active int
	require.NoError(t, pool.QueryRow(context.Background(),
		`SELECT COUNT(*) FROM users WHERE role = 'superadmin' AND is_active = TRUE`).Scan(&active))
	assert.Equal(t, 1, active)
}

// brokenRevokeStore fails token revocation.
func brokenRevokeStore(t *testing.T) queries.Store {
	t.Helper()
	store := queries.Store{}
	for k, v := range testutil.Store(t) {
		store[k] = v
	}
	store["auth.refresh_revoke_user"] = `SELECT 1 / 0 WHERE $1::bigint IS NOT NULL AND $2::text IS NOT NULL`
	return store
}

// Revoke failure rolls back roles.
// A role change that cannot end the sessions must not commit either: a
// demoted user keeping a live refresh token is the exact gap the revoke
// closes.
func TestRepo_Update_RevokeFailureRollsBackTheChange(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := users.NewRepo(tx, brokenRevokeStore(t))

	u, err := repo.Create(ctx, users.CreateUserRequest{
		Email:    fmt.Sprintf("revoke-rb-%d@test.local", randSuffix()),
		Name:     "Revoke",
		Password: validPassword,
		Role:     users.RoleOperational,
	}, seedUserID)
	require.NoError(t, err)

	_, err = repo.Update(ctx, u.ID, users.UpdateUserRequest{
		Email: u.Email, Name: u.Name, Role: users.RoleFinance, IsActive: true,
	}, seedUserID)
	require.Error(t, err)

	var role users.Role
	require.NoError(t, tx.QueryRow(ctx, `SELECT role FROM users WHERE id = $1`, u.ID).Scan(&role))
	assert.Equal(t, users.RoleOperational, role)
}

// Revoke failure keeps the password.
// A reset that cannot end the sessions must not change the hash.
func TestRepo_UpdatePassword_RevokeFailureRollsBackTheHash(t *testing.T) {
	ctx, tx := testutil.BeginTx(t)
	repo := users.NewRepo(tx, brokenRevokeStore(t))

	u, err := repo.Create(ctx, users.CreateUserRequest{
		Email:    fmt.Sprintf("revoke-pw-%d@test.local", randSuffix()),
		Name:     "Revoke",
		Password: validPassword,
		Role:     users.RoleOperational,
	}, seedUserID)
	require.NoError(t, err)

	require.Error(t, repo.UpdatePassword(ctx, u.ID, "Berbeda2@", seedUserID))

	var hash string
	require.NoError(t, tx.QueryRow(ctx, `SELECT password_hash FROM users WHERE id = $1`, u.ID).Scan(&hash))
	assert.Equal(t, u.PasswordHash, hash)
}
