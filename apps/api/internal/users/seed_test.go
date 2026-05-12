package users_test

import (
	"context"
	"testing"

	"github.com/stretchr/testify/assert"
	"github.com/stretchr/testify/require"

	"github.com/nathangalung/internalgns/apps/api/internal/testutil"
	"github.com/nathangalung/internalgns/apps/api/internal/users"
)

func TestSeedSuperadmin_RejectsMissingEmail(t *testing.T) {
	pool := testutil.Pool(t)
	err := users.SeedSuperadmin(context.Background(), pool, users.SeedConfig{
		Name: "x", Password: "p",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "email and password required")
}

func TestSeedSuperadmin_RejectsMissingPassword(t *testing.T) {
	pool := testutil.Pool(t)
	err := users.SeedSuperadmin(context.Background(), pool, users.SeedConfig{
		Email: "e@e.local", Name: "x",
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "email and password required")
}

func TestSeedSuperadmin_BcryptFailsOnLongPassword(t *testing.T) {
	pool := testutil.Pool(t)
	long := make([]byte, 80)
	for i := range long {
		long[i] = 'a'
	}
	err := users.SeedSuperadmin(context.Background(), pool, users.SeedConfig{
		Email: "x@x", Name: "n", Password: string(long),
	})
	require.Error(t, err)
	assert.Contains(t, err.Error(), "bcrypt")
}

func TestSeedSuperadmin_IdempotentReRun(t *testing.T) {
	pool := testutil.Pool(t)
	cfg := users.SeedConfig{
		Email:    "test-seed-admin@local",
		Name:     "Test Seed",
		Password: "secret-seed",
	}
	require.NoError(t, users.SeedSuperadmin(context.Background(), pool, cfg))
	require.NoError(t, users.SeedSuperadmin(context.Background(), pool, cfg))
}

// Two distinct emails seeded back-to-back must both end up as active
// superadmins. Mirrors the boot path that seeds SUPERADMIN_* then
// SUPERADMIN2_* when both are configured.
func TestSeedSuperadmin_TwoDistinctAccounts(t *testing.T) {
	pool := testutil.Pool(t)
	ctx := context.Background()

	require.NoError(t, users.SeedSuperadmin(ctx, pool, users.SeedConfig{
		Email: "primary-admin@local", Name: "Primary", Password: "pw-primary",
	}))
	require.NoError(t, users.SeedSuperadmin(ctx, pool, users.SeedConfig{
		Email: "secondary-admin@local", Name: "Secondary", Password: "pw-secondary",
	}))

	var count int
	require.NoError(t, pool.QueryRow(ctx,
		`SELECT COUNT(*) FROM users
		 WHERE role = 'superadmin' AND is_active = TRUE
		   AND email IN ('primary-admin@local', 'secondary-admin@local')`,
	).Scan(&count))
	assert.Equal(t, 2, count)
}
